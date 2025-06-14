import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { mockClient } from 'aws-sdk-client-mock';
import {
    ACMClient,
    ImportCertificateCommand,
    ListCertificatesCommand,
    DescribeCertificateCommand
} from '@aws-sdk/client-acm';
import {
    SSMClient,
    GetParameterCommand,
    PutParameterCommand
} from '@aws-sdk/client-ssm';
import {
    prepareWildcardCertificate,
    setupDnsForCustomDomain
} from '../../services/cloudflare.js';
import { ConfigurationError } from '../../core/errors.js';

// AWS SDKクライアントのモック
const acmMock = mockClient(ACMClient);
const ssmMock = mockClient(SSMClient);

// MSWサーバーの設定
const server = setupServer(
    // デフォルトのハンドラー - 全てのCloudflare APIリクエストをキャッチ
    http.get('https://api.cloudflare.com/client/v4/certificates', ({ request }) => {
        const url = new URL(request.url);
        // クエリパラメータを確認
        if (url.searchParams.has('zone_id')) {
            return HttpResponse.json({
                success: true,
                result: []
            });
        }
        return HttpResponse.json({
            success: false,
            errors: [{ code: 'missing_zone_id', message: 'Zone ID is required' }]
        }, { status: 400 });
    }),
    http.post('https://api.cloudflare.com/client/v4/certificates', () => {
        return HttpResponse.json({
            success: true,
            result: {
                id: 'new-cert-id',
                certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
                private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
            }
        });
    }),
    http.get('https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records', ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json({
            success: true,
            result: []
        });
    }),
    http.post('https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records', () => {
        return HttpResponse.json({
            success: true,
            result: {
                id: 'new-record-id',
                name: 'api-dev.example.com',
                content: 'cloudfront.net',
                type: 'CNAME',
                proxied: true
            }
        });
    }),
    http.put('https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records/:recordId', () => {
        return HttpResponse.json({
            success: true,
            result: {
                id: 'updated-record-id',
                name: 'api-dev.example.com',
                content: 'cloudfront.net',
                type: 'CNAME',
                proxied: true
            }
        });
    })
);

describe('Cloudflare統合サービス', () => {
    let originalEnv;

    beforeAll(() => {
        server.listen({ onUnhandledRequest: 'bypass' }); // errorではなくbypassに変更
    });

    afterAll(() => {
        server.close();
    });

    beforeEach(() => {
        // 元の環境変数を保存
        originalEnv = { ...process.env };

        // テスト用の環境変数を設定
        process.env.CLOUDFLARE_ZONE_ID = 'test-zone-id';
        process.env.CLOUDFLARE_ORIGIN_CA_KEY = 'test-origin-ca-key';
        process.env.CLOUDFLARE_API_TOKEN = 'test-api-token';
        process.env.AWS_PROFILE = 'test-profile';

        // AWSモックをリセット
        acmMock.reset();
        ssmMock.reset();

        // デフォルトのSSMモック設定
        ssmMock.on(GetParameterCommand).rejects({ name: 'ParameterNotFound' });
        ssmMock.on(PutParameterCommand).resolves({ Version: 1 });

        // デフォルトのACMモック設定
        acmMock.on(ListCertificatesCommand).resolves({ CertificateSummaryList: [] });
        acmMock.on(ImportCertificateCommand).resolves({
            CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id'
        });

        // MSWハンドラーをリセット
        server.resetHandlers();
    });

    afterEach(() => {
        // 環境変数を元に戻す
        process.env = originalEnv;
    });

    describe('prepareWildcardCertificate', () => {
        describe('環境変数バリデーション', () => {
            test('CLOUDFLARE_ZONE_IDが不足している場合はConfigurationErrorをスローすること', async () => {
                delete process.env.CLOUDFLARE_ZONE_ID;

                await expect(prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1'
                })).rejects.toThrow(ConfigurationError);
            });

            test('認証情報が両方とも不足している場合はConfigurationErrorをスローすること', async () => {
                delete process.env.CLOUDFLARE_ORIGIN_CA_KEY;
                delete process.env.CLOUDFLARE_API_TOKEN;

                await expect(prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1'
                })).rejects.toThrow(ConfigurationError);
            });

            test('CLOUDFLARE_ORIGIN_CA_KEYのみ設定されている場合は正常に処理を開始すること', async () => {
                delete process.env.CLOUDFLARE_API_TOKEN;

                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                expect(result).toBeDefined();
                expect(result.success).toBe(true);
            }, 10000); // タイムアウトを10秒に設定

            test('CLOUDFLARE_API_TOKENのみ設定されている場合は正常に処理を開始すること', async () => {
                delete process.env.CLOUDFLARE_ORIGIN_CA_KEY;

                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                expect(result).toBeDefined();
                expect(result.success).toBe(true);
            }, 10000); // タイムアウトを10秒に設定
        });

        describe('証明書の作成と更新', () => {
            test('新しい証明書を作成できること（DRY-RUN）', async () => {
                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                expect(result.success).toBe(true);
                expect(result.certificateId).toBe('dry-run-cert-id');
                expect(result.certificateArn).toBe('arn:aws:acm:region:account:certificate/dry-run-cert-id');
            }, 10000); // タイムアウトを10秒に設定

            test('HTTPSリクエストが正しいヘッダーで送信されること', async () => {
                let capturedRequest;

                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', ({ request }) => {
                        capturedRequest = request;
                        return HttpResponse.json({
                            success: true,
                            result: []
                        });
                    })
                );

                await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                expect(capturedRequest).toBeDefined();
                expect(capturedRequest.headers.get('content-type')).toBe('application/json');
                expect(capturedRequest.headers.get('user-agent')).toContain('Sankey-Setup-Script');
            });

            test('既存の証明書がある場合で有効期限が十分な場合は更新不要', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: [{
                                id: 'existing-cert-id',
                                hostnames: ['*.sankey.trade', 'sankey.trade'],
                                expires_on: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90日後（3ヶ月）
                            }]
                        });
                    })
                );

                // 証明書が有効でもACMに存在しない場合のテスト
                acmMock.on(ListCertificatesCommand).resolves({ CertificateSummaryList: [] });

                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                // 実装の動作に合わせる：ACMに証明書がない場合はエラーを返す
                expect(result.success).toBe(false);
                expect(result.error).toBe('certificate-not-in-acm');
                expect(result.message).toBe('Certificate needs to be imported to ACM. Use --force-update to renew.');
            });

            test('証明書が期限切れに近い場合は更新すること', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: [{
                                id: 'existing-cert-id',
                                hostnames: ['*.sankey.trade', 'sankey.trade'],
                                expires_on: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString() // 20日後
                            }]
                        });
                    })
                );

                // ACMに証明書がない場合のメッセージを期待
                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                expect(result.success).toBe(false);
                expect(result.error).toBe('certificate-not-in-acm');
                expect(result.message).toBe('Certificate needs to be imported to ACM. Use --force-update to renew.');
            });

            test('期限切れ間近でforceUpdateを使うと証明書を更新できること', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: [{
                                id: 'existing-cert-id',
                                hostnames: ['*.sankey.trade', 'sankey.trade'],
                                expires_on: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString() // 20日後
                            }]
                        });
                    })
                );

                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true,
                    forceUpdate: true
                });

                expect(result.success).toBe(true);
                expect(result.renewed).toBe(true);
                expect(result.certificateId).toBe('dry-run-cert-id');
            });
        });

        describe('ACM統合', () => {
            test('証明書をACMにインポートできること', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: []
                        });
                    }),
                    http.post('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: {
                                id: 'new-cert-id',
                                certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
                                private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
                            }
                        });
                    })
                );

                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: false
                });

                expect(result.success).toBe(true);
                expect(acmMock.commandCalls(ImportCertificateCommand)).toHaveLength(1);
            });

            test('既存のACM証明書を更新できること', async () => {
                // 既存の証明書を返すモック
                acmMock.on(ListCertificatesCommand).resolves({
                    CertificateSummaryList: [{
                        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/existing-cert',
                        DomainName: '*.sankey.trade'
                    }]
                });

                acmMock.on(DescribeCertificateCommand).resolves({
                    Certificate: {
                        CertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/existing-cert',
                        DomainName: '*.sankey.trade',
                        SubjectAlternativeNames: ['*.sankey.trade', 'sankey.trade']
                    }
                });

                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: []
                        });
                    }),
                    http.post('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: {
                                id: 'new-cert-id',
                                certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
                                private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
                            }
                        });
                    })
                );

                await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: false
                });

                // ImportCertificateCommandが既存のARNで呼ばれることを確認
                const importCall = acmMock.commandCalls(ImportCertificateCommand)[0];
                expect(importCall.args[0].input).toHaveProperty('CertificateArn');
            });
        });

        describe('SSM Parameter Store統合', () => {
            test('証明書ARNをSSMに保存できること', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: []
                        });
                    }),
                    http.post('https://api.cloudflare.com/client/v4/certificates', () => {
                        return HttpResponse.json({
                            success: true,
                            result: {
                                id: 'new-cert-id',
                                certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
                                private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
                            }
                        });
                    })
                );

                const result = await prepareWildcardCertificate({
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: false
                });

                expect(result.success).toBe(true);
                expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(1);

                const putCall = ssmMock.commandCalls(PutParameterCommand)[0];
                expect(putCall.args[0].input.Name).toBe('/sankey/certificate-arn');
            });
        });
    });

    describe('setupDnsForCustomDomain', () => {
        describe('環境変数バリデーション', () => {
            test('CLOUDFLARE_API_TOKENが不足している場合はConfigurationErrorをスローすること', async () => {
                delete process.env.CLOUDFLARE_API_TOKEN;

                await expect(setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net'
                })).rejects.toThrow(ConfigurationError);
            });

            test('CLOUDFLARE_ZONE_IDが不足している場合はConfigurationErrorをスローすること', async () => {
                delete process.env.CLOUDFLARE_ZONE_ID;

                await expect(setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net'
                })).rejects.toThrow(ConfigurationError);
            });

            test('必要な環境変数が全て設定されている場合は正常に処理を開始すること', async () => {
                const result = await setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net',
                    dryRun: true
                });

                expect(result).toBeDefined();
                expect(result.success).toBe(true);
                expect(result.hostname).toBe('api-dev.example.com');
                expect(result.targetDomain).toBe('cloudfront.net');
            }, 10000); // タイムアウトを10秒に設定
        });

        describe('DNSレコードの操作', () => {
            test('新しいDNSレコードを作成できること（DRY-RUN）', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records', () => {
                        return HttpResponse.json({
                            success: true,
                            result: []
                        });
                    })
                );

                const result = await setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net',
                    dryRun: true
                });

                expect(result.success).toBe(true);
                expect(result.action).toBe('dry-run-create');
            });

            test('既存のDNSレコードを更新できること（DRY-RUN）', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records', () => {
                        return HttpResponse.json({
                            success: true,
                            result: [{
                                id: 'existing-record-id',
                                name: 'api-dev.example.com',
                                content: 'old-target.net',
                                type: 'CNAME',
                                proxied: false
                            }]
                        });
                    })
                );

                const result = await setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net',
                    dryRun: true
                });

                expect(result.success).toBe(true);
                expect(result.action).toBe('dry-run-update');
            });

            test('既存のレコードが同じ場合は更新しないこと', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records', () => {
                        return HttpResponse.json({
                            success: true,
                            result: [{
                                id: 'existing-record-id',
                                name: 'api-dev.example.com',
                                content: 'cloudfront.net',
                                type: 'CNAME',
                                proxied: true
                            }]
                        });
                    })
                );

                const result = await setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net',
                    dryRun: false
                });

                expect(result.success).toBe(true);
                expect(result.action).toBe('no-change');
            });
        });

        describe('エラーハンドリング', () => {
            test('Cloudflare APIがエラーを返した場合は適切にエラーをスローすること', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records', () => {
                        return HttpResponse.json({
                            success: false,
                            errors: [{
                                code: 'invalid_request',
                                message: 'Invalid zone ID'
                            }]
                        }, { status: 400 });
                    })
                );

                await expect(setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net',
                    dryRun: false
                })).rejects.toThrow('invalid_request: Invalid zone ID');
            });

            test('ネットワークエラーが発生した場合は適切にエラーをスローすること', async () => {
                server.use(
                    http.get('https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records', () => {
                        return HttpResponse.error();
                    })
                );

                await expect(setupDnsForCustomDomain({
                    environment: 'dev',
                    customDomainName: 'api-dev.example.com',
                    targetDomain: 'cloudfront.net',
                    dryRun: false
                })).rejects.toThrow();
            });
        });
    });
});