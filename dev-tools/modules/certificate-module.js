const https = require('https');
const forge = require('node-forge');
const { ACMClient, ImportCertificateCommand, ListCertificatesCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');
const { log, displaySection } = require('../lib/logger');
const { saveCertificateArn } = require('./ssm-module');
const { SSM_PARAMETERS, CERTIFICATE, CUSTOM_DOMAINS, AWS_REGIONS, CLOUDFLARE_API } = require('../lib/constants');
const { ConfigurationError, ApiError } = require('../lib/errors');

/**
 * ワイルドカード証明書管理モジュール
 * Cloudflare Origin CA証明書の作成とACMへのインポートを管理
 */

/**
 * Cloudflare API Client (証明書操作専用)
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

            // Origin CA API 認証
            if (this.authConfig.originCaKey) {
                headers['X-Auth-User-Service-Key'] = this.authConfig.originCaKey;
            } else if (this.authConfig.apiToken && endpoint.includes(CLOUDFLARE_API.ENDPOINTS.CERTIFICATES)) {
                // API Token でも証明書操作可能な場合
                headers['Authorization'] = `Bearer ${this.authConfig.apiToken}`;
            } else {
                reject(new ConfigurationError('No valid Cloudflare authentication provided for certificate operations. Set CLOUDFLARE_ORIGIN_CA_KEY or CLOUDFLARE_API_TOKEN.'));
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
                            reject(new ApiError(errors, 'Cloudflare Certificates', res.statusCode));
                        }
                    } catch (parseError) {
                        reject(new ApiError(`Failed to parse Cloudflare API response: ${parseError.message}`, 'Cloudflare Certificates', res.statusCode, parseError));
                    }
                });
            });

            req.on('error', (networkError) => {
                reject(new ApiError(`Cloudflare API request failed: ${networkError.message}`, 'Cloudflare Certificates', null, networkError));
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

    // 定数から閾値を取得
    if (daysUntilExpiration > CERTIFICATE.RENEWAL_THRESHOLD_DAYS) {
        return { 
            shouldRenew: false, 
            reason: 'valid',
            daysUntilExpiration 
        };
    }

    // 閾値以内の場合は更新推奨
    if (daysUntilExpiration <= CERTIFICATE.RENEWAL_THRESHOLD_DAYS) {
        return { 
            shouldRenew: true, 
            reason: 'approaching-expiration',
            daysUntilExpiration 
        };
    }

    // 期限切れ間近
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
        
        // *.sankey.trade を含む証明書を検索
        const wildcardCert = certificates.find(cert => {
            return cert.hostnames && cert.hostnames.some(h => h === CERTIFICATE.HOSTNAMES[0]); // Assuming '*.sankey.trade' is the first
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
            
            // ワイルドカード証明書を確認
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
        const cloudflareClient = new CloudflareClient(authConfig, CLOUDFLARE_ZONE_ID);
        
        // Set AWS profile for SDK
        if (profile) {
            process.env.AWS_PROFILE = profile;
        }
        
        const acmClient = new ACMClient({ region: region || AWS_REGIONS.DEFAULT });

        // Wildcard certificate hostnames
        const hostnames = CERTIFICATE.HOSTNAMES;
        log.info(`Target hostnames: ${hostnames.join(', ')}`);

        // Step 1: Check existing certificate
        displaySection('Origin Certificate Check');
        const existingCert = await findWildcardCertificate(cloudflareClient, { debug });

        let certificate, privateKey, certificateId;
        let renewalPerformed = false;

        if (existingCert) {
            // Check if renewal is needed
            const renewalCheck = shouldRenewCertificate(existingCert, { forceRenew: forceUpdate });

            if (!renewalCheck.shouldRenew) {
                log.success(`✅ Certificate is valid for ${renewalCheck.daysUntilExpiration} more days`);
                log.info('⏭️ Skipping certificate renewal');
                
                // Return existing certificate info
                return {
                    success: true,
                    certificateId: existingCert.id,
                    renewed: false,
                    daysUntilExpiration: renewalCheck.daysUntilExpiration,
                    message: 'Certificate is still valid'
                };
            }

            // Renewal needed
            log.warning(`⚠️ Certificate renewal required: ${renewalCheck.reason}`);
            
            if (!dryRun) {
                // Create new certificate
                const newCert = await cloudflareClient.createOriginCertificate(hostnames);
                certificate = newCert.certificate;
                privateKey = newCert.private_key;
                certificateId = newCert.id;
                renewalPerformed = true;
                
                log.success(`✅ Created new certificate: ${certificateId}`);
                
                // Try to revoke old certificate
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
            // No existing certificate
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
        
        // 証明書が更新された場合、または既存証明書でもACMにない場合はインポート
        if (renewalPerformed || !existingCert) {
            displaySection('AWS Certificate Manager');
            certificateArn = await importCertificateToAcm(
                acmClient,
                certificate,
                privateKey,
                CERTIFICATE.HOSTNAMES[0], // Assuming '*.sankey.trade'
                { dryRun, debug }
            );
        } else {
            // 既存証明書の場合、ACMに存在するか確認
            displaySection('AWS Certificate Manager Check');
            const existingAcmCert = await findExistingAcmCertificate(acmClient, CERTIFICATE.HOSTNAMES[0], { debug }); // Assuming '*.sankey.trade'
            
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

module.exports = {
    prepareWildcardCertificate,
    CloudflareClient,
    shouldRenewCertificate,
    findWildcardCertificate,
    findExistingAcmCertificate
};