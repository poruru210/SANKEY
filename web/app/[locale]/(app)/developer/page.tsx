"use client"

import React from "react"
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
import { useTranslations } from "next-intl";

export default function Page() {
    const t = useTranslations();
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
                    title: t('developer.toasts.gasDownloadSuccess.title'),
                    description: t('developer.toasts.gasDownloadSuccess.description'),
                    variant: "default",
                });
            } else if (!error) {
                toast({
                    title: t('developer.toasts.gasDownloadError.title'),
                    description: t('developer.toasts.gasDownloadError.noErrorInfo'),
                    variant: "destructive",
                });
            }
        } catch (e: any) {
            console.error("Download failed:", e);
            toast({
                title: t('developer.toasts.gasDownloadError.title'),
                description: e.message || t('developer.toasts.gasDownloadError.general'),
                variant: "destructive",
            });
        }
    };

    React.useEffect(() => {
        if (error) {
            toast({
                title: t('common.error'),
                description: error || t('common.unknownError'),
                variant: "destructive",
            });
        }
    }, [error, toast]);

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
                                    <h1 className="text-3xl font-bold theme-text-primary">{t('developer.title')}</h1>
                                    <p className="theme-text-secondary">{t('developer.subtitle')}</p>
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* 既存の Integration Steps */}
                    <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm mb-6">
                        <CardHeader className="space-y-4">
                            <CardTitle className="theme-text-primary flex items-center">
                                <Settings className="w-6 h-6 mr-2 text-emerald-400"/>
                                {t('developer.integrationSteps.title')}
                            </CardTitle>
                            <CardDescription className="theme-text-secondary">
                                {t('developer.integrationSteps.description')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <StepGroup>
                                {/* Step 1: 事前準備 */}
                                <StepControl
                                    id={1}
                                    title={t('developer.step1.title')}
                                    description={t('developer.step1.description')}
                                    icon={<FileText className="w-5 h-5"/>}
                                    status="completed"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step1.formPrep.title')}</h4>
                                            <p className="theme-text-secondary mb-3">{t('developer.step1.formPrep.description')} (<Badge variant="outline" className="theme-badge-blue">{t('developer.step1.formPrep.requiredBadge')}</Badge>{t('developer.step1.formPrep.requiredText')}）：</p>
                                            <div className="space-y-2 theme-text-secondary">
                                                <div className="grid grid-cols-3 gap-x-4 font-medium theme-text-primary border-b pb-1 mb-1">
                                                    <div>{t('developer.step1.formPrep.table.question')}</div>
                                                    <div className="text-center">{t('developer.step1.formPrep.table.required')}</div>
                                                    <div>{t('developer.step1.formPrep.table.example')}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{t('developer.step1.formPrep.table.eaName.question')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>{t('developer.step1.formPrep.table.eaName.example')}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{t('developer.step1.formPrep.table.accountNumber.question')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>{t('developer.step1.formPrep.table.accountNumber.example')}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{t('developer.step1.formPrep.table.brokerName.question')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>{t('developer.step1.formPrep.table.brokerName.example')}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{t('developer.step1.formPrep.table.email.question')}</div>
                                                    <div className="text-center">✓</div>
                                                    <div>{t('developer.step1.formPrep.table.email.example')}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>{t('developer.step1.formPrep.table.xAccount.question')}</div>
                                                    <div className="text-center"></div>
                                                    <div>{t('developer.step1.formPrep.table.xAccount.example')}</div>
                                                </div>
                                            </div>
                                        </div>

                                        <Button
                                            variant="outline"
                                            className="border-emerald-500/40 theme-text-emerald hover:bg-emerald-500/20"
                                            onClick={() => window.open("https://forms.google.com", "_blank")}
                                        >
                                            <Link className="w-4 h-4 mr-2"/>
                                            {t('developer.step1.formPrep.openExternalLinkButton')}
                                        </Button>
                                    </div>
                                </StepControl>

                                {/* Step 2: GAS連携設定 */}
                                <StepControl
                                    id={2}
                                    title={t('developer.step2.title')}
                                    description={t('developer.step2.description')}
                                    icon={<Code className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step2.createProject.title')}</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-4">
                                                <li>{t('developer.step2.createProject.step1')} <a href="https://script.google.com" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{t('developer.step2.createProject.step1LinkText')}</a></li>
                                                <li>{t('developer.step2.createProject.step2')}</li>
                                                <li>{t('developer.step2.createProject.step3')}</li>
                                            </ol>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step2.prepareCode.title')}</h4>
                                            <p className="theme-text-secondary mb-3">{t('developer.step2.prepareCode.description')}</p>
                                            <Button
                                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                                onClick={handleDownloadGasTemplate}
                                                disabled={isLoading}
                                            >
                                                <Download className="w-4 h-4 mr-2" />
                                                {isLoading ? t('developer.step2.prepareCode.downloadingButton') : t('developer.step2.prepareCode.downloadButton')}
                                            </Button>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step2.pasteCode.title')}</h4>
                                            <p className="theme-text-secondary mb-3">{t('developer.step2.pasteCode.description')}</p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step2.adjustFormFields.title')}</h4>
                                            <p className="theme-text-secondary mb-3">{t('developer.step2.adjustFormFields.description')}</p>
                                            <p className="theme-text-secondary mb-1"><strong>{t('developer.step2.adjustFormFields.exampleTitle')}</strong> {t('developer.step2.adjustFormFields.exampleDescription')}</p>
                                            <pre className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                                              <code className="text-sm text-emerald-300">
                                                {t('developer.step2.adjustFormFields.codeExample')}
                                              </code>
                                            </pre>
                                        </div>
                                    </div>
                                </StepControl>

                                {/* Step 3: 連携テスト */}
                                <StepControl
                                    id={3}
                                    title={t('developer.step3.title')}
                                    description={t('developer.step3.description')}
                                    icon={<TestTube className="w-5 h-5"/>}
                                    status="in-progress"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step3.checkSettings.title')}</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-3">
                                                <li>{t('developer.step3.checkSettings.step1')}</li>
                                                <li>{t('developer.step3.checkSettings.step2')}</li>
                                                <li>{t('developer.step3.checkSettings.step3')} (<code className="bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-200 px-1.5 py-1 rounded text-sm font-mono">{t('developer.step3.checkSettings.successMessage')}</code>)</li>
                                            </ol>
                                            <p className="theme-text-secondary mb-4"><strong>{t('developer.step3.checkSettings.onErrorTitle')}</strong> {t('developer.step3.checkSettings.onErrorDescription')}</p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step3.communicationTest.title')}</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-3">
                                                <li>{t('developer.step3.communicationTest.step1')}</li>
                                                <li>{t('developer.step3.communicationTest.step2')}</li>
                                                <li>{t('developer.step3.communicationTest.step3')} (<code className="bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-200 px-1.5 py-1 rounded text-sm font-mono">{t('developer.step3.communicationTest.successMessage')}</code>)</li>
                                            </ol>
                                        </div>
                                    </div>
                                </StepControl>

                                {/* Step 4: モジュールダウンロード */}
                                <StepControl
                                    id={4}
                                    title={t('developer.step4.title')}
                                    description={t('developer.step4.description')}
                                    icon={<Download className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <ModuleDownload/>
                                </StepControl>

                                {/* Step 5: EA組み込み */}
                                <StepControl
                                    id={5}
                                    title={t('developer.step5.title')}
                                    description={t('developer.step5.description')}
                                    icon={<Code className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step5.overview.title')}</h4>
                                            <p>
                                                {t('developer.step5.overview.description')}
                                            </p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-3">{t('developer.step5.implementationCode.title')}</h4>
                                            <MtVersionSelector/>
                                        </div>
                                    </div>
                                </StepControl>

                                {/* Step 6: ダウンロードURL設定 */}
                                <StepControl
                                    id={6}
                                    title={t('developer.step6.title')}
                                    description={t('developer.step6.description')}
                                    icon={<Link className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">{t('developer.step6.overview.title')}</h4>
                                            <p>
                                                {t('developer.step6.overview.description')}
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