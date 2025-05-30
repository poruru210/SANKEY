import { APIGatewayClient, GetApiKeysCommand, GetUsagePlansCommand } from '@aws-sdk/client-api-gateway';

const apiGatewayClient = new APIGatewayClient({});

/**
 * ユーザーIDに基づいてAPI Keyを取得
 */
export async function getApiKeyByUserId(userId: string): Promise<string | null> {
  try {
    const response = await apiGatewayClient.send(new GetApiKeysCommand({
      includeValues: true,
    }));

    const apiKey = response.items?.find(key => 
      key.tags?.userId === userId
    );

    return apiKey?.value || null;
  } catch (error) {
    console.error('Failed to get API key:', error);
    return null;
  }
}

/**
 * ユーザーIDに基づいてUsage Planを取得
 */
export async function getUsagePlanByUserId(userId: string): Promise<string | null> {
  try {
    const response = await apiGatewayClient.send(new GetUsagePlansCommand({}));

    const usagePlan = response.items?.find(plan => 
      plan.tags?.userId === userId
    );

    return usagePlan?.id || null;
  } catch (error) {
    console.error('Failed to get usage plan:', error);
    return null;
  }
}

/**
 * API KeyとUsage Planの存在確認
 */
export async function verifyUserApiSetup(userId: string): Promise<{
  hasApiKey: boolean;
  hasUsagePlan: boolean;
  apiKeyId?: string;
  usagePlanId?: string;
}> {
  const [apiKey, usagePlanId] = await Promise.all([
    getApiKeyByUserId(userId),
    getUsagePlanByUserId(userId),
  ]);

  return {
    hasApiKey: !!apiKey,
    hasUsagePlan: !!usagePlanId,
    apiKeyId: apiKey || undefined,
    usagePlanId: usagePlanId || undefined,
  };
}