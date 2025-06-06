#pragma once

#include <string>
#include <nlohmann/json.hpp>

#ifdef __cplusplus
extern "C" {
#endif

// License status enumeration
enum LicenseStatus {
    Valid = 0,
    Expired = 1,
    Invalid = 2,
    Tampered = 3,
    KeyError = 4,
    DecryptionFailed = 5,
    ParseError = 6
};

// Forward declaration for C interface
class CSankeyLicenseDecoder;

// C Interface functions
__declspec(dllexport) CSankeyLicenseDecoder* Create();
__declspec(dllexport) void Destroy(CSankeyLicenseDecoder* decoder);
__declspec(dllexport) int Verify(CSankeyLicenseDecoder* decoder, const char* masterKeyB64, const char* licenseB64, const char* accountId);

// Getter functions
__declspec(dllexport) const char* GetValue(CSankeyLicenseDecoder* decoder, const char* key, const char* defaultValue);
__declspec(dllexport) int GetValueAsInt(CSankeyLicenseDecoder* decoder, const char* key, int defaultValue);
__declspec(dllexport) bool GetValueAsBool(CSankeyLicenseDecoder* decoder, const char* key, bool defaultValue);
__declspec(dllexport) double GetValueAsDouble(CSankeyLicenseDecoder* decoder, const char* key, double defaultValue);
__declspec(dllexport) long GetValueAsDateTime(CSankeyLicenseDecoder* decoder, const char* key, long defaultValue);
__declspec(dllexport) bool HasKey(CSankeyLicenseDecoder* decoder, const char* key);

#ifdef __cplusplus
}

// C++ Class definition
class CSankeyLicenseDecoder {
private:
    nlohmann::json payload_;
    bool isVerified_;
    std::string lastStringResult_; // For returning const char* safely

    // Utility functions
    bool base64_decode(const std::string& in, std::vector<unsigned char>& out);
    bool hmac_sha256(const std::vector<unsigned char>& key, const std::vector<unsigned char>& data, std::vector<unsigned char>& mac);
    bool aes_cbc_decrypt(const std::vector<unsigned char>& key, const std::vector<unsigned char>& iv,
                        const std::vector<unsigned char>& cipher, std::vector<unsigned char>& plain);
    long parseISODateTime(const std::string& isoString);

public:
    CSankeyLicenseDecoder();
    ~CSankeyLicenseDecoder();

    LicenseStatus verify(const char* masterKeyB64, const char* licenseB64, const char* accountId);
    
    // Getter methods
    std::string getValue(const char* key, const char* defaultValue = "");
    int getValueAsInt(const char* key, int defaultValue = 0);
    bool getValueAsBool(const char* key, bool defaultValue = false);
    double getValueAsDouble(const char* key, double defaultValue = 0.0);
    long getValueAsDateTime(const char* key, long defaultValue = 0);
    bool hasKey(const char* key);
};

#endif