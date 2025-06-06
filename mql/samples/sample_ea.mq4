#include <SankeyLicenseDecoder.mqh>

int OnInit()
{
   string masterKey = "9H6DEu8Z0Mipgz1djyM4eUeBqZ9AqzenZHmhh7UBWTw=";
   string accountId = IntegerToString(AccountNumber()); 
   string licenseB64 = "";
   
   // MQL4/Files/license.txt からライセンスを読み込み
   int handle = FileOpen("license.txt", FILE_READ | FILE_TXT | FILE_ANSI);
   if (handle < 0)
   {
      Comment("ライセンスファイルの読み込みに失敗しました");
      return INIT_FAILED;
   }
   licenseB64 = FileReadString(handle);
   FileClose(handle);

   // ライセンスデコーダーを作成
   CSankeyLicenseDecoder decoder;
   
   if (!decoder.IsValid())
   {
      Comment("ライセンスデコーダーの初期化に失敗しました");
      return INIT_FAILED;
   }

   // ライセンス検証
   int result = decoder.Verify(masterKey, licenseB64, accountId);

   switch(result)
   {
      case LICENSE_VALID:
         {
            // ライセンス情報を構造体で取得
            SankeyPayloadV1 payload = decoder.GetPayload();
            
            Comment(
               "ライセンス認証成功\n",
               "バージョン: ", payload.version, "\n",
               "EA名: ", payload.eaName, "\n",
               "ユーザーID: ", payload.userId, "\n",
               "有効期限: ", TimeToString(payload.expiry, TIME_DATE|TIME_MINUTES), "\n",
               "発行日: ", TimeToString(payload.issuedAt, TIME_DATE|TIME_MINUTES), "\n",
               "アカウント: ", payload.accountId
            );
            
            // ライセンス情報の利用例
            Print("ライセンスバージョン: ", payload.version);
            Print("対象EA: ", payload.eaName);
            Print("ライセンス有効期限まで: ", (payload.expiry - TimeCurrent()) / 86400, " 日");
            
            // バージョンチェックの例
            if (payload.version == "v1")
            {
               Print("バージョンv1のライセンスです");
            }
            
            break;
         }
      case LICENSE_EXPIRED:
         Comment("ライセンスが期限切れです");
         return INIT_FAILED;
         
      case LICENSE_TAMPERED:
         Comment("ライセンスが改ざんされています");
         return INIT_FAILED;
         
      case LICENSE_INVALID:
         Comment("無効なライセンスです");
         return INIT_FAILED;
         
      case LICENSE_KEY_ERROR:
         Comment("マスターキーエラー");
         return INIT_FAILED;
         
      case LICENSE_DECRYPTION_FAILED:
         Comment("ライセンスの復号に失敗しました");
         return INIT_FAILED;
         
      case LICENSE_PARSE_ERROR:
         Comment("ライセンスデータの解析に失敗しました");
         return INIT_FAILED;
         
      default:
         Comment("不明なエラー（コード: ", result, "）");
         return INIT_FAILED;
   }

   return INIT_SUCCEEDED;
}

void OnTick()
{
   // EA のメインロジックをここに実装
   // ライセンス認証が成功した場合のみ実行される
}

void OnDeinit(const int reason)
{
   Comment("");
}