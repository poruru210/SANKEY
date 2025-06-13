/**
 * Cloudflare統合サービスモジュール
 * certificate-module + custom-domain-module を統合
 */

const https = require('https');
const forge = require('node-forge');
const { ACMClient, ImportCertificateCommand, ListCertificatesCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');
const { log, displaySection } = require('../core/utils');
const { saveCertificateArn, getCertificateArn } = require('./aws');
const { 
    SSM_PARAMETERS, 
    CERTIFICATE, 
    CUSTOM_DOMAINS, 
    AWS_REGIONS, 
    CLOUDFLARE_API,
    DNS_RECORD_TYPES,
    DEFAULT_DNS_TTL
} = require('../core/constants');
const { ConfigurationError, ApiError } = require('../core/errors');

// ============================================================
// Cloudflare API Client 基底クラス
// ============================================================

/**
 * Cloudflare API Client
 */
class CloudflareClient {
    constructor(authConfig, zoneId) {
        this.authConfig = authConfig;
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
                'User-Agent': CLOUDFLARE_API.USER_AGENT
            };

            // 認証設定
            if (this.authConfig.originCaKey && endpoint.includes(CLOUDFLARE_API.ENDPOINTS.CERTIFICATES)) {
                headers['X-Auth-User-Service-Key'] = this.authConfig.originCaKey;
            } else if (this.authConfig.apiToken) {
                headers['Authorization'] = `Bearer ${this.authConfig.apiToken}`;
            } else {
                reject(new ConfigurationError('No valid Cloudflare authentication provided. Set CLOUDFLARE_ORIGIN_CA_KEY or CLOUDFLARE_API_TOKEN.'));
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
                            const errors = parsed.errors?.map(e => `${e.code}: ${e.message}`).join(', ') || `Status ${res.statusCode} - Unknown Cloudflare error`;
                            reject(new ApiError(errors, 'Cloudflare', res.statusCode));
                        }
                    } catch (parseError) {
                        reject(new ApiError(`Failed to parse Cloudflare API response: ${parseError.message}`, 'Cloudflare', res.statusCode, parseError));
                    }
                });
            });

            req.on('error', (networkError) => {
                reject(new ApiError(`Cloudflare API request failed: ${networkError.message}`, 'Cloudflare', null, networkError));
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }
}

// ============================================================
// 証明書管理 (旧 certificate-module.js)
// ============================================================

/**
 * Origin CA 証明書操作
 */
class CloudflareCertificateClient extends CloudflareClient {
    /**
     * List all Origin CA certificates
     */
    async listOriginCertificates() {
        return await this.makeRequest('GET', `${CLOUDFLARE_API.ENDPOINTS.CERTIFICATES}?zone_id=${this.zoneId}`);
    }

    /**
     * Create a new Origin CA certificate
     */
    async createOriginCertificate(hostnames, validityDays = CERTIFICATE.VALIDITY_DAYS) {
        const { csr, privateKey } = generateCSR(hostnames[0]);
        
        const data = {
            csr: csr,
            hostnames: hostnames,
            requested_validity: validityDays,
            request_type: 'origin-rsa'
        };

        const result = await this.makeRequest('POST', CLOUDFLARE_API.ENDPOINTS.CERTIFICATES, data);
        
        return {
            ...result,
            private_key: privateKey
        };
    }

    /**
     * Get details of a specific Origin CA certificate
     */
    async getOriginCertificate(certificateId) {
        return await this.makeRequest('GET', `${CLOUDFLARE_API.ENDPOINTS.CERTIFICATES}/${certificateId}`);
    }

    /**
     * Revoke an Origin CA certificate
     */
    async revokeOriginCertificate(certificateId) {
        return await this.makeRequest('DELETE', `${CLOUDFLARE_API.ENDPOINTS.CERTIFICATES}/${certificateId}`);
    }
}

/**
 * Generate CSR for Cloudflare Origin CA
 */
function generateCSR(hostname) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    
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
    
    csr.sign(keys.privateKey);
    
    const csrPem = forge.pki.certificationRequestToPem(csr);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    return {
        csr: csrPem,
        privateKey: privateKeyPem
    };
}

/**
 * Check if certificate is near expiration or needs renewal
 */
function shouldRenewCertificate(certificate, options = {}) {
    const { forceRenew = false, renewalThreshold = 30 } = options;

    if (forceRenew) {
        log.info('Force renewal requested');
        return { shouldRenew: true, reason: 'force-renewal' };
    }

    const expirationDate = new Date(certificate.expires_on);
    const currentDate = new Date();
    const daysUntilExpiration = Math.ceil((expirationDate - currentDate) / (1000 * 60 * 60 * 24));

    log.info(`Certificate expires in ${daysUntilExpiration} days`);

    if (daysUntilExpiration > CERTIFICATE.RENEWAL_THRESHOLD_DAYS) {
        return { 
            shouldRenew: false, 
            reason: 'valid',
            daysUntilExpiration 
        };
    }

    if (daysUntilExpiration <= CERTIFICATE.RENEWAL_THRESHOLD_DAYS) {
        return { 
            shouldRenew: true, 
            reason: 'approaching-expiration',
            daysUntilExpiration 
        };
    }

    if (daysUntilExpiration <= renewalThreshold) {
        return { 
            shouldRenew: true, 
            reason: 'near-expiration',
            daysUntilExpiration 
        };
    }

    return { 
        shouldRenew: false, 
        reason: 'valid',
        daysUntilExpiration 
    };
}

/**
 * Find existing wildcard certificate
 */
async function findWildcardCertificate(cloudflareClient, options = {}) {
    try {
        log.debug('Searching for existing wildcard certificate...', options);
        const certificates = await cloudflareClient.listOriginCertificates();
        
        const wildcardCert = certificates.find(cert => {
            return cert.hostnames && cert.hostnames.some(h => h === CERTIFICATE.HOSTNAMES[0]);
        });

        if (wildcardCert) {
            log.debug(`Found existing certificate: ${wildcardCert.id}`, options);
            return wildcardCert;
        }

        log.debug('No existing wildcard certificate found', options);
        return null;

    } catch (error) {
        log.warning(`Failed to list certificates: ${error.message}`);
        return null;
    }
}

/**
 * Find existing certificate in AWS ACM
 */
async function findExistingAcmCertificate(acmClient, hostname, options = {}) {
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
        
        log.debug('No existing ACM certificate found', options);
        return null;

    } catch (error) {
        log.warning(`Failed to search ACM certificates: ${error.message}`);
        return null;
    }
}

/**
 * Import certificate to AWS ACM
 */
async function importCertificateToAcm(acmClient, certificate, privateKey, hostname, options = {}) {
    const { dryRun = false } = options;

    log.info('Importing certificate to AWS Certificate Manager...');

    const existingCert = await findExistingAcmCertificate(acmClient, hostname, options);

    if (dryRun) {
        const action = existingCert ? 'update' : 'import';
        log.info(`[DRY-RUN] Would ${action} certificate to ACM`);
        return existingCert?.CertificateArn || 'arn:aws:acm:region:account:certificate/dry-run-cert-id';
    }

    const command = new ImportCertificateCommand({
        Certificate: Buffer.from(certificate),
        PrivateKey: Buffer.from(privateKey),
        CertificateArn: existingCert?.CertificateArn
    });

    const response = await acmClient.send(command);
    const action = existingCert ? 'Updated' : 'Imported';
    log.success(`✅ ${action} certificate in ACM: ${response.CertificateArn}`);
    
    return response.CertificateArn;
}

/**
 * Prepare wildcard certificate (main function)
 */
async function prepareWildcardCertificate(config) {
    const startTime = Date.now();
    
    try {
        const { 
            profile, 
            region, 
            dryRun = false, 
            forceUpdate = false, 
            debug = false 
        } = config;

        if (dryRun) {
            log.warning('🧪 Running in DRY-RUN mode - no changes will be made');
        }

        displaySection('Wildcard Certificate Preparation');

        // Validate environment variables
        const authConfig = {};
        
        if (process.env.CLOUDFLARE_ORIGIN_CA_KEY) {
            authConfig.originCaKey = process.env.CLOUDFLARE_ORIGIN_CA_KEY;
            log.debug('Using Origin CA Key authentication', { debug });
        } else if (process.env.CLOUDFLARE_API_TOKEN) {
            authConfig.apiToken = process.env.CLOUDFLARE_API_TOKEN;
            log.debug('Using API Token authentication', { debug });
        } else {
            throw new ConfigurationError('Missing Cloudflare authentication environment variables. Set CLOUDFLARE_ORIGIN_CA_KEY or CLOUDFLARE_API_TOKEN.');
        }

        const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
        if (!CLOUDFLARE_ZONE_ID) {
            throw new ConfigurationError('CLOUDFLARE_ZONE_ID environment variable is required.');
        }

        // Initialize clients
        const cloudflareClient = new CloudflareCertificateClient(authConfig, CLOUDFLARE_ZONE_ID);
        
        if (profile) {
            process.env.AWS_PROFILE = profile;
        }
        
        const acmClient = new ACMClient({ region: region || AWS_REGIONS.DEFAULT });

        const hostnames = CERTIFICATE.HOSTNAMES;
        log.info(`Target hostnames: ${hostnames.join(', ')}`);

        // Step 1: Check existing certificate
        displaySection('Origin Certificate Check');
        const existingCert = await findWildcardCertificate(cloudflareClient, { debug });

        let certificate, privateKey, certificateId;
        let renewalPerformed = false;

        if (existingCert) {
            const renewalCheck = shouldRenewCertificate(existingCert, { forceRenew: forceUpdate });

            if (!renewalCheck.shouldRenew) {
                log.success(`✅ Certificate is valid for ${renewalCheck.daysUntilExpiration} more days`);
                log.info('⏭️ Skipping certificate renewal');
                
                return {
                    success: true,
                    certificateId: existingCert.id,
                    renewed: false,
                    daysUntilExpiration: renewalCheck.daysUntilExpiration,
                    message: 'Certificate is still valid'
                };
            }

            log.warning(`⚠️ Certificate renewal required: ${renewalCheck.reason}`);
            
            if (!dryRun) {
                const newCert = await cloudflareClient.createOriginCertificate(hostnames);
                certificate = newCert.certificate;
                privateKey = newCert.private_key;
                certificateId = newCert.id;
                renewalPerformed = true;
                
                log.success(`✅ Created new certificate: ${certificateId}`);
                
                try {
                    await cloudflareClient.revokeOriginCertificate(existingCert.id);
                    log.success(`✅ Revoked old certificate: ${existingCert.id}`);
                } catch (error) {
                    log.warning(`Failed to revoke old certificate: ${error.message}`);
                }
            } else {
                log.info('[DRY-RUN] Would create new certificate and revoke old one');
                certificate = 'dry-run-certificate';
                privateKey = 'dry-run-private-key';
                certificateId = 'dry-run-cert-id';
            }
        } else {
            log.info('No existing wildcard certificate found');
            
            if (!dryRun) {
                const newCert = await cloudflareClient.createOriginCertificate(hostnames);
                certificate = newCert.certificate;
                privateKey = newCert.private_key;
                certificateId = newCert.id;
                renewalPerformed = true;
                
                log.success(`✅ Created new certificate: ${certificateId}`);
            } else {
                log.info('[DRY-RUN] Would create new certificate');
                certificate = 'dry-run-certificate';
                privateKey = 'dry-run-private-key';
                certificateId = 'dry-run-cert-id';
            }
        }

        // Step 2: Import to ACM
        let certificateArn = null;
        
        if (renewalPerformed || !existingCert) {
            displaySection('AWS Certificate Manager');
            certificateArn = await importCertificateToAcm(
                acmClient,
                certificate,
                privateKey,
                CERTIFICATE.HOSTNAMES[0],
                { dryRun, debug }
            );
        } else {
            displaySection('AWS Certificate Manager Check');
            const existingAcmCert = await findExistingAcmCertificate(acmClient, CERTIFICATE.HOSTNAMES[0], { debug });
            
            if (existingAcmCert) {
                certificateArn = existingAcmCert.CertificateArn;
                log.success(`✅ Certificate already imported in ACM: ${certificateArn}`);
            } else {
                log.warning('⚠️ Certificate exists in Cloudflare but not in ACM');
                log.info('Cannot import certificate without private key');
                log.info('Please run with --force-update to renew and import certificate');
                
                return {
                    success: false,
                    certificateId: existingCert.id,
                    error: 'certificate-not-in-acm',
                    message: 'Certificate needs to be imported to ACM. Use --force-update to renew.'
                };
            }
        }

        // Step 3: Save to SSM Parameter Store
        if (certificateArn) {
            displaySection('SSM Parameter Store');
            const ssmResult = await saveCertificateArn({
                certificateArn,
                profile,
                region,
                dryRun,
                forceUpdate: true,
                debug
            });

            if (ssmResult.success) {
                log.success(`✅ Certificate ARN saved to SSM: ${SSM_PARAMETERS.CERTIFICATE_ARN}`);
            }
        }

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        displaySection('Certificate Preparation Complete', 'green');
        
        const result = {
            success: true,
            certificateId,
            certificateArn,
            renewed: renewalPerformed,
            duration
        };

        log.complete(`✅ Certificate preparation completed in ${duration}s`);
        
        if (renewalPerformed) {
            console.log('\n📋 Summary:');
            console.log(`   Certificate ID: ${certificateId}`);
            console.log(`   Certificate ARN: ${certificateArn}`);
            console.log(`   SSM Parameter: ${SSM_PARAMETERS.CERTIFICATE_ARN}`);
            console.log('\n🚀 Next steps:');
            console.log('   1. Update your CDK code to use the certificate ARN from SSM');
            console.log('   2. Deploy your CDK stacks');
        }

        return result;

    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        log.error(`Certificate preparation failed after ${duration}s: ${error.message}`);
        throw error;
    }
}

// ============================================================
// DNS管理 (旧 custom-domain-module.js)
// ============================================================

/**
 * DNS操作用クライアント
 */
class CloudflareDnsClient extends CloudflareClient {
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
 */
async function setupDnsForCustomDomain(config) {
    const startTime = Date.now();
    
    try {
        const { 
            environment, 
            customDomainName,
            targetDomain,
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
        const cloudflareClient = new CloudflareDnsClient({ apiToken: CLOUDFLARE_API_TOKEN }, CLOUDFLARE_ZONE_ID);

        log.info(`Setting up DNS: ${customDomainName} -> ${targetDomain}`);

        // Update DNS record
        const result = await cloudflareClient.updateDnsRecord(customDomainName, targetDomain, {
            proxied: true,
            ttl: DEFAULT_DNS_TTL,
            dryRun,
            debug
        });

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        
        if (result.action === 'created' || result.action === 'updated') {
            log.complete(`✅ DNS setup completed in ${duration}s`);
            log.info(`API will be accessible at: https://${customDomainName}`);
        } else if (result.action === 'no-change') {
            log.info(`DNS already configured correctly (${duration}s)`);
        }

        return {
            success: true,
            hostname: customDomainName,
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

// エクスポート
module.exports = {
    // 証明書管理
    prepareWildcardCertificate,
    
    // DNS管理
    setupDnsForCustomDomain
};