"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Code } from "lucide-react"
import { useTranslations } from "next-intl";

export function MtVersionSelector() {
  const t = useTranslations('developer.mtSelector');
  const [selectedVersion, setSelectedVersion] = useState<"MT4" | "MT5">("MT4")

  const codeExamples = {
    MT4: `#include <SankeyDecoder.mqh>

int OnInit()
{
   string masterKey = "9H6DEu8Z0Mipgz1djyM4eUeBqZ9AqzenZHmhh7UBWTw="; // Replace with your actual master key
   string accountId = IntegerToString(AccountNumber()); 
   string licenseB64 = "";
   // Example: string licenseB64 = "ht4AoFy8o2UWNSBqCIcnLaAQqq6iAWjHrB3xZU+UA571yv/soPmyCTLSDClOQSsOiDcn1mFk1CpspKT5pErhT6v7ua8aHIwLghnzcEC2qfo/gdX9HvX/RHZ7eLOEOH2TU6iSf22LpX9N9B9+7pTm6+oLJV0U5VVfGwT4Q3MVZCs=";
   // Example: string accountId = "1234";
   
   // MQL4/Files/license.txt
   int handle = FileOpen("license.txt", FILE_READ | FILE_TXT | FILE_ANSI);
   if (handle < 0)
   {
      Comment("${t('codeComments.loadFailed')}");
      return INIT_FAILED;
   }
   licenseB64 = FileReadString(handle);
   FileClose(handle);

   // Prepare uchar arrays for DLL
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
      Comment("${t('codeComments.decryptionSuccess', { json: 'decoded' })}"); // Placeholder, actual JSON is in 'decoded'
   }
   else
   {
      Comment("${t('codeComments.decryptionFailed', { errorCode: 'result' })}"); // Placeholder, actual code is in 'result'
   }

   return INIT_SUCCEEDED;
}`,
    MT5: `#include <SankeyDecoder.mqh>

int OnInit()
{
   string masterKey = "9H6DEu8Z0Mipgz1djyM4eUeBqZ9AqzenZHmhh7UBWTw="; // Replace with your actual master key
   string accountId = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)); 
   string licenseB64 = "";
   // Example: string licenseB64 = "ht4AoFy8o2UWNSBqCIcnLaAQqq6iAWjHrB3xZU+UA571yv/soPmyCTLSDClOQSsOiDcn1mFk1CpspKT5pErhT6v7ua8aHIwLghnzcEC2qfo/gdX9HvX/RHZ7eLOEOH2TU6iSf22LpX9N9B9+7pTm6+oLJV0U5VVfGwT4Q3MVZCs=";
   // Example: string accountId = "1234";
   
   // MQL5/Files/license.txt
   int handle = FileOpen("license.txt", FILE_READ | FILE_TXT | FILE_ANSI);
   if (handle == INVALID_HANDLE)
   {
      Comment("${t('codeComments.loadFailed')}");
      return INIT_FAILED;
   }
   licenseB64 = FileReadString(handle);
   FileClose(handle);

   // Prepare uchar arrays for DLL
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
      Comment("${t('codeComments.decryptionSuccess', { json: 'decoded' })}"); // Placeholder
   }
   else
   {
      Comment("${t('codeComments.decryptionFailed', { errorCode: 'result' })}"); // Placeholder
   }

   return INIT_SUCCEEDED;
}`,
  }
  // Note: The actual replacement of {json} and {errorCode} in Comment() calls
  // would happen inside the MQL code itself, not directly via t().
  // Here, t() provides the template string.

  return (
    <div className="space-y-4">
      {/* Version Selector */}
      <div className="flex items-center space-x-2">
        <span className="text-sm font-medium theme-text-secondary">{t('platformLabel')}</span>
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
            {t('mt4Button')}
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
            {t('mt5Button')}
          </Button>
        </div>
      </div>

      {/* Code Block */}
      <Card className="theme-card-bg border-emerald-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="theme-text-primary flex items-center text-lg">
            <Code className="w-5 h-5 mr-2 text-emerald-400" />
            {t('implementationCodeTitle', { version: selectedVersion })}
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
          <CardTitle className="theme-text-primary text-base">{t('differences.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h6 className="font-medium theme-text-primary mb-2">{t('differences.mt4.title')}</h6>
              <ul className="space-y-1 theme-text-secondary">
                <li>{t('differences.mt4.point1')}</li>
                <li>{t('differences.mt4.point2')}</li>
                <li>{t('differences.mt4.point3')}</li>
              </ul>
            </div>
            <div>
              <h6 className="font-medium theme-text-primary mb-2">{t('differences.mt5.title')}</h6>
              <ul className="space-y-1 theme-text-secondary">
                <li>{t('differences.mt5.point1')}</li>
                <li>{t('differences.mt5.point2')}</li>
                <li>{t('differences.mt5.point3')}</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
