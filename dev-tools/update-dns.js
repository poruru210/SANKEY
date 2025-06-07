#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const https = require('https');

// 既存のライブラリを流用
const { createAwsClients, findSankeyStacks, getStackOutputs } = require('./lib/aws-helpers');
const { log, displayTitle, displayStackOptions } = require('./lib/logger');
const { selectStackCombination, validateOptions, Timer } = require('./lib/cli-helpers');

// コマンドライン引数の設定
const program = new Command();

program
    .name('update-dns')
    .description('Update Cloudflare DNS records for API Gateway endpoints')
    .version('1.0.0')
    .requiredOption('-p, --profile <profile>', 'AWS SSO profile name')
    .option('-r, --region <region>', 'AWS region (defaults to profile default)')
    .option('-e, --environment <env>', 'Specific environment to update (dev/staging/prod)')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--debug', 'Enable debug output');

/**
 * Cloudflare API クライアント
 */
class CloudflareClient {
    constructor(apiToken, zoneId) {
        this.apiToken = apiToken;
        this.zoneId = zoneId;
        this.baseUrl = 'https://api.cloudflare.com/client/v4';
    }

    /**
     * HTTP リクエストを送信
     */
    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        return new Promise((resolve, reject) => {
            const options = {
                method,
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json',
                }
            };

            const req = https.request(url, options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        
                        if (parsed.success) {
                            resolve(parsed.result);
                        } else {
                            reject(new Error(`Cloudflare API error: ${parsed.errors?.map(e => e.message).join(', ') || 'Unknown error'}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    /**
     * DNS レコード一覧を取得
     */
    async listDnsRecords(name = null) {
        let endpoint = `/zones/${this.zoneId}/dns_records`;
        
        if (name) {
            endpoint += `?name=${encodeURIComponent(name)}`;
        }

        return await this.makeRequest('GET', endpoint);
    }

    /**
     * DNS レコードを作成
     */
    async createDnsRecord(name, type, content, ttl = 1) {
        const data = {
            type,
            name,
            content,
            ttl,
            proxied: true  // Cloudflareプロキシを有効化
        };

        return await this.makeRequest('POST', `/zones/${this.zoneId}/dns_records`, data);
    }

    /**
     * DNS レコードを更新
     */
    async updateDnsRecord(recordId, name, type, content, ttl = 1) {
        const data = {
            type,
            name,
            content,
            ttl,
            proxied: true  // Cloudflareプロキシを有効化
        };

        return await this.makeRequest('PUT', `/zones/${this.zoneId}/dns_records/${recordId}`, data);
    }

    /**
     * DNS レコードを削除
     */
    async deleteDnsRecord(recordId) {
        return await this.makeRequest('DELETE', `/zones/${this.zoneId}/dns_records/${recordId}`);
    }
}

/**
 * API Gateway URLからCNAME対象を抽出
 */
function extractCnameTarget(apiGatewayUrl) {
    try {
        const url = new URL(apiGatewayUrl);
        return url.hostname;
    } catch (error) {
        throw new Error(`Invalid API Gateway URL: ${apiGatewayUrl}`);
    }
}

/**
 * DNS レコード名を生成
 */
function generateDnsRecordName(environment, domain = 'sankey.trade') {
    // 本番環境の場合は api.sankey.trade、それ以外は api-{環境}.sankey.trade
    if (environment === 'prod') {
        return `api.${domain}`;
    }
    return `api-${environment}.${domain}`;
}

/**
 * DNS レコードを更新またはスキップの判定
 */
async function updateDnsRecord(cloudflareClient, recordName, cnameTarget, options) {
    try {
        log.info(`🔍 Checking existing DNS record for: ${recordName}`);
        
        // 既存レコードを検索
        const existingRecords = await cloudflareClient.listDnsRecords(recordName);
        const existingRecord = existingRecords.find(record => record.name === recordName && record.type === 'CNAME');

        if (options.dryRun) {
            if (existingRecord) {
                log.info(`[DRY-RUN] Would update CNAME record: ${recordName} -> ${cnameTarget}`);
                log.info(`[DRY-RUN] Current target: ${existingRecord.content}`);
            } else {
                log.info(`[DRY-RUN] Would create CNAME record: ${recordName} -> ${cnameTarget}`);
            }
            return { action: 'dry-run', record: existingRecord };
        }

        if (existingRecord) {
            // 既存レコードがある場合
            if (existingRecord.content === cnameTarget) {
                log.success(`✅ DNS record already up to date: ${recordName} -> ${cnameTarget}`);
                return { action: 'no-change', record: existingRecord };
            } else {
                log.info(`🔄 Updating existing CNAME record: ${recordName}`);
                log.info(`   From: ${existingRecord.content}`);
                log.info(`   To:   ${cnameTarget}`);
                
                const updatedRecord = await cloudflareClient.updateDnsRecord(
                    existingRecord.id,
                    recordName,
                    'CNAME',
                    cnameTarget
                );
                
                log.success(`✅ Updated CNAME record: ${recordName} -> ${cnameTarget}`);
                return { action: 'updated', record: updatedRecord };
            }
        } else {
            // 新規作成
            log.info(`🆕 Creating new CNAME record: ${recordName} -> ${cnameTarget}`);
            
            const newRecord = await cloudflareClient.createDnsRecord(
                recordName,
                'CNAME',
                cnameTarget
            );
            
            log.success(`✅ Created CNAME record: ${recordName} -> ${cnameTarget}`);
            return { action: 'created', record: newRecord };
        }

    } catch (error) {
        throw new Error(`Failed to update DNS record for ${recordName}: ${error.message}`);
    }
}

/**
 * メイン処理
 */
async function main() {
    const timer = new Timer();

    try {
        // コマンドライン引数をパース
        program.parse();
        const options = program.opts();

        // 引数検証
        validateOptions(options, ['profile']);

        // 環境変数チェック
        const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
        const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;

        if (!CLOUDFLARE_API_TOKEN) {
            throw new Error('CLOUDFLARE_API_TOKEN environment variable is required');
        }

        if (!CLOUDFLARE_ZONE_ID) {
            throw new Error('CLOUDFLARE_ZONE_ID environment variable is required');
        }

        // タイトル表示
        displayTitle('Sankey DNS Updater');

        log.info(`📧 AWS Profile: ${options.profile}`);
        
        if (options.region) {
            log.info(`🌍 AWS Region: ${options.region} (specified)`);
        } else {
            log.info(`🌍 AWS Region: Using profile default`);
        }

        if (options.environment) {
            log.info(`🎯 Target Environment: ${options.environment.toUpperCase()}`);
        }

        if (options.dryRun) {
            log.warning('🧪 DRY-RUN MODE: No changes will be made');
        }

        // Cloudflare クライアント初期化
        log.info('☁️ Initializing Cloudflare client...');
        const cloudflareClient = new CloudflareClient(CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID);

        // AWS クライアント初期化
        log.info('🔧 Initializing AWS clients...');
        const clients = createAwsClients(options.profile, options.region);
        log.success('AWS clients initialized successfully');

        // スタック検索
        log.info('🔍 Searching for Sankey stacks...');
        let stackCombinations = await findSankeyStacks(clients.cloudFormation, options);

        if (stackCombinations.length === 0) {
            log.error('No Sankey stacks found. Please check:');
            log.error('- Stack naming convention: Sankey{Environment}{Type}Stack');
            log.error('- AWS region and profile settings');
            return;
        }

        // 特定環境のフィルタリング
        if (options.environment) {
            const targetEnv = options.environment.toLowerCase();
            stackCombinations = stackCombinations.filter(combo => combo.environment === targetEnv);
            
            if (stackCombinations.length === 0) {
                log.error(`No stacks found for environment: ${options.environment}`);
                return;
            }
        }

        log.success(`Found ${stackCombinations.length} stack combination(s):`);
        displayStackOptions(stackCombinations);

        // スタック選択（環境指定時は自動選択）
        let selectedCombination;
        if (options.environment && stackCombinations.length === 1) {
            selectedCombination = stackCombinations[0];
            log.info(`🚀 Auto-selecting: ${selectedCombination.environment.toUpperCase()} Environment`);
        } else {
            log.info('🎯 Selecting stack combination...');
            selectedCombination = await selectStackCombination(stackCombinations, options);
        }

        // API Endpoint取得
        log.info('📋 Retrieving API Gateway endpoint...');
        const apiOutputs = await getStackOutputs(
            clients.cloudFormation,
            selectedCombination.apiStack.StackName,
            ['ApiEndpoint'],
            options
        );

        if (!apiOutputs.ApiEndpoint) {
            throw new Error('API Gateway endpoint not found in stack outputs');
        }

        const apiEndpoint = apiOutputs.ApiEndpoint.replace(/\/$/, ''); // 末尾スラッシュ削除
        log.success(`📍 API Endpoint: ${apiEndpoint}`);

        // CNAME ターゲット抽出
        const cnameTarget = extractCnameTarget(apiEndpoint);
        log.info(`🎯 CNAME Target: ${cnameTarget}`);

        // DNS レコード名生成
        const recordName = generateDnsRecordName(selectedCombination.environment);
        log.info(`📝 DNS Record Name: ${recordName}`);

        // DNS レコード更新
        log.info('🌐 Updating Cloudflare DNS record...');
        const result = await updateDnsRecord(cloudflareClient, recordName, cnameTarget, options);

        // 結果表示
        console.log('\n📊 Summary:');
        console.log(`   Environment: ${selectedCombination.environment.toUpperCase()}`);
        console.log(`   DNS Record: ${recordName}`);
        console.log(`   Target: ${cnameTarget}`);
        console.log(`   Action: ${result.action.toUpperCase()}`);

        if (!options.dryRun) {
            console.log('\n🎉 DNS update completed successfully!');
            console.log(`🔗 Your API is now accessible at: https://${recordName}`);
            console.log('\n📋 Next Steps:');
            console.log('   1. Wait a few minutes for DNS propagation');
            console.log('   2. Test the endpoint: curl https://' + recordName + '/health');
            console.log('   3. Update your frontend configuration if needed');
        }

        timer.log('Operation completed');

    } catch (error) {
        log.error(`Error: ${error.message}`);

        if (error.message.includes('profile')) {
            log.warning('Make sure you have run: aws sso login --profile ' + (program.opts().profile || '<profile>'));
        }

        if (error.message.includes('CLOUDFLARE_')) {
            log.warning('Make sure you have set up your .env file with Cloudflare credentials');
        }

        process.exit(1);
    }
}

// エラーハンドリング
process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${error.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error(`Unhandled rejection: ${reason}`);
    process.exit(1);
});

// 実行
if (require.main === module) {
    main();
}