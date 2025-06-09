"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Code } from "lucide-react"

export function MtVersionSelector() {
  const t = useTranslations('developer.steps.eaIntegration')
  const [selectedVersion, setSelectedVersion] = useState<"MT4" | "MT5">("MT4")

  const codeExamples = {
    MT4: `#include <SankeyDecoder.mqh>

int OnInit()
{
   string masterKey = "9H6DEu8Z0Mipgz1djyM4eUeBqZ9AqzenZHmhh7UBWTw=";
   string accountId = IntegerToString(AccountNumber()); 
   string licenseB64 = "";
   //string licenseB64 = "ht4AoFy8o2UWNSBqCIcnLaAQqq6iAWjHrB3xZU+UA571yv/soPmyCTLSDClOQSsOiDcn1mFk1CpspKT5pErhT6v7ua8aHIwLghnzcEC2qfo/gdX9HvX/RHZ7eLOEOH2TU6iSf22LpX9N9B9+7pTm6+oLJV0U5VVfGwT4Q3MVZCs=";
   //string accountId = "1234"; 
   
   // MQL4/Files/license.txt
   int handle = FileOpen("license.txt", FILE_READ | FILE_TXT | FILE_ANSI);
   if (handle < 0)
   {
      Comment("ライセンスファイルの読み込みに失敗しました");
      return INIT_FAILED;
   }
   licenseB64 = FileReadString(handle);
   FileClose(handle);

   // DLLに渡すためのuchar配列を用意
   uchar masterKeyBuf[128];
   uchar licenseBuf[1024];
   uchar accountIdBuf[32];

   StringToCharArray(masterKey, masterKeyBuf);
   StringToCharArray(licenseB64, licenseBuf);
   StringToCharArray(accountId, accountIdBuf);

   uchar outPayload[4096];
   int outLen = ArraySize(outPayload);

   int result = DecryptLicense(
      masterKeyBuf,
      licenseBuf,
      accountIdBuf,
      outPayload,
      outLen
   );

   if (result == 0)
   {
      string decoded = CharArrayToString(outPayload, 0, outLen);
      Comment("復号成功\\n", decoded);
   }
   else
   {
      Comment("復号失敗（コード: ", result, "）");
   }

   return INIT_SUCCEEDED;
}`,
    MT5: `#include <SankeyDecoder.mqh>

int OnInit()
{
   string masterKey = "9H6DEu8Z0Mipgz1djyM4eUeBqZ9AqzenZHmhh7UBWTw=";
   string accountId = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)); 
   string licenseB64 = "";
   //string licenseB64 = "ht4AoFy8o2UWNSBqCIcnLaAQqq6iAWjHrB3xZU+UA571yv/soPmyCTLSDClOQSsOiDcn1mFk1CpspKT5pErhT6v7ua8aHIwLghnzcEC2qfo/gdX9HvX/RHZ7eLOEOH2TU6iSf22LpX9N9B9+7pTm6+oLJV0U5VVfGwT4Q3MVZCs=";
   //string accountId = "1234"; 
   
   // MQL5/Files/license.txt
   int handle = FileOpen("license.txt", FILE_READ | FILE_TXT | FILE_ANSI);
   if (handle == INVALID_HANDLE)
   {
      Comment("ライセンスファイルの読み込みに失敗しました");
      return INIT_FAILED;
   }
   licenseB64 = FileReadString(handle);
   FileClose(handle);

   // DLLに渡すためのuchar配列を用意
   uchar masterKeyBuf[128];
   uchar licenseBuf[1024];
   uchar accountIdBuf[32];

   StringToCharArray(masterKey, masterKeyBuf);
   StringToCharArray(licenseB64, licenseBuf);
   StringToCharArray(accountId, accountIdBuf);

   uchar outPayload[4096];
   int outLen = ArraySize(outPayload);

   int result = DecryptLicense(
      masterKeyBuf,
      licenseBuf,
      accountIdBuf,
      outPayload,
      outLen
   );

   if (result == 0)
   {
      string decoded = CharArrayToString(outPayload, 0, outLen);
      Comment("復号成功\\n", decoded);
   }
   else
   {
      Comment("復号失敗（コード: ", result, "）");
   }

   return INIT_SUCCEEDED;
}`,
  }

  return (
      <div className="space-y-4">
        {/* Version Selector */}
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium theme-text-secondary">{t('platform')}:</span>
          <div className="flex space-x-2">
            <Button
                variant={selectedVersion === "MT4" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedVersion("MT4")}
                className={
                  selectedVersion === "MT4"
                      ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                      : "border-emerald-500/40 theme-text-emerald hover:bg-emerald-500/20"
                }
            >
              MT4
            </Button>
            <Button
                variant={selectedVersion === "MT5" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedVersion("MT5")}
                className={
                  selectedVersion === "MT5"
                      ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                      : "border-emerald-500/40 theme-text-emerald hover:bg-emerald-500/20"
                }
            >
              MT5
            </Button>
          </div>
        </div>

        {/* Code Block */}
        <Card className="theme-card-bg border-emerald-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="theme-text-primary flex items-center text-lg">
              <Code className="w-5 h-5 mr-2 text-emerald-400" />
              {t('codeExample', { platform: selectedVersion })}
              <Badge className="ml-2 bg-emerald-500 text-white text-xs">{selectedVersion}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
            <pre className="text-sm text-emerald-300">
              <code>{codeExamples[selectedVersion]}</code>
            </pre>
            </div>
          </CardContent>
        </Card>

        {/* Version Differences */}
        <Card className="theme-card-bg border-emerald-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="theme-text-primary text-base">{t('mainDifferences')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h6 className="font-medium theme-text-primary mb-2">MT4版</h6>
                <ul className="space-y-1 theme-text-secondary">
                  {t.raw('mt4Differences').map((diff: string, index: number) => (
                      <li key={index}>• {diff}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h6 className="font-medium theme-text-primary mb-2">MT5版</h6>
                <ul className="space-y-1 theme-text-secondary">
                  {t.raw('mt5Differences').map((diff: string, index: number) => (
                      <li key={index}>• {diff}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
  )
}