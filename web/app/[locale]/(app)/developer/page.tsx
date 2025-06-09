"use client"

import React from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { useDeveloper } from "@/hooks/use-developer"
import { useToast } from "@/hooks/use-toast"

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card"
import {Badge} from "@/components/ui/badge"
import {
    ChevronDown,
    ChevronRight,
    FileText,
    Settings,
    Shield,
    Link,
    CheckCircle,
    Code,
    TestTube,
    Key,
    Eye,
    EyeOff,
} from "lucide-react"
import {ModuleDownload} from "./components/module-download"
import {MtVersionSelector} from "./components/mt-version-selector"
import {StepGroup, StepControl} from "./components//step-control-component"
import LicensePlayground from './components/license-playground'

export default function Page() {
    const t = useTranslations('developer')
    const tSteps = useTranslations('developer.steps')
    const tCommon = useTranslations('common')
    const { downloadGasTemplate, isLoading, error } = useDeveloper();
    const { toast } = useToast();

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
            } else if (!error) {
                toast({
                    title: tCommon("error"),
                    description: "ファイルの取得に失敗しましたが、エラー情報がありません。",
                    variant: "destructive",
                });
            }
        } catch (e: any) {
            console.error("Download failed:", e);
            toast({
                title: tCommon("error"),
                description: e.message || "GASテンプレートのダウンロード中にエラーが発生しました。",
                variant: "destructive",
            });
        }
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

                    {/* ヘッダー */}
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

                    {/* Integration Steps */}
                    <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm mb-6">
                        <CardHeader className="space-y-4">
                            <CardTitle className="theme-text-primary flex items-center">
                                <Settings className="w-6 h-6 mr-2 text-emerald-400"/>
                                {t('integrationSteps')}
                            </CardTitle>
                            <CardDescription className="theme-text-secondary">
                                {t('integrationStepsDesc')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <StepGroup>
                                {/* Step 1: 事前準備 */}
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
                                            <p className="theme-text-secondary mb-3">
                                                {tSteps.rich('preparation.googleFormDesc', {
                                                    required: (chunks) => (
                                                        <Badge variant="outline" className="theme-badge-blue">
                                                            {tSteps('preparation.required')}
                                                        </Badge>
                                                    )
                                                })}
                                            </p>
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

                                {/* Step 2: GAS連携設定 */}
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
                                                disabled={isLoading}
                                            >
                                                <Download className="w-4 h-4 mr-2" />
                                                {isLoading ? tSteps('gasIntegration.downloading') : tSteps('gasIntegration.downloadTemplate')}
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

                                {/* Step 3: 連携テスト */}
                                <StepControl
                                    id={3}
                                    title={tSteps('integrationTest.title')}
                                    description={tSteps('integrationTest.description')}
                                    icon={<TestTube className="w-5 h-5"/>}
                                    status="in-progress"
                                >
                                    <div className="space-y-6">
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
                                    </div>
                                </StepControl>

                                {/* Step 4: モジュールダウンロード */}
                                <StepControl
                                    id={4}
                                    title={tSteps('moduleDownload.title')}
                                    description={tSteps('moduleDownload.description')}
                                    icon={<Download className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <ModuleDownload/>
                                </StepControl>

                                {/* Step 5: EA組み込み */}
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

                                {/* Step 6: ダウンロードURL設定 */}
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