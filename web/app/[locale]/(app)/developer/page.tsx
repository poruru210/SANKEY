"use client"

import React, { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { useDeveloper } from "@/hooks/use-developer"
import { useToast } from "@/hooks/use-toast"

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card"
import {Badge} from "@/components/ui/badge"
import {
    FileText,
    Settings,
    Shield,
    Link,
    CheckCircle,
    Code,
    TestTube,
    Key,
    Play,
    Clock,
    AlertCircle,
    RefreshCw,
    Database,
} from "lucide-react"
import {ModuleDownload} from "./components/module-download"
import {MtVersionSelector} from "./components/mt-version-selector"
import {StepGroup, StepControl} from "./components//step-control-component"
import LicensePlayground from './components/license-playground'

export default function Page() {
    const t = useTranslations('developer')
    const tSteps = useTranslations('developer.steps')
    const tCommon = useTranslations('common')
    const {
        downloadGasTemplate,
        isDownloading,
        error,
        startIntegrationTest,
        isIntegrationTesting,
        integrationTestResult,
        integrationTestError,
        getUserProfile,
        userProfile,
        isLoadingProfile,
        profileError
    } = useDeveloper();
    const { toast } = useToast();

    const [gasWebappUrl, setGasWebappUrl] = useState('');

    React.useEffect(() => {
        getUserProfile().catch(console.error);
    }, [getUserProfile]);

    React.useEffect(() => {
        const savedUrl = userProfile?.testResults?.integrationTest?.gasWebappUrl;
        if (savedUrl && !gasWebappUrl) {
            setGasWebappUrl(savedUrl);
        }
    }, [userProfile?.testResults?.integrationTest?.gasWebappUrl, gasWebappUrl]);

    const handleDownloadGasTemplate = async () => {
        try {
            const blob = await downloadGasTemplate();
            if (blob) {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'gas-template.gs';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                toast({
                    title: tCommon("success"),
                    description: "GASテンプレートがダウンロードされました。",
                    variant: "default",
                });
            }
        } catch (e: any) {
            toast({
                title: tCommon("error"),
                description: e.message || "GASテンプレートのダウンロード中にエラーが発生しました。",
                variant: "destructive",
            });
        }
    };

    const handleStartIntegrationTest = async (webappUrl: string) => {
        if (!webappUrl.trim()) {
            toast({
                title: tCommon("error"),
                description: "WebApp URLを入力してください。",
                variant: "destructive",
            });
            return;
        }

        try {
            const url = new URL(webappUrl);
            if (!url.hostname.includes('script.google.com')) {
                throw new Error('Google Apps Script URLである必要があります');
            }
            if (!url.pathname.includes('/exec')) {
                toast({
                    title: "URLの確認",
                    description: "WebApp URLは /exec で終わる本番URLを使用することを推奨します。",
                    variant: "default",
                });
            }
        } catch (e) {
            toast({
                title: tCommon("error"),
                description: "有効なWebApp URLを入力してください。",
                variant: "destructive",
            });
            return;
        }

        try {
            const result = await startIntegrationTest(webappUrl);
            if (result) {
                toast({
                    title: "統合テスト開始",
                    description: result.message,
                    variant: "default",
                });
            }
        } catch (e: any) {
            toast({
                title: tCommon("error"),
                description: e.message || "統合テストの開始中にエラーが発生しました。",
                variant: "destructive",
            });
        }
    };

    const handleRefreshProfile = async () => {
        try {
            await getUserProfile();
            toast({
                title: "プロファイル更新",
                description: "ユーザープロファイルを更新しました。",
                variant: "default",
            });
        } catch (e: any) {
            toast({
                title: tCommon("error"),
                description: e.message || "プロファイルの更新中にエラーが発生しました。",
                variant: "destructive",
            });
        }
    };

    const getStep3Status = () => {
        if (!userProfile) return "pending";
        if (userProfile.setupPhase === 'SETUP') return "pending";
        if (userProfile.setupPhase === 'TEST') return "in-progress";
        if (userProfile.setupPhase === 'PRODUCTION') return "completed";
        return "pending";
    };

    const renderConnectionTestStatus = () => {
        if (isLoadingProfile) {
            return (
                <div className="flex items-center space-x-2 text-blue-500">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>プロファイル読み込み中...</span>
                </div>
            );
        }

        if (profileError) {
            return (
                <div className="flex items-center space-x-2 text-red-500">
                    <AlertCircle className="w-4 h-4" />
                    <span>プロファイル読み込みエラー</span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefreshProfile}
                        className="ml-2"
                    >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        再試行
                    </Button>
                </div>
            );
        }

        if (!userProfile) {
            return (
                <div className="flex items-center space-x-2 text-gray-500">
                    <AlertCircle className="w-4 h-4" />
                    <span>プロファイル情報なし</span>
                </div>
            );
        }

        const setupTest = userProfile.testResults?.setupTest;
        const hasCompletedSetupTest = setupTest?.success;

        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <Badge variant={userProfile.setupPhase === 'SETUP' ? 'secondary' :
                            userProfile.setupPhase === 'TEST' ? 'default' : 'outline'}>
                            {userProfile.setupPhase}
                        </Badge>
                        <span className="text-sm theme-text-secondary">
                            現在のフェーズ
                        </span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRefreshProfile}
                        disabled={isLoadingProfile}
                    >
                        <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingProfile ? 'animate-spin' : ''}`} />
                        更新
                    </Button>
                </div>

                {hasCompletedSetupTest && (
                    <div className="flex items-center space-x-2 text-green-600">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm">接続テスト完了</span>
                        <span className="text-xs text-gray-500">
                            {new Date(setupTest.timestamp).toLocaleString('ja-JP')}
                        </span>
                    </div>
                )}

                {userProfile?.testResults?.integrationTest?.gasWebappUrl && (
                    <div className="text-xs theme-text-secondary">
                        <span className="font-medium">WebApp URL:</span> {userProfile.testResults.integrationTest.gasWebappUrl}
                    </div>
                )}
            </div>
        );
    };

    const renderIntegrationTestProgress = () => {
        const progress = userProfile?.testResults?.integrationTest?.progress;
        if (!progress) return null;

        const steps = [
            { key: 'STARTED', label: '開始', icon: Play },
            { key: 'GAS_WEBHOOK_RECEIVED', label: 'Webhook', icon: Database },
            { key: 'LICENSE_ISSUED', label: 'ライセンス', icon: Key },
            { key: 'COMPLETED', label: '完了', icon: CheckCircle },
        ];

        const getStepStatus = (stepKey: string) => {
            if (progress.steps[stepKey as keyof typeof progress.steps]?.success) {
                return 'completed';
            } else if (progress.currentStep === stepKey) {
                return 'current';
            } else {
                return 'pending';
            }
        };

        const getStepIcon = (IconComponent: React.ComponentType<any>, status: string) => {
            const className = status === 'completed' ? "w-4 h-4 text-green-500" :
                status === 'current' ? "w-4 h-4 text-blue-500 animate-pulse" :
                    "w-4 h-4 text-gray-400";
            return <IconComponent className={className} />;
        };

        const getConnectorColor = (index: number) => {
            if (index >= steps.length - 1) return '';
            const currentStatus = getStepStatus(steps[index].key);
            return currentStatus === 'completed' ? 'bg-green-500' : 'bg-gray-300';
        };

        const calculateElapsedTime = () => {
            const startTime = new Date(progress.startedAt).getTime();
            const endTime = progress.completedAt ?
                new Date(progress.completedAt).getTime() :
                Date.now();
            const elapsed = Math.floor((endTime - startTime) / 1000);

            if (elapsed < 60) return `${elapsed}秒`;
            if (elapsed < 3600) return `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;
            const hours = Math.floor(elapsed / 3600);
            const minutes = Math.floor((elapsed % 3600) / 60);
            return `${hours}時間${minutes}分`;
        };

        const currentStepInfo = progress.steps[progress.currentStep];
        const currentStepLabel = steps.find(s => s.key === progress.currentStep)?.label || progress.currentStep;

        return (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                    <h5 className="font-semibold text-blue-800">📊 統合テスト進捗</h5>
                    <span className="text-xs text-blue-600">
                        経過時間: {calculateElapsedTime()}
                    </span>
                </div>

                <div className="flex items-center mb-3">
                    {steps.map((step, index) => (
                        <React.Fragment key={step.key}>
                            {getStepIcon(step.icon, getStepStatus(step.key))}
                            {index < steps.length - 1 && (
                                <div className={`h-px w-6 ${getConnectorColor(index)}`}></div>
                            )}
                        </React.Fragment>
                    ))}
                </div>

                <div className="flex items-center space-x-2 mb-2">
                    <Badge variant={progress.currentStep === 'COMPLETED' ? 'default' : 'secondary'}>
                        {currentStepLabel}
                    </Badge>
                    {currentStepInfo && (
                        <span className="text-xs text-gray-600">
                            {new Date(currentStepInfo.timestamp).toLocaleTimeString('ja-JP')}
                        </span>
                    )}
                </div>

                {currentStepInfo?.details && (
                    <p className="text-sm text-blue-700">{currentStepInfo.details}</p>
                )}

                <p className="text-xs text-gray-500 mt-2">
                    TestID: {progress.testId}
                </p>
            </div>
        );
    };

    const renderIntegrationTestResult = () => {
        if (integrationTestError) {
            return (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center space-x-2 text-red-700">
                        <AlertCircle className="w-4 h-4" />
                        <span className="font-medium">統合テストエラー</span>
                    </div>
                    <p className="text-sm text-red-600 mt-1">{integrationTestError}</p>
                </div>
            );
        }

        if (integrationTestResult) {
            return (
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-center space-x-2 text-emerald-700 mb-3">
                        <CheckCircle className="w-4 h-4" />
                        <span className="font-medium">統合テスト開始成功</span>
                    </div>
                    <div className="space-y-2 text-sm">
                        <p className="text-emerald-600">{integrationTestResult.message}</p>
                        <div className="text-emerald-700">
                            <span className="font-medium">テストID:</span> {integrationTestResult.testId}
                        </div>
                        <div className="text-emerald-700">
                            <span className="font-medium">推定所要時間:</span> {integrationTestResult.estimatedDuration}
                        </div>
                        {integrationTestResult.webhookUrl && (
                            <div className="text-emerald-700">
                                <span className="font-medium">使用WebApp URL:</span> {integrationTestResult.webhookUrl.replace(/\/exec.*/, '/exec***')}
                            </div>
                        )}
                        {integrationTestResult.nextSteps && integrationTestResult.nextSteps.length > 0 && (
                            <div className="mt-3">
                                <span className="font-medium text-emerald-800">次のステップ:</span>
                                <ol className="list-decimal pl-5 space-y-1 mt-1">
                                    {integrationTestResult.nextSteps.map((step, index) => (
                                        <li key={index} className="text-emerald-700">{step}</li>
                                    ))}
                                </ol>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return null;
    };

    React.useEffect(() => {
        if (error) {
            toast({
                title: tCommon("error"),
                description: error || "不明なエラーが発生しました。",
                variant: "destructive",
            });
        }
    }, [error, toast, tCommon]);

    return (
        <div>
            <div className="flex-1 flex flex-col min-w-0">
                <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center space-x-3">
                                <Shield className="w-8 h-8 text-emerald-400"/>
                                <div>
                                    <h1 className="text-3xl font-bold theme-text-primary">{t('title')}</h1>
                                    <p className="theme-text-secondary">{t('subtitle')}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm mb-6">
                        <CardHeader className="space-y-4">
                            <CardTitle className="theme-text-primary flex items-center">
                                <Settings className="w-6 h-6 mr-2 text-emerald-400"/>
                                {t('getStarted')}
                            </CardTitle>
                            <CardDescription className="theme-text-secondary">
                                {t('getStartedDesc')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <StepGroup>
                                <StepControl
                                    id={1}
                                    title={tSteps('preparation.title')}
                                    description={tSteps('preparation.description')}
                                    icon={<FileText className="w-5 h-5"/>}
                                    status="completed"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('preparation.googleForm')}</h4>
                                            <div className="theme-text-secondary mb-3">
                                                {tSteps.rich('preparation.googleFormDesc', {
                                                    required: (chunks) => (
                                                        <Badge variant="outline" className="theme-badge-blue">
                                                            {tSteps('preparation.required')}
                                                        </Badge>
                                                    )
                                                })}
                                            </div>
                                            <div className="space-y-2 theme-text-secondary">
                                                <div className="grid grid-cols-3 gap-x-4 font-medium theme-text-primary border-b pb-1 mb-1">
                                                    <div>{tSteps('preparation.questionItem')}</div>
                                                    <div className="text-center">{tSteps('preparation.required')}</div>
                                                    <div>{tSteps('preparation.example')}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{tSteps('preparation.eaName')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>MyTradingEA v1.0</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{tSteps('preparation.accountNumber')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>1234567890</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{tSteps('preparation.brokerName')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>XM Trading</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{tSteps('preparation.emailAddress')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>user@example.com</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{tSteps('preparation.xAccount')}</div>
                                                    <div className="text-center"></div>
                                                    <div>@username</div>
                                                </div>
                                            </div>
                                        </div>

                                        <Button
                                            variant="outline"
                                            className="border-emerald-500/40 theme-text-emerald hover:bg-emerald-500/20"
                                            onClick={() => window.open("https://forms.google.com", "_blank")}
                                        >
                                            <Link className="w-4 h-4 mr-2"/>
                                            {tSteps('preparation.openExternal')}
                                        </Button>
                                    </div>
                                </StepControl>

                                <StepControl
                                    id={2}
                                    title={tSteps('gasIntegration.title')}
                                    description={tSteps('gasIntegration.description')}
                                    icon={<Code className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('gasIntegration.newProject')}</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-4">
                                                {tSteps.raw('gasIntegration.newProjectSteps').map((step: string, index: number) => (
                                                    <li key={index}>{step}</li>
                                                ))}
                                            </ol>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('gasIntegration.codePreparation')}</h4>
                                            <p className="theme-text-secondary mb-3">{tSteps('gasIntegration.codePreparationDesc')}</p>
                                            <Button
                                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                                onClick={handleDownloadGasTemplate}
                                                disabled={isDownloading}
                                            >
                                                <Download className="w-4 h-4 mr-2" />
                                                {isDownloading ? tSteps('gasIntegration.downloading') : tSteps('gasIntegration.downloadTemplate')}
                                            </Button>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('gasIntegration.codePasting')}</h4>
                                            <p className="theme-text-secondary mb-3">{tSteps('gasIntegration.codePastingDesc')}</p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('gasIntegration.formFieldsAdjustment')}</h4>
                                            <p className="theme-text-secondary mb-3">{tSteps('gasIntegration.formFieldsAdjustmentDesc')}</p>
                                            <p className="theme-text-secondary mb-1"><strong>{tSteps('gasIntegration.formFieldsExample')}</strong></p>
                                            <pre className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                                              <code className="text-sm text-emerald-300">
                                                {`// FORM_FIELDS: {
//   EA_NAME: "あなたのEA名を入力してください",
//   // ...
// }`}
                                              </code>
                                            </pre>
                                        </div>
                                    </div>
                                </StepControl>

                                <StepControl
                                    id={3}
                                    title={tSteps('integrationTest.title')}
                                    description={tSteps('integrationTest.description')}
                                    icon={<TestTube className="w-5 h-5"/>}
                                    status={getStep3Status()}
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-3">接続状態</h4>
                                            {renderConnectionTestStatus()}
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('integrationTest.configValidation')}</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-3">
                                                {tSteps.raw('integrationTest.configValidationSteps').map((step: string, index: number) => (
                                                    <li key={index} dangerouslySetInnerHTML={{__html: step}} />
                                                ))}
                                            </ol>
                                            <p className="theme-text-secondary mb-4">
                                                <strong>{tSteps('integrationTest.configValidationNote')}</strong>
                                            </p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('integrationTest.communicationTest')}</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-3">
                                                {tSteps.raw('integrationTest.communicationTestSteps').map((step: string, index: number) => (
                                                    <li key={index} dangerouslySetInnerHTML={{__html: step}} />
                                                ))}
                                            </ol>
                                        </div>

                                        <div className="border-t pt-6">
                                            <h4 className="font-semibold theme-text-primary mb-2">統合テスト実行</h4>
                                            <p className="theme-text-secondary mb-4">
                                                接続テストが完了したら、統合テストを実行してください。
                                                ダミーの申請データが送信され、承認からライセンス発行までの完全なフローをテストします。
                                            </p>

                                            {renderIntegrationTestProgress()}

                                            <div className="space-y-4 mb-4">
                                                <div>
                                                    <label className="block text-sm font-medium theme-text-primary mb-2">
                                                        GAS WebApp URL
                                                        <span className="text-red-500 ml-1">*</span>
                                                    </label>
                                                    <input
                                                        type="url"
                                                        placeholder="https://script.google.com/macros/s/[SCRIPT_ID]/exec"
                                                        value={gasWebappUrl}
                                                        onChange={(e) => setGasWebappUrl(e.target.value)}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 theme-input"
                                                        required
                                                    />
                                                    <div className="mt-2 space-y-1">
                                                        <p className="text-xs theme-text-secondary">
                                                            📋 <strong>取得方法：</strong> GAS エディタ → 「デプロイ」→「新しいデプロイ」→ ウェブアプリとして公開
                                                        </p>
                                                        <p className="text-xs theme-text-secondary">
                                                            ⚠️ <strong>重要：</strong> <code>/exec</code> で終わるURLを使用してください（<code>/dev</code> は外部アクセス不可）
                                                        </p>
                                                        <p className="text-xs text-orange-600">
                                                            💡 実行者を「自分」、アクセスできるユーザーを「全員」に設定してください
                                                        </p>
                                                        {userProfile?.testResults?.integrationTest?.gasWebappUrl && (
                                                            <p className="text-xs text-green-600">
                                                                ✅ <strong>保存済みURL：</strong> {userProfile.testResults.integrationTest.gasWebappUrl.replace(/\/exec.*/, '/exec***')}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <Button
                                                className="bg-blue-500 hover:bg-blue-600 text-white"
                                                onClick={() => handleStartIntegrationTest(gasWebappUrl)}
                                                disabled={
                                                    isIntegrationTesting ||
                                                    !userProfile ||
                                                    userProfile.setupPhase !== 'TEST' ||
                                                    !gasWebappUrl.trim()
                                                }
                                            >
                                                {isIntegrationTesting ? (
                                                    <>
                                                        <Clock className="w-4 h-4 mr-2 animate-spin" />
                                                        統合テスト実行中...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play className="w-4 h-4 mr-2" />
                                                        統合テスト開始
                                                    </>
                                                )}
                                            </Button>

                                            {userProfile?.setupPhase !== 'TEST' && (
                                                <p className="text-sm text-orange-600 mt-2">
                                                    ※ 統合テストを実行するには、まず接続テストを完了してください。
                                                </p>
                                            )}

                                            {!gasWebappUrl.trim() && (
                                                <p className="text-sm text-gray-500 mt-2">
                                                    ※ WebApp URLを入力してください。
                                                </p>
                                            )}

                                            {userProfile?.testResults?.integrationTest?.gasWebappUrl &&
                                                gasWebappUrl.trim() &&
                                                gasWebappUrl !== userProfile.testResults.integrationTest.gasWebappUrl && (
                                                    <p className="text-sm text-blue-600 mt-2">
                                                        ℹ️ 新しいWebApp URLが入力されています。統合テスト成功時に更新されます。
                                                    </p>
                                                )}

                                            {renderIntegrationTestResult()}
                                        </div>
                                    </div>
                                </StepControl>

                                <StepControl
                                    id={4}
                                    title={tSteps('moduleDownload.title')}
                                    description={tSteps('moduleDownload.description')}
                                    icon={<Download className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <ModuleDownload/>
                                </StepControl>

                                <StepControl
                                    id={5}
                                    title={tSteps('eaIntegration.title')}
                                    description={tSteps('eaIntegration.description')}
                                    icon={<Code className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('eaIntegration.overview')}</h4>
                                            <p className="theme-text-secondary">
                                                {tSteps('eaIntegration.overviewDesc')}
                                            </p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-3">{tSteps('eaIntegration.implementationCode')}</h4>
                                            <MtVersionSelector/>
                                        </div>
                                    </div>
                                </StepControl>

                                <StepControl
                                    id={6}
                                    title={tSteps('downloadUrlSetup.title')}
                                    description={tSteps('downloadUrlSetup.description')}
                                    icon={<Link className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{tSteps('eaIntegration.overview')}</h4>
                                            <p className="theme-text-secondary">
                                                {tSteps('downloadUrlSetup.overviewDesc')}
                                            </p>
                                        </div>
                                    </div>
                                </StepControl>
                            </StepGroup>
                        </CardContent>
                    </Card>
                    <LicensePlayground />
                </main>
            </div>
        </div>
    );
}