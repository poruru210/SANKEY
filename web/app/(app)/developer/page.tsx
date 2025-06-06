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

export default function Page() {
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
                    title: "ダウンロード成功",
                    description: "GASテンプレートがダウンロードされました。",
                    variant: "default",
                });
            } else if (!error) {
                toast({
                    title: "ダウンロード失敗",
                    description: "ファイルの取得に失敗しましたが、エラー情報がありません。",
                    variant: "destructive",
                });
            }
        } catch (e: any) {
            console.error("Download failed:", e);
            toast({
                title: "ダウンロードエラー",
                description: e.message || "GASテンプレートのダウンロード中にエラーが発生しました。",
                variant: "destructive",
            });
        }
    };

    React.useEffect(() => {
        if (error) {
            toast({
                title: "エラー",
                description: error || "不明なエラーが発生しました。",
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
                                    <h1 className="text-3xl font-bold theme-text-primary">開発者統合ガイド</h1>
                                    <p className="theme-text-secondary">Expert Advisor
                                        SANKEYライセンス認証を統合するための完全ガイド</p>
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* 既存の Integration Steps */}
                    <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm mb-6">
                        <CardHeader className="space-y-4">
                            <CardTitle className="theme-text-primary flex items-center">
                                <Settings className="w-6 h-6 mr-2 text-emerald-400"/>
                                Integration Steps
                            </CardTitle>
                            <CardDescription className="theme-text-secondary">
                                Step-by-step guide to integrate SANKEY license verification
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <StepGroup>
                                {/* Step 1: 事前準備 */}
                                <StepControl
                                    id={1}
                                    title="事前準備"
                                    description="ライセンス申請用のGoogleフォームに必要な項目を作成します。"
                                    icon={<FileText className="w-5 h-5"/>}
                                    status="completed"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">Googleフォームの準備</h4>
                                            <p className="theme-text-secondary mb-3">申請フォームに以下の質問項目を作成してください（<Badge variant="outline" className="theme-badge-blue">必須</Badge>マークの項目は必須）：</p>
                                            <div className="space-y-2 theme-text-secondary">
                                                <div className="grid grid-cols-3 gap-x-4 font-medium theme-text-primary border-b pb-1 mb-1">
                                                    <div>質問項目</div>
                                                    <div className="text-center">必須</div>
                                                    <div>回答例</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>EA名</div>
                                                    <div className="text-center">✓</div>
                                                    <div>MyTradingEA v1.0</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>アカウント番号</div>
                                                    <div className="text-center">✓</div>
                                                    <div>1234567890</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>ブローカー名</div>
                                                    <div className="text-center">✓</div>
                                                    <div>XM Trading</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>メールアドレス</div>
                                                    <div className="text-center">✓</div>
                                                    <div>user@example.com</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-x-4">
                                                    <div>Xアカウント名</div>
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
                                            外部リンクを開く
                                        </Button>
                                    </div>
                                </StepControl>

                                {/* Step 2: GAS連携設定 */}
                                <StepControl
                                    id={2}
                                    title="Google Form連携設定（GAS）"
                                    description="Google Apps Scriptで新しいプロジェクトを作成し、提供されたテンプレートを元に設定を行います。"
                                    icon={<Code className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">新しいプロジェクトを作成</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-4">
                                                <li>「<a href="https://script.google.com" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Google Apps Script</a>」にアクセス</li>
                                                <li>「新しいプロジェクト」をクリック</li>
                                                <li>プロジェクト名を「EA License Application」に変更</li>
                                            </ol>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">コードファイルの準備</h4>
                                            <p className="theme-text-secondary mb-3">以下のボタンをクリックして、GASテンプレートファイル（`gas-template.gs`）をダウンロードします。</p>
                                            <Button
                                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                                onClick={handleDownloadGasTemplate}
                                                disabled={isLoading}
                                            >
                                                <Download className="w-4 h-4 mr-2" />
                                                {isLoading ? "ダウンロード中..." : "GASテンプレートをダウンロード"}
                                            </Button>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">コードの貼り付け</h4>
                                            <p className="theme-text-secondary mb-3">ダウンロードした `gas-template.gs` ファイルを開き、その内容全体をコピーして、Google Apps Scriptエディタに貼り付けてください。既存のコードは全て置き換えます。</p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">FORM_FIELDS の調整</h4>
                                            <p className="theme-text-secondary mb-3">実際のGoogleフォームの質問文に合わせて、スクリプト内の `FORM_FIELDS` オブジェクトを調整してください。キー（例: `EA_NAME`）は固定ですが、値（例: `"あなたのEA名を入力してください"`）をフォームの質問文と一致させる必要があります。</p>
                                            <p className="theme-text-secondary mb-1"><strong>例：</strong> フォームの質問が「あなたのEA名を入力してください」の場合</p>
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
                                    title="連携テストを行う"
                                    description="Google Apps Script内でテスト関数を実行し、設定と通信が正常に行われるか確認します。"
                                    icon={<TestTube className="w-5 h-5"/>}
                                    status="in-progress"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">設定値の確認</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-3">
                                                <li>Google Apps Scriptエディタの上部メニューの「実行」をクリック。</li>
                                                <li>「関数を実行」にマウスオーバーし、ドロップダウンから「validateConfig」を選択。</li>
                                                <li>実行後、エディタ下部の「実行ログ」で「<code className="bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-200 px-1.5 py-1 rounded text-sm font-mono">✅ 設定は正常です</code>」というメッセージが表示されることを確認してください。</li>
                                            </ol>
                                            <p className="theme-text-secondary mb-4"><strong>エラーが出た場合:</strong> スクリプト内の `CONFIG` セクションの設定値を再確認してください。</p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">通信テスト</h4>
                                            <ol className="list-decimal pl-5 space-y-1 theme-text-secondary mb-3">
                                                <li>再度、上部メニューの「実行」をクリック。</li>
                                                <li>「関数を実行」にマウスオーバーし、ドロップダウンから「testWebhook」を選択。</li>
                                                <li>実行後、「実行ログ」で「<code className="bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-200 px-1.5 py-1 rounded text-sm font-mono">✅ テスト成功</code>」というメッセージが表示されることを確認してください。</li>
                                            </ol>
                                        </div>
                                    </div>
                                </StepControl>

                                {/* Step 4: モジュールダウンロード */}
                                <StepControl
                                    id={4}
                                    title="ライセンス認証用モジュールをダウンロードする"
                                    description="EAに組み込むためのライセンス認証モジュールを取得します"
                                    icon={<Download className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <ModuleDownload/>
                                </StepControl>

                                {/* Step 5: EA組み込み */}
                                <StepControl
                                    id={5}
                                    title="EAに認証モジュールを組み込む"
                                    description="ダウンロードしたモジュールをExpert Advisorに統合します"
                                    icon={<Code className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">概要</h4>
                                            <p>
                                                Expert AdvisorにSANKEYライセンス認証機能を組み込み、適切な認証フローを実装します。
                                            </p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-3">実装コード</h4>
                                            <MtVersionSelector/>
                                        </div>
                                    </div>
                                </StepControl>

                                {/* Step 6: ダウンロードURL設定 */}
                                <StepControl
                                    id={6}
                                    title="EAのダウンロードURLを設定する"
                                    description="認証済みユーザーがEAをダウンロードできるURLを設定します"
                                    icon={<Link className="w-5 h-5"/>}
                                    status="pending"
                                >
                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="font-semibold theme-text-primary mb-2">概要</h4>
                                            <p>
                                                ライセンス認証が完了したユーザーが安全にEAファイルをダウンロードできるシステムを構築します。
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