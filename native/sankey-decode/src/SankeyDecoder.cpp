#include "SankeyDecoder.h"
#include <windows.h>
#include <wincrypt.h>
#include <vector>
#include <cstring>
#include <ctime>
#include <sstream>
#include <iomanip>

CSankeyLicenseDecoder::CSankeyLicenseDecoder() : isVerified_(false) {
}

CSankeyLicenseDecoder::~CSankeyLicenseDecoder() {
}

// Utility: Base64 decode
bool CSankeyLicenseDecoder::base64_decode(const std::string& in, std::vector<unsigned char>& out) {
    DWORD len = 0;
    if (!CryptStringToBinaryA(in.c_str(), 0, CRYPT_STRING_BASE64, NULL, &len, NULL, NULL))
        return false;
    out.resize(len);
    return CryptStringToBinaryA(in.c_str(), 0, CRYPT_STRING_BASE64, out.data(), &len, NULL, NULL) != 0;
}

// Utility: HMAC-SHA256
bool CSankeyLicenseDecoder::hmac_sha256(const std::vector<unsigned char>& key, const std::vector<unsigned char>& data, std::vector<unsigned char>& mac) {
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    HCRYPTKEY hKey = 0;

    struct {
        BLOBHEADER hdr;
        DWORD keyLen;
    } blobHeader = {
        {PLAINTEXTKEYBLOB, CUR_BLOB_VERSION, 0, CALG_RC2},
        (DWORD)key.size()
    };

    std::vector<unsigned char> blob(sizeof(blobHeader) + key.size());
    memcpy(blob.data(), &blobHeader, sizeof(blobHeader));
    memcpy(blob.data() + sizeof(blobHeader), key.data(), key.size());

    mac.resize(32);

    if (!CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT)) return false;
    bool ok = false;
    if (CryptImportKey(hProv, blob.data(), blob.size(), 0, CRYPT_IPSEC_HMAC_KEY, &hKey)) {
        if (CryptCreateHash(hProv, CALG_HMAC, hKey, 0, &hHash)) {
            HMAC_INFO hmacInfo;
            ZeroMemory(&hmacInfo, sizeof(hmacInfo));
            hmacInfo.HashAlgid = CALG_SHA_256;
            CryptSetHashParam(hHash, HP_HMAC_INFO, (BYTE*)&hmacInfo, 0);
            CryptHashData(hHash, data.data(), data.size(), 0);
            DWORD macLen = 32;
            if (CryptGetHashParam(hHash, HP_HASHVAL, mac.data(), &macLen, 0)) ok = true;
            CryptDestroyHash(hHash);
        }
        CryptDestroyKey(hKey);
    }
    CryptReleaseContext(hProv, 0);
    return ok;
}

// Utility: AES-CBC decrypt
bool CSankeyLicenseDecoder::aes_cbc_decrypt(const std::vector<unsigned char>& key, const std::vector<unsigned char>& iv,
                     const std::vector<unsigned char>& cipher, std::vector<unsigned char>& plain) {
    HCRYPTPROV hProv = 0;
    HCRYPTKEY hKey = 0;

    struct {
        BLOBHEADER hdr;
        DWORD keyLen;
    } blobHeader = {
        {PLAINTEXTKEYBLOB, CUR_BLOB_VERSION, 0, CALG_AES_256},
        (DWORD)key.size()
    };
    std::vector<unsigned char> blob(sizeof(blobHeader) + key.size());
    memcpy(blob.data(), &blobHeader, sizeof(blobHeader));
    memcpy(blob.data() + sizeof(blobHeader), key.data(), key.size());

    bool ok = false;
    if (!CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT)) return false;
    if (CryptImportKey(hProv, blob.data(), blob.size(), 0, 0, &hKey)) {
        CryptSetKeyParam(hKey, KP_IV, iv.data(), 0);
        plain = cipher;
        DWORD plen = (DWORD)plain.size();
        if (CryptDecrypt(hKey, 0, TRUE, 0, plain.data(), &plen)) {
            plain.resize(plen);
            ok = true;
        }
        CryptDestroyKey(hKey);
    }
    CryptReleaseContext(hProv, 0);
    return ok;
}

// Parse ISO 8601 date string to UNIX timestamp
long CSankeyLicenseDecoder::parseISODateTime(const std::string& isoString) {
    std::tm tm = {};
    std::istringstream ss(isoString);
    
    // Parse ISO format: "2025-12-31T23:59:59.000Z" or "2025-12-31T23:59:59Z"
    ss >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
    
    if (ss.fail()) {
        return 0; // Failed to parse
    }
    
    // Convert to time_t (UNIX timestamp)
    time_t timestamp = _mkgmtime(&tm); // Use _mkgmtime for UTC
    
    return static_cast<long>(timestamp);
}

LicenseStatus CSankeyLicenseDecoder::verify(const char* masterKeyB64, const char* licenseB64, const char* accountId) {
    isVerified_ = false;
    payload_.clear();

    if (!masterKeyB64 || !licenseB64 || !accountId) {
        return Invalid;
    }

    // Decode master key
    std::vector<unsigned char> masterKey;
    if (!base64_decode(masterKeyB64, masterKey)) {
        return KeyError;
    }
    if (masterKey.size() != 32) {
        return KeyError;
    }

    // Decode license
    std::vector<unsigned char> licenseBin;
    if (!base64_decode(licenseB64, licenseBin)) {
        return Invalid;
    }
    if (licenseBin.size() < 48) {
        return Invalid;
    }

    // Extract components
    std::vector<unsigned char> iv(licenseBin.begin(), licenseBin.begin() + 16);
    std::vector<unsigned char> hmac(licenseBin.begin() + 16, licenseBin.begin() + 48);
    std::vector<unsigned char> cipher(licenseBin.begin() + 48, licenseBin.end());

    // Verify HMAC
    std::vector<unsigned char> hmacInput;
    hmacInput.insert(hmacInput.end(), iv.begin(), iv.end());
    hmacInput.insert(hmacInput.end(), cipher.begin(), cipher.end());
    hmacInput.insert(hmacInput.end(), (unsigned char*)accountId, (unsigned char*)accountId + strlen(accountId));
    std::vector<unsigned char> mac;
    if (!hmac_sha256(masterKey, hmacInput, mac)) {
        return DecryptionFailed;
    }
    if (memcmp(mac.data(), hmac.data(), 32) != 0) {
        return Tampered;
    }

    // Decrypt
    std::vector<unsigned char> plain;
    if (!aes_cbc_decrypt(masterKey, iv, cipher, plain)) {
        return DecryptionFailed;
    }

    // Parse JSON
    try {
        std::string payloadStr(reinterpret_cast<char*>(plain.data()), plain.size());
        payload_ = nlohmann::json::parse(payloadStr);
    } catch (const nlohmann::json::exception& e) {
        return ParseError;
    }

    // Check expiry if present
    if (payload_.contains("expiry") && payload_["expiry"].is_string()) {
        std::string expiryStr = payload_["expiry"];
        long expiryTimestamp = parseISODateTime(expiryStr);
        if (expiryTimestamp > 0) {
            time_t currentTime = time(nullptr);
            if (currentTime > expiryTimestamp) {
                return Expired;
            }
        }
    }

    isVerified_ = true;
    return Valid;
}

std::string CSankeyLicenseDecoder::getValue(const char* key, const char* defaultValue) {
    if (!isVerified_ || !key) {
        return std::string(defaultValue ? defaultValue : "");
    }

    try {
        if (payload_.contains(key) && payload_[key].is_string()) {
            return payload_[key];
        }
    } catch (const nlohmann::json::exception& e) {
        // Fall through to default
    }

    return std::string(defaultValue ? defaultValue : "");
}

int CSankeyLicenseDecoder::getValueAsInt(const char* key, int defaultValue) {
    if (!isVerified_ || !key) {
        return defaultValue;
    }

    try {
        if (payload_.contains(key)) {
            if (payload_[key].is_number_integer()) {
                return payload_[key];
            } else if (payload_[key].is_string()) {
                std::string str = payload_[key];
                return std::stoi(str);
            }
        }
    } catch (const std::exception& e) {
        // Fall through to default
    }

    return defaultValue;
}

bool CSankeyLicenseDecoder::getValueAsBool(const char* key, bool defaultValue) {
    if (!isVerified_ || !key) {
        return defaultValue;
    }

    try {
        if (payload_.contains(key)) {
            if (payload_[key].is_boolean()) {
                return payload_[key];
            } else if (payload_[key].is_string()) {
                std::string str = payload_[key];
                return (str == "true" || str == "1" || str == "yes");
            } else if (payload_[key].is_number()) {
                return payload_[key] != 0;
            }
        }
    } catch (const std::exception& e) {
        // Fall through to default
    }

    return defaultValue;
}

double CSankeyLicenseDecoder::getValueAsDouble(const char* key, double defaultValue) {
    if (!isVerified_ || !key) {
        return defaultValue;
    }

    try {
        if (payload_.contains(key)) {
            if (payload_[key].is_number()) {
                return payload_[key];
            } else if (payload_[key].is_string()) {
                std::string str = payload_[key];
                return std::stod(str);
            }
        }
    } catch (const std::exception& e) {
        // Fall through to default
    }

    return defaultValue;
}

long CSankeyLicenseDecoder::getValueAsDateTime(const char* key, long defaultValue) {
    if (!isVerified_ || !key) {
        return defaultValue;
    }

    try {
        if (payload_.contains(key) && payload_[key].is_string()) {
            std::string dateStr = payload_[key];
            long timestamp = parseISODateTime(dateStr);
            return timestamp > 0 ? timestamp : defaultValue;
        }
    } catch (const std::exception& e) {
        // Fall through to default
    }

    return defaultValue;
}

bool CSankeyLicenseDecoder::hasKey(const char* key) {
    if (!isVerified_ || !key) {
        return false;
    }

    return payload_.contains(key);
}

// C Interface implementations
extern "C" {

CSankeyLicenseDecoder* Create() {
    return new CSankeyLicenseDecoder();
}

void Destroy(CSankeyLicenseDecoder* decoder) {
    delete decoder;
}

int Verify(CSankeyLicenseDecoder* decoder, const char* masterKeyB64, const char* licenseB64, const char* accountId) {
    if (!decoder) return Invalid;
    return static_cast<int>(decoder->verify(masterKeyB64, licenseB64, accountId));
}

const char* GetValue(CSankeyLicenseDecoder* decoder, const char* key, const char* defaultValue) {
    if (!decoder) return defaultValue ? defaultValue : "";
    
    decoder->lastStringResult_ = decoder->getValue(key, defaultValue);
    return decoder->lastStringResult_.c_str();
}

int GetValueAsInt(CSankeyLicenseDecoder* decoder, const char* key, int defaultValue) {
    if (!decoder) return defaultValue;
    return decoder->getValueAsInt(key, defaultValue);
}

bool GetValueAsBool(CSankeyLicenseDecoder* decoder, const char* key, bool defaultValue) {
    if (!decoder) return defaultValue;
    return decoder->getValueAsBool(key, defaultValue);
}

double GetValueAsDouble(CSankeyLicenseDecoder* decoder, const char* key, double defaultValue) {
    if (!decoder) return defaultValue;
    return decoder->getValueAsDouble(key, defaultValue);
}

long GetValueAsDateTime(CSankeyLicenseDecoder* decoder, const char* key, long defaultValue) {
    if (!decoder) return defaultValue;
    return decoder->getValueAsDateTime(key, defaultValue);
}

bool HasKey(CSankeyLicenseDecoder* decoder, const char* key) {
    if (!decoder) return false;
    return decoder->hasKey(key);
}

}