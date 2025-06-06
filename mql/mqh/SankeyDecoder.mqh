//+------------------------------------------------------------------+
//|                                         SankeyLicenseDecoder.mqh |
//|                                           Copyright 2025, poruru |
//|                                             https://www.mql5.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2025, poruru"
#property link      "https://www.mql5.com"
#property strict

//+------------------------------------------------------------------+
//| License Status Constants                                         |
//+------------------------------------------------------------------+
#define LICENSE_VALID           0
#define LICENSE_EXPIRED         1
#define LICENSE_INVALID         2
#define LICENSE_TAMPERED        3
#define LICENSE_KEY_ERROR       4
#define LICENSE_DECRYPTION_FAILED 5
#define LICENSE_PARSE_ERROR     6

//+------------------------------------------------------------------+
//| DLL imports                                                      |
//+------------------------------------------------------------------+
#import "SankeyDecoder.dll"
// Core functions
int Create();
void Destroy(int decoder);
int Verify(int decoder, const uchar &masterKeyB64[], const uchar &licenseB64[], const uchar &accountId[]);

// Getter functions
string GetValue(int decoder, const uchar &key[], const uchar &defaultValue[]);
int GetValueAsInt(int decoder, const uchar &key[], int defaultValue);
bool GetValueAsBool(int decoder, const uchar &key[], bool defaultValue);
double GetValueAsDouble(int decoder, const uchar &key[], double defaultValue);
long GetValueAsDateTime(int decoder, const uchar &key[], long defaultValue);
bool HasKey(int decoder, const uchar &key[]);
#import

//+------------------------------------------------------------------+
//| Payload structure definitions                                    |
//+------------------------------------------------------------------+
struct SankeyPayloadV1
{
   string version;
   string eaName;
   string accountId;
   datetime expiry;
   string userId;
   datetime issuedAt;
};

//+------------------------------------------------------------------+
//| SankeyLicenseDecoder wrapper class                              |
//+------------------------------------------------------------------+
class CSankeyLicenseDecoder
{
private:
   int m_decoder_handle;
   bool m_is_valid;

   //+------------------------------------------------------------------+
   //| Internal helper methods for value retrieval                     |
   //+------------------------------------------------------------------+
   string GetValue(string key, string defaultValue = "")
   {
      if(!m_is_valid) return defaultValue;

      uchar keyBuf[256];
      uchar defaultBuf[256];

      StringToCharArray(key, keyBuf);
      StringToCharArray(defaultValue, defaultBuf);

      return GetValue(m_decoder_handle, keyBuf, defaultBuf);
   }

   datetime GetValueAsDateTime(string key, datetime defaultValue = 0)
   {
      if(!m_is_valid) return defaultValue;

      uchar keyBuf[256];
      StringToCharArray(key, keyBuf);

      long timestamp = GetValueAsDateTime(m_decoder_handle, keyBuf, (long)defaultValue);
      return (datetime)timestamp;
   }

public:
   //+------------------------------------------------------------------+
   //| Constructor                                                      |
   //+------------------------------------------------------------------+
   CSankeyLicenseDecoder()
   {
      m_decoder_handle = Create();
      m_is_valid = (m_decoder_handle != 0);
   }

   //+------------------------------------------------------------------+
   //| Destructor                                                       |
   //+------------------------------------------------------------------+
   ~CSankeyLicenseDecoder()
   {
      if(m_is_valid && m_decoder_handle != 0)
      {
         Destroy(m_decoder_handle);
         m_decoder_handle = 0;
         m_is_valid = false;
      }
   }

   //+------------------------------------------------------------------+
   //| Verify license                                                   |
   //+------------------------------------------------------------------+
   int Verify(string masterKeyB64, string licenseB64, string accountId)
   {
      if(!m_is_valid) return LICENSE_INVALID;

      uchar masterKeyBuf[128];
      uchar licenseBuf[2048];
      uchar accountIdBuf[64];

      StringToCharArray(masterKeyB64, masterKeyBuf);
      StringToCharArray(licenseB64, licenseBuf);
      StringToCharArray(accountId, accountIdBuf);

      return Verify(m_decoder_handle, masterKeyBuf, licenseBuf, accountIdBuf);
   }

   //+------------------------------------------------------------------+
   //| Get payload version                                              |
   //+------------------------------------------------------------------+
   string GetVersion()
   {
      return GetValue("version", "v1");
   }

   //+------------------------------------------------------------------+
   //| Get payload as V1 structure                                      |
   //+------------------------------------------------------------------+
   SankeyPayloadV1 GetPayload()
   {
      SankeyPayloadV1 payload;
      
      payload.version = GetValue("version", "v1");
      payload.eaName = GetValue("eaName", "");
      payload.accountId = GetValue("accountId", "");
      payload.expiry = GetValueAsDateTime("expiry", 0);
      payload.userId = GetValue("userId", "");
      payload.issuedAt = GetValueAsDateTime("issuedAt", 0);
      
      return payload;
   }

   //+------------------------------------------------------------------+
   //| Check if decoder is valid                                        |
   //+------------------------------------------------------------------+
   bool IsValid()
   {
      return m_is_valid;
   }
};