#include <gtest/gtest.h>
#include "SankeyDecoder.h"

class SankeyLicenseDecoderTest : public ::testing::Test {
protected:
    void SetUp() override {
        decoder = Create();
        ASSERT_NE(decoder, nullptr);
    }

    void TearDown() override {
        if (decoder) {
            Destroy(decoder);
            decoder = nullptr;
        }
    }

    CSankeyLicenseDecoder* decoder = nullptr;
    
    // Test data from the original test
    const char* masterKeyB64 = "9H6DEu8Z0Mipgz1djyM4eUeBqZ9AqzenZHmhh7UBWTw=";
    const char* licenseB64 = "ht4AoFy8o2UWNSBqCIcnLaAQqq6iAWjHrB3xZU+UA571yv/soPmyCTLSDClOQSsOiDcn1mFk1CpspKT5pErhT6v7ua8aHIwLghnzcEC2qfo/gdX9HvX/RHZ7eLOEOH2TU6iSf22LpX9N9B9+7pTm6+oLJV0U5VVfGwT4Q3MVZCs=";
    const char* accountId = "1234";
};

TEST_F(SankeyLicenseDecoderTest, CreateAndDestroy) {
    EXPECT_NE(decoder, nullptr);
}

TEST_F(SankeyLicenseDecoderTest, VerifyValidLicense) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    EXPECT_EQ(result, Valid);
}

TEST_F(SankeyLicenseDecoderTest, VerifyInvalidKey) {
    const char* invalidKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    int result = Verify(decoder, invalidKey, licenseB64, accountId);
    EXPECT_EQ(result, Tampered);
}

TEST_F(SankeyLicenseDecoderTest, VerifyInvalidAccountId) {
    int result = Verify(decoder, masterKeyB64, licenseB64, "9999");
    EXPECT_EQ(result, Tampered);
}

TEST_F(SankeyLicenseDecoderTest, GetStringValues) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    ASSERT_EQ(result, Valid);

    const char* eaName = GetValue(decoder, "eaName", "");
    EXPECT_STREQ(eaName, "MyEA");

    const char* accountIdFromPayload = GetValue(decoder, "accountId", "");
    EXPECT_STREQ(accountIdFromPayload, "1234");

    const char* nonExisting = GetValue(decoder, "nonExistentKey", "defaultValue");
    EXPECT_STREQ(nonExisting, "defaultValue");
}

TEST_F(SankeyLicenseDecoderTest, GetDateTimeValues) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    ASSERT_EQ(result, Valid);

    long expiryTimestamp = GetValueAsDateTime(decoder, "expiry", 0);
    EXPECT_GT(expiryTimestamp, 0);

    long nonExistingDate = GetValueAsDateTime(decoder, "nonExistentDate", 12345);
    EXPECT_EQ(nonExistingDate, 12345);
}

TEST_F(SankeyLicenseDecoderTest, GetBooleanValues) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    ASSERT_EQ(result, Valid);

    bool defaultTrue = GetValueAsBool(decoder, "nonExistentBool", true);
    EXPECT_TRUE(defaultTrue);

    bool defaultFalse = GetValueAsBool(decoder, "nonExistentBool", false);
    EXPECT_FALSE(defaultFalse);
}

TEST_F(SankeyLicenseDecoderTest, GetNumericValues) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    ASSERT_EQ(result, Valid);

    int defaultInt = GetValueAsInt(decoder, "nonExistentInt", 42);
    EXPECT_EQ(defaultInt, 42);

    double defaultDouble = GetValueAsDouble(decoder, "nonExistentDouble", 3.14);
    EXPECT_DOUBLE_EQ(defaultDouble, 3.14);
}

TEST_F(SankeyLicenseDecoderTest, HasKeyFunction) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    ASSERT_EQ(result, Valid);

    EXPECT_TRUE(HasKey(decoder, "eaName"));
    EXPECT_TRUE(HasKey(decoder, "accountId"));
    EXPECT_TRUE(HasKey(decoder, "expiry"));

    EXPECT_FALSE(HasKey(decoder, "nonExistentKey"));
}

TEST_F(SankeyLicenseDecoderTest, GetValuesWithoutVerification) {
    const char* value = GetValue(decoder, "eaName", "default");
    EXPECT_STREQ(value, "default");

    int intValue = GetValueAsInt(decoder, "someInt", 99);
    EXPECT_EQ(intValue, 99);

    bool hasKey = HasKey(decoder, "eaName");
    EXPECT_FALSE(hasKey);
}

TEST_F(SankeyLicenseDecoderTest, InvalidLicenseFormat) {
    const char* invalidLicense = "InvalidBase64!@#$";
    int result = Verify(decoder, masterKeyB64, invalidLicense, accountId);
    EXPECT_EQ(result, Invalid);
}

TEST_F(SankeyLicenseDecoderTest, NullPointerHandling) {
    const char* value = GetValue(nullptr, "key", "default");
    EXPECT_STREQ(value, "default");

    int intValue = GetValueAsInt(nullptr, "key", 42);
    EXPECT_EQ(intValue, 42);

    bool hasKey = HasKey(nullptr, "key");
    EXPECT_FALSE(hasKey);
}

TEST_F(SankeyLicenseDecoderTest, EmptyStringHandling) {
    int result = Verify(decoder, masterKeyB64, licenseB64, accountId);
    ASSERT_EQ(result, Valid);

    const char* emptyDefault = GetValue(decoder, "nonExistentKey", "");
    EXPECT_STREQ(emptyDefault, "");
}

TEST_F(SankeyLicenseDecoderTest, VerifyWithNullParameters) {
    int result1 = Verify(decoder, nullptr, licenseB64, accountId);
    EXPECT_EQ(result1, Invalid);

    int result2 = Verify(decoder, masterKeyB64, nullptr, accountId);
    EXPECT_EQ(result2, Invalid);

    int result3 = Verify(decoder, masterKeyB64, licenseB64, nullptr);
    EXPECT_EQ(result3, Invalid);
}