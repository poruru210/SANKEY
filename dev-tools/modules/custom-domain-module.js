const https = require('https');
const { log, displaySection } = require('../lib/logger');
const forge = require('node-forge');

// AWS SDK v3 clients
const { ACMClient, ImportCertificateCommand, ListCertificatesCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');
const { APIGatewayClient, CreateDomainNameCommand, CreateBasePathMappingCommand, GetDomainNameCommand, GetBasePathMappingsCommand } = require('@aws-sdk/client-api-gateway');

/**
 * Delete API Gateway Custom Domain
 */
async function deleteApiGatewayCustomDomain(apiGatewayClient, domainName) {
    try {
        const { DeleteDomainNameCommand } = require('@aws-sdk/client-api-gateway');
        const command = new DeleteDomainNameCommand({ domainName });
        await apiGatewayClient.send(command);
        log.success(`Deleted custom domain: ${domainName}`);
        
        // Wait a bit for deletion to propagate
        await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
        if (error.name === 'NotFoundException') {
            log.debug(`Custom domain not found: ${domainName}`);
        } else {
            throw error;
        }
    }
}

/**
 * Cloudflare API Client for Origin CA and DNS operations
 */
class CloudflareClient {
    constructor(authConfig, zoneId) {
        this.authConfig = authConfig;
        this.zoneId = zoneId;
        this.baseUrl = 'https://api.cloudflare.com/client/v4';
    }

    /**
     * Make API request to Cloudflare
     */
    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        return new Promise((resolve, reject) => {
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'Sankey-Setup-Script/1.0'
            };

            // Set authentication headers based on auth type
            if (this.authConfig.originCaKey && endpoint.includes('/certificates')) {
                // Origin CA API 用の認証
                headers['X-Auth-User-Service-Key'] = this.authConfig.originCaKey;
            } else if (this.authConfig.apiToken) {
                // API Token 認証（DNS操作など）
                headers['Authorization'] = `Bearer ${this.authConfig.apiToken}`;
            } else {
                reject(new Error('No valid authentication configuration found for this operation'));
                return;
            }

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
                            const errors = parsed.errors?.map(e => `${e.code}: ${e.message}`).join(', ') || 'Unknown error';
                            reject(new Error(`Cloudflare API error: ${errors}`));
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
     * List all Origin CA certificates
     */
    async listOriginCertificates() {
        // Origin CA certificates require zone_id parameter
        return await this.makeRequest('GET', `/certificates?zone_id=${this.zoneId}`);
    }

    /**
     * Create a new Origin CA certificate
     */
    async createOriginCertificate(hostnames, validityDays = 365) {
        // CSR を生成
        const { csr, privateKey } = generateCSR(hostnames[0]);
        
        const data = {
            csr: csr,
            hostnames: hostnames,
            requested_validity: validityDays,
            request_type: 'origin-rsa'
        };

        const result = await this.makeRequest('POST', '/certificates', data);
        
        // 生成した秘密鍵を結果に追加
        return {
            ...result,
            private_key: privateKey
        };
    }

    /**
     * Get details of a specific Origin CA certificate
     */
    async getOriginCertificate(certificateId) {
        return await this.makeRequest('GET', `/certificates/${certificateId}`);
    }

    /**
     * Revoke an Origin CA certificate
     */
    async revokeOriginCertificate(certificateId) {
        return await this.makeRequest('DELETE', `/certificates/${certificateId}`);
    }

    /**
     * List DNS records for a zone
     */
    async listDnsRecords(zoneId, filters = {}) {
        const params = new URLSearchParams(filters).toString();
        const endpoint = `/zones/${zoneId}/dns_records${params ? `?${params}` : ''}`;
        return await this.makeRequest('GET', endpoint);
    }

    /**
     * Create or update DNS record
     */
    async updateDnsRecord(recordName, targetDomain) {
        const records = await this.listDnsRecords(this.zoneId, { name: recordName, type: 'CNAME' });
        const existingRecord = records.find(record => record.name === recordName);

        const recordData = {
            type: 'CNAME',
            name: recordName,
            content: targetDomain,
            ttl: 1,
            proxied: true
        };

        if (existingRecord) {
            if (existingRecord.content === targetDomain) {
                log.info(`DNS record already up to date: ${recordName} -> ${targetDomain}`);
                return { action: 'no-change', record: existingRecord };
            }
            
            const updatedRecord = await this.makeRequest('PUT', `/zones/${this.zoneId}/dns_records/${existingRecord.id}`, recordData);
            log.success(`Updated DNS record: ${recordName} -> ${targetDomain}`);
            return { action: 'updated', record: updatedRecord };
        } else {
            const newRecord = await this.makeRequest('POST', `/zones/${this.zoneId}/dns_records`, recordData);
            log.success(`Created DNS record: ${recordName} -> ${targetDomain}`);
            return { action: 'created', record: newRecord };
        }
    }
}

/**
 * Generate CSR for Cloudflare Origin CA
 */
function generateCSR(hostname) {
    // 鍵ペアを生成
    const keys = forge.pki.rsa.generateKeyPair(2048);
    
    // CSR を作成
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    
    // Subject を設定
    csr.setSubject([{
        name: 'commonName',
        value: hostname
    }, {
        name: 'countryName',
        value: 'JP'
    }, {
        name: 'organizationName',
        value: 'Sankey Trade'
    }]);
    
    // CSR に署名
    csr.sign(keys.privateKey);
    
    // PEM 形式に変換
    const csrPem = forge.pki.certificationRequestToPem(csr);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    return {
        csr: csrPem,
        privateKey: privateKeyPem
    };
}

/**
 * Generate DNS record name based on environment
 */
function generateDnsRecordName(environment, domain = 'sankey.trade') {
    if (environment === 'prod') {
        return `api.${domain}`;
    }
    return `api-${environment}.${domain}`;
}

/**
 * Check if certificate is near expiration
 */
function isCertificateNearExpiration(expiresOn, thresholdDays) {
    const expirationDate = new Date(expiresOn);
    const currentDate = new Date();
    const daysUntilExpiration = Math.ceil((expirationDate - currentDate) / (1000 * 60 * 60 * 24));
    
    return daysUntilExpiration <= thresholdDays;
}

/**
 * Find existing Origin Certificate for hostname
 */
async function findExistingOriginCertificate(cloudflareClient, hostname, options) {
    try {
        log.debug(`Searching for existing certificate for ${hostname}...`, options);
        const certificates = await cloudflareClient.listOriginCertificates();
        
        const matchingCert = certificates.find(cert => {
            return cert.hostnames && cert.hostnames.some(h => h === hostname);
        });

        if (matchingCert) {
            log.debug(`Found existing certificate: ${matchingCert.id}`, options);
        } else {
            log.debug(`No existing certificate found for ${hostname}`, options);
        }

        return matchingCert;
    } catch (error) {
        log.warning(`Failed to list certificates: ${error.message}`);
        return null;
    }
}

/**
 * Find existing certificate in AWS Certificate Manager
 */
async function findExistingAwsCertificate(acmClient, hostname, options) {
    try {
        log.debug(`Searching for existing ACM certificate for ${hostname}...`, options);
        
        const listCommand = new ListCertificatesCommand({
            CertificateStatuses: ['ISSUED', 'INACTIVE', 'EXPIRED']
        });
        const response = await acmClient.send(listCommand);

        for (const cert of response.CertificateSummaryList || []) {
            const describeCommand = new DescribeCertificateCommand({
                CertificateArn: cert.CertificateArn
            });
            const details = await acmClient.send(describeCommand);
            
            if (details.Certificate?.DomainName === hostname || 
                details.Certificate?.SubjectAlternativeNames?.includes(hostname)) {
                log.debug(`Found existing ACM certificate: ${cert.CertificateArn}`, options);
                return details.Certificate;
            }
        }
        
        log.debug(`No existing ACM certificate found for ${hostname}`, options);
        return null;
    } catch (error) {
        log.warning(`Failed to search ACM certificates: ${error.message}`);
        return null;
    }
}

/**
 * Create or check Origin Certificate
 */
async function createOrCheckOriginCertificate(cloudflareClient, hostname, options) {
    const renewalThreshold = parseInt(options.renewThreshold || 30);
    
    const existingCert = await findExistingOriginCertificate(cloudflareClient, hostname, options);

    if (existingCert) {
        const daysUntilExpiration = Math.ceil((new Date(existingCert.expires_on) - new Date()) / (1000 * 60 * 60 * 24));

        log.info(`Existing certificate expires in ${daysUntilExpiration} days`);

        // 期限チェックを最優先（90日以上残っていて強制更新でない場合はスキップ）
        if (daysUntilExpiration > 90 && !options.forceRenew) {
            log.success(`Certificate is valid for ${daysUntilExpiration} more days, skipping renewal`);
            return { 
                ...existingCert, 
                renewalSkipped: true,
                daysUntilExpiration
            };
        }

        // 90日以下または強制更新の場合は更新処理
        const isNearExpiration = isCertificateNearExpiration(existingCert.expires_on, renewalThreshold);

        const reason = options.forceRenew ? 'force renewal requested' : 
                      isNearExpiration ? `expires in ${daysUntilExpiration} days` :
                      'private key not available';
        
        log.warning(`Certificate renewal required: ${reason}`);

        if (!options.dryRun) {
            // Create new certificate
            const newCert = await cloudflareClient.createOriginCertificate([hostname]);
            log.success(`Created new certificate: ${newCert.id}`);
            
            // Store the mapping for future reference
            log.info(`New certificate replaces: ${existingCert.id}`);
            
            // Try to revoke old certificate
            try {
                await cloudflareClient.revokeOriginCertificate(existingCert.id);
                log.success(`Revoked old certificate: ${existingCert.id}`);
            } catch (error) {
                log.warning(`Failed to revoke old certificate: ${error.message}`);
            }
            
            return { ...newCert, renewalSkipped: false };
        } else {
            log.info(`[DRY-RUN] Would renew certificate (${reason})`);
            return {
                id: 'dry-run-cert-id',
                certificate: 'dry-run-certificate',
                private_key: 'dry-run-private-key',
                hostnames: [hostname],
                renewalSkipped: false
            };
        }
    } else {
        log.info(`No existing certificate found for ${hostname}`);
        
        if (!options.dryRun) {
            const newCert = await cloudflareClient.createOriginCertificate([hostname]);
            log.success(`Created new certificate: ${newCert.id}`);
            return { ...newCert, renewalSkipped: false };
        } else {
            log.info(`[DRY-RUN] Would create new certificate`);
            return {
                id: 'dry-run-cert-id',
                certificate: 'dry-run-certificate',
                private_key: 'dry-run-private-key',
                hostnames: [hostname],
                renewalSkipped: false
            };
        }
    }
}

/**
 * Import certificate to AWS Certificate Manager
 */
async function importCertificateToAws(acmClient, certificate, privateKey, hostname, options) {
    log.info(`Importing certificate to AWS Certificate Manager...`);

    const existingAwsCert = await findExistingAwsCertificate(acmClient, hostname, options);

    if (!options.dryRun) {
        const command = new ImportCertificateCommand({
            Certificate: Buffer.from(certificate),
            PrivateKey: Buffer.from(privateKey),
            CertificateArn: existingAwsCert?.CertificateArn
        });

        const response = await acmClient.send(command);
        const action = existingAwsCert ? 'Updated' : 'Imported';
        log.success(`${action} certificate in ACM: ${response.CertificateArn}`);
        return response.CertificateArn;
    } else {
        const action = existingAwsCert ? 'update' : 'import';
        log.info(`[DRY-RUN] Would ${action} certificate to ACM`);
        return existingAwsCert?.CertificateArn || 'arn:aws:acm:region:account:certificate/dry-run-cert-id';
    }
}

/**
 * Create or get API Gateway Custom Domain
 */
async function createApiGatewayCustomDomain(apiGatewayClient, domainName, certificateArn, region, options) {
    log.info(`Setting up API Gateway Custom Domain: ${domainName}...`);

    try {
        const getCommand = new GetDomainNameCommand({ domainName });
        const existingDomain = await apiGatewayClient.send(getCommand);
        
        log.success(`Custom domain already exists: ${existingDomain.domainName}`);
        return existingDomain;
        
    } catch (error) {
        if (error.name === 'NotFoundException') {
            if (!options.dryRun) {
                const createCommand = new CreateDomainNameCommand({
                    domainName,
                    regionalCertificateArn: certificateArn,
                    endpointConfiguration: {
                        types: ['REGIONAL']
                    },
                    securityPolicy: 'TLS_1_2'
                });

                const response = await apiGatewayClient.send(createCommand);
                log.success(`Created custom domain: ${response.domainName}`);
                return response;
            } else {
                log.info(`[DRY-RUN] Would create custom domain: ${domainName}`);
                return { 
                    domainName, 
                    regionalDomainName: `d-dry-run.execute-api.${region}.amazonaws.com` 
                };
            }
        } else {
            throw error;
        }
    }
}

/**
 * Create API mapping
 */
async function createApiMapping(apiGatewayClient, domainName, apiId, stage, options) {
    log.info(`Creating API mapping: ${domainName} -> ${apiId}/${stage}...`);

    try {
        // Check if mapping already exists
        const getMappingsCommand = new GetBasePathMappingsCommand({ domainName });
        const mappings = await apiGatewayClient.send(getMappingsCommand);
        
        const existingMapping = mappings.items?.find(m => 
            m.restApiId === apiId && m.stage === stage
        );

        if (existingMapping) {
            log.success(`API mapping already exists`);
            return;
        }
    } catch (error) {
        // Continue if listing fails
        log.debug(`Could not list existing mappings: ${error.message}`, options);
    }

    if (!options.dryRun) {
        try {
            const command = new CreateBasePathMappingCommand({
                domainName,
                restApiId: apiId,
                stage
            });

            await apiGatewayClient.send(command);
            log.success(`Created API mapping`);
        } catch (error) {
            if (error.name === 'ConflictException') {
                log.success(`API mapping already exists`);
            } else {
                throw error;
            }
        }
    } else {
        log.info(`[DRY-RUN] Would create API mapping`);
    }
}

/**
 * Main function to setup custom domain
 */
async function setupCustomDomain(config) {
    const startTime = Date.now();
    
    try {
        const { 
            awsConfig, 
            environment, 
            profile, 
            region, 
            dryRun = false, 
            forceRenew = false, 
            debug = false 
        } = config;

        // リージョンの決定（優先順位: 引数 > awsConfig > デフォルト）
        const awsRegion = region || awsConfig?.region || 'ap-northeast-1';

        if (dryRun) {
            log.warning('Running in DRY-RUN mode - no changes will be made');
        }

        displaySection('Custom Domain Setup');

        // Validate environment variables
        const authConfig = {};
        
        if (process.env.CLOUDFLARE_ORIGIN_CA_KEY) {
            authConfig.originCaKey = process.env.CLOUDFLARE_ORIGIN_CA_KEY;
            log.debug('Using Origin CA Key authentication for certificates', { debug });
        }
        
        if (process.env.CLOUDFLARE_API_TOKEN) {
            authConfig.apiToken = process.env.CLOUDFLARE_API_TOKEN;
            log.debug('Using API Token for DNS operations', { debug });
        }
        
        if (!authConfig.originCaKey && !authConfig.apiToken) {
            throw new Error('Missing Cloudflare authentication. Set CLOUDFLARE_ORIGIN_CA_KEY and/or CLOUDFLARE_API_TOKEN');
        }

        const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
        if (!CLOUDFLARE_ZONE_ID) {
            throw new Error('CLOUDFLARE_ZONE_ID environment variable is required');
        }
        
        // DNS 操作には API Token が必須
        if (!authConfig.apiToken) {
            throw new Error('DNS operations require CLOUDFLARE_API_TOKEN environment variable');
        }

        // Initialize clients
        const cloudflareClient = new CloudflareClient(authConfig, CLOUDFLARE_ZONE_ID);
        
        // AWS SDK v3 - SSO プロファイルを環境変数で設定
        if (profile) {
            process.env.AWS_PROFILE = profile;
        }
        
        // AWS SDK は自動的に SSO 認証情報を解決
        const acmClient = new ACMClient({ 
            region: awsRegion
        });
        const apiGatewayClient = new APIGatewayClient({ 
            region: awsRegion
        });

        // Prepare configuration
        const hostname = generateDnsRecordName(environment);
        const stage = environment === 'prod' ? 'prod' : environment;

        log.info(`Target: ${hostname} -> ${awsConfig.ApiId}/${stage}`);

        // Step 1: Origin Certificate
        displaySection('Origin Certificate');
        const originCert = await createOrCheckOriginCertificate(cloudflareClient, hostname, {
            renewThreshold: 30,
            forceRenew,
            dryRun,
            debug
        });

        let certificateArn = null;

        // Step 2: Import to ACM (証明書が更新された場合のみ)
        if (!originCert.renewalSkipped) {
            if (!originCert.certificate || !originCert.private_key) {
                throw new Error('Failed to obtain valid Origin Certificate');
            }

            displaySection('AWS Certificate Manager');
            certificateArn = await importCertificateToAws(
                acmClient,
                originCert.certificate,
                originCert.private_key,
                hostname,
                { dryRun, debug }
            );
        } else {
            log.info('⏭️ Skipping ACM import (certificate not renewed)');
            // 既存の証明書ARNを取得（API Gateway用）
            const existingAwsCert = await findExistingAwsCertificate(acmClient, hostname, { debug });
            certificateArn = existingAwsCert?.CertificateArn;
        }

        // Step 3: API Gateway Custom Domain (証明書ARNがある場合のみ)
        displaySection('API Gateway Custom Domain');
        let customDomain = null;
        if (certificateArn) {
            customDomain = await createApiGatewayCustomDomain(
                apiGatewayClient,
                hostname,
                certificateArn,
                awsRegion,
                { dryRun, debug }
            );

            // Step 4: API Mapping
            await createApiMapping(
                apiGatewayClient,
                hostname,
                awsConfig.ApiId,
                stage,
                { dryRun, debug }
            );
        } else {
            log.warning('⚠️ No certificate ARN available, skipping API Gateway setup');
        }

        // Step 5: DNS Update
        displaySection('DNS Configuration');
        if (customDomain) {
            const targetDomain = customDomain.regionalDomainName || customDomain.distributionDomainName;
            
            if (!dryRun) {
                await cloudflareClient.updateDnsRecord(hostname, targetDomain);
            } else {
                log.info(`[DRY-RUN] Would update DNS: ${hostname} -> ${targetDomain}`);
            }
        } else {
            log.info('⏭️ Skipping DNS update (no custom domain created)');
        }

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        displaySection('Setup Complete', 'green');
        
        const result = {
            hostname,
            targetDomain: customDomain?.regionalDomainName || customDomain?.distributionDomainName,
            certificateId: originCert.id,
            certificateArn,
            certificateRenewed: !originCert.renewalSkipped
        };

        log.complete(`Custom domain setup completed in ${duration}s`);
        if (!originCert.renewalSkipped) {
            log.info(`Access your API at: https://${hostname}`);
        } else {
            log.info(`Certificate renewal skipped (${originCert.daysUntilExpiration} days remaining)`);
        }

        return result;

    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        log.error(`Custom domain setup failed after ${duration}s: ${error.message}`);
        throw error;
    }
}

module.exports = {
    setupCustomDomain,
    generateDnsRecordName,
    CloudflareClient
};