const https = require('https');
const { log, displaySection } = require('../lib/logger');
const {
    CUSTOM_DOMAINS,
    SSM_PARAMETERS,
    CLOUDFLARE_API,
    DNS_RECORD_TYPES,
    DEFAULT_DNS_TTL,
    ENVIRONMENTS
} = require('../lib/constants');
const { getCertificateArn } = require('./ssm-module');
const { ConfigurationError, ApiError } = require('../lib/errors');

/**
 * カスタムドメインDNS設定モジュール
 * CDKでAPI Gatewayカスタムドメインを作成した後のDNS設定を管理
 */

/**
 * Cloudflare API Client (DNS操作専用)
 */
class CloudflareDnsClient {
    constructor(apiToken, zoneId) {
        this.apiToken = apiToken;
        this.zoneId = zoneId;
        this.baseUrl = CLOUDFLARE_API.BASE_URL;
    }

    /**
     * Make API request to Cloudflare
     */
    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        return new Promise((resolve, reject) => {
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': CLOUDFLARE_API.USER_AGENT,
                'Authorization': `Bearer ${this.apiToken}`
            };

            const urlObj = new URL(url);
            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method,
                headers
            };

            const req = https.request(options, (res) => {
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
                            const errors = parsed.errors?.map(e => `${e.code}: ${e.message}`).join(', ') || `Status ${res.statusCode} - Unknown Cloudflare error`;
                            reject(new ApiError(errors, 'Cloudflare DNS', res.statusCode));
                        }
                    } catch (parseError) {
                        reject(new ApiError(`Failed to parse Cloudflare API response: ${parseError.message}`, 'Cloudflare DNS', res.statusCode, parseError));
                    }
                });
            });

            req.on('error', (networkError) => {
                reject(new ApiError(`Cloudflare API request failed: ${networkError.message}`, 'Cloudflare DNS', null, networkError));
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    /**
     * List DNS records for a zone
     */
    async listDnsRecords(filters = {}) {
        const params = new URLSearchParams(filters).toString();
        const endpoint = `${CLOUDFLARE_API.ENDPOINTS.DNS_RECORDS(this.zoneId)}${params ? `?${params}` : ''}`;
        return await this.makeRequest('GET', endpoint);
    }

    /**
     * Create or update DNS record
     */
    async updateDnsRecord(recordName, targetDomain, options = {}) {
        const { proxied = true, ttl = DEFAULT_DNS_TTL, dryRun = false } = options;

        const records = await this.listDnsRecords({ name: recordName, type: DNS_RECORD_TYPES.CNAME });
        const existingRecord = records.find(record => record.name === recordName);

        const recordData = {
            type: DNS_RECORD_TYPES.CNAME,
            name: recordName,
            content: targetDomain,
            ttl,
            proxied
        };

        if (dryRun) {
            const action = existingRecord ? 'update' : 'create';
            log.info(`[DRY-RUN] Would ${action} DNS record: ${recordName} -> ${targetDomain}`);
            return { action: `dry-run-${action}`, record: recordData };
        }

        if (existingRecord) {
            if (existingRecord.content === targetDomain && existingRecord.proxied === proxied) {
                log.info(`DNS record already up to date: ${recordName} -> ${targetDomain}`);
                return { action: 'no-change', record: existingRecord };
            }
            
            const updatedRecord = await this.makeRequest(
                'PUT', 
                `${CLOUDFLARE_API.ENDPOINTS.DNS_RECORDS(this.zoneId)}/${existingRecord.id}`,
                recordData
            );
            log.success(`✅ Updated DNS record: ${recordName} -> ${targetDomain}`);
            return { action: 'updated', record: updatedRecord };
        } else {
            const newRecord = await this.makeRequest(
                'POST', 
                CLOUDFLARE_API.ENDPOINTS.DNS_RECORDS(this.zoneId),
                recordData
            );
            log.success(`✅ Created DNS record: ${recordName} -> ${targetDomain}`);
            return { action: 'created', record: newRecord };
        }
    }

    /**
     * Delete DNS record
     */
    async deleteDnsRecord(recordName, options = {}) {
        const { dryRun = false } = options;

        const records = await this.listDnsRecords({ name: recordName });
        const existingRecord = records.find(record => record.name === recordName);

        if (!existingRecord) {
            log.info(`DNS record not found: ${recordName}`);
            return { action: 'not-found' };
        }

        if (dryRun) {
            log.info(`[DRY-RUN] Would delete DNS record: ${recordName}`);
            return { action: 'dry-run-delete', record: existingRecord };
        }

        await this.makeRequest('DELETE', `${CLOUDFLARE_API.ENDPOINTS.DNS_RECORDS(this.zoneId)}/${existingRecord.id}`);
        log.success(`✅ Deleted DNS record: ${recordName}`);
        return { action: 'deleted' };
    }
}

/**
 * Setup DNS for custom domain
 * CDK作成後のAPI Gatewayカスタムドメインに対してDNS設定を行う
 */
async function setupDnsForCustomDomain(config) {
    const startTime = Date.now();
    
    try {
        const { 
            environment, 
            targetDomain,  // API Gatewayカスタムドメインのリージョナルドメイン名
            profile,
            dryRun = false, 
            debug = false 
        } = config;

        if (dryRun) {
            log.warning('🧪 Running in DRY-RUN mode - no changes will be made');
        }

        displaySection('DNS Configuration');

        // Validate environment variables
        const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
        const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;

        if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
            throw new ConfigurationError('DNS setup requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID environment variables.');
        }

        // Initialize Cloudflare client
        const cloudflareClient = new CloudflareDnsClient(CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID);

        // Generate DNS record name
        const hostname = CUSTOM_DOMAINS.getApiDomain(environment);
        
        log.info(`Setting up DNS: ${hostname} -> ${targetDomain}`);

        // Update DNS record
        const result = await cloudflareClient.updateDnsRecord(hostname, targetDomain, {
            proxied: true,
            ttl: DEFAULT_DNS_TTL,
            dryRun,
            debug
        });

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        if (result.action === 'created' || result.action === 'updated') {
            log.complete(`✅ DNS setup completed in ${duration}s`);
            log.info(`API will be accessible at: https://${hostname}`);
        } else if (result.action === 'no-change') {
            log.info(`DNS already configured correctly (${duration}s)`);
        }

        return {
            success: true,
            hostname,
            targetDomain,
            action: result.action,
            duration
        };

    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        log.error(`DNS setup failed after ${duration}s: ${error.message}`);
        throw error;
    }
}

/**
 * Verify certificate exists in SSM before DNS setup
 */
async function verifyPrerequisites(config) {
    try {
        log.info('Verifying prerequisites...');

        // Check certificate ARN in SSM
        const certificateArn = await getCertificateArn({
            profile: config.profile,
            region: config.region,
            debug: config.debug
        });

        if (!certificateArn) {
            log.warning('⚠️  No certificate ARN found in SSM Parameter Store');
            log.info(`Run "Prepare Wildcard Certificate" first to create the certificate`);
            log.info(`Expected parameter: ${SSM_PARAMETERS.CERTIFICATE_ARN}`);
            return { ready: false, reason: 'missing-certificate' };
        }

        log.success(`✅ Certificate ARN found: ${certificateArn}`);
        return { ready: true, certificateArn };

    } catch (error) {
        log.error(`Failed to verify prerequisites: ${error.message}`);
        return { ready: false, reason: 'error', error };
    }
}

/**
 * List all API custom domains
 */
async function listApiDomains(config) {
    try {
        const { debug = false } = config;

        const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
        const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;

        if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
            throw new ConfigurationError('Listing domains requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID environment variables.');
        }

        const cloudflareClient = new CloudflareDnsClient(CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID);

        displaySection('Configured API Domains');

        // Check all possible API domains
        const possibleEnvs = [ENVIRONMENTS.DEV, ENVIRONMENTS.PROD];
        const results = [];

        for (const env of possibleEnvs) {
            const hostname = CUSTOM_DOMAINS.getApiDomain(env);
            const records = await cloudflareClient.listDnsRecords({ name: hostname });
            const record = records.find(r => r.name === hostname);

            if (record) {
                results.push({
                    environment: env,
                    hostname: record.name,
                    target: record.content,
                    proxied: record.proxied,
                    ttl: record.ttl
                });

                console.log(`\n${env.toUpperCase()} Environment:`);
                console.log(`   Hostname: ${record.name}`);
                console.log(`   Target: ${record.content}`);
                console.log(`   Proxied: ${record.proxied ? 'Yes' : 'No'}`);
            } else {
                log.debug(`No DNS record found for ${hostname}`, { debug });
            }
        }

        if (results.length === 0) {
            log.info('No API domains configured yet');
        }

        return results;

    } catch (error) {
        log.error(`Failed to list domains: ${error.message}`);
        throw error;
    }
}

module.exports = {
    setupDnsForCustomDomain,
    verifyPrerequisites,
    listApiDomains,
    CloudflareDnsClient
};