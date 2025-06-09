const { DynamoDBClient, BatchWriteItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { createAwsClients, findSankeyStacks, getStackOutputs, findUserByEmail, listAllUsers } = require('../lib/aws-helpers');
const { log, displayProgress, displayUserList } = require('../lib/logger');
const { selectStackCombination, selectUser, promptNumber, promptChoice, prompt, confirm, Timer } = require('../lib/cli-helpers');
const {
    GENERATE_TEST_DATA,
    SAMPLE_DATA,
    WEIGHTED_STATUSES,
    APPROVAL_MODES,
    CLOUDFORMATION_OUTPUT_KEYS
} = require('../lib/constants');

/**
 * テストデータ生成のメインワークフロー
 */
async function executeTestDataWorkflow(config) {
    const timer = new Timer();
    
    try {
        const { profile, region, environment, debug = false } = config;

        // AWS クライアントの初期化
        log.info('🔧 Initializing AWS clients...');
        const clients = createAwsClients(profile, region);
        log.success('AWS clients initialized successfully');

        // Step 1: スタック検索と選択
        log.info('🔍 Searching for Sankey stacks...');
        const stackCombinations = await findSankeyStacks(clients.cloudFormation, { debug });

        if (stackCombinations.length === 0) {
            throw new Error('No Sankey stacks found');
        }

        // 環境でフィルタリング
        const filteredCombinations = environment 
            ? stackCombinations.filter(combo => combo.environment === environment.toLowerCase())
            : stackCombinations;

        if (filteredCombinations.length === 0) {
            throw new Error(`No stacks found for environment: ${environment}`);
        }

        const selectedCombination = filteredCombinations.length === 1 
            ? filteredCombinations[0]
            : await selectStackCombination(filteredCombinations, { requireApproval: APPROVAL_MODES.ALWAYS });

        log.success(`Selected: ${selectedCombination.environment.toUpperCase()} Environment`);

        // Step 2: テーブル名取得
        log.info('🔍 Retrieving DynamoDB table name...');
        const dbOutputs = await getStackOutputs(
            clients.cloudFormation,
            selectedCombination.dbStack.StackName,
            [CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME],
            { debug }
        );

        if (!dbOutputs[CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME]) {
            throw new Error(`Required DB stack output not found (${CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME})`);
        }

        const tableName = dbOutputs[CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME];
        log.success(`Table Name: ${tableName}`);

        // Step 3: 操作選択
        const operation = await selectOperation();

        // Step 4: ユーザー選択
        const userInfo = await selectTestUser(clients, selectedCombination, { debug });

        // Step 5: 操作に応じた処理
        let result;
        switch (operation) {
            case 'generate':
                const generateOptions = await getGenerationOptions();
                result = await executeGeneration(clients.dynamo, tableName, userInfo.userId, generateOptions, { debug });
                break;
            
            case 'delete':
                const confirmed = await confirm('⚠️  Are you sure you want to delete ALL test data for this user?', false);
                if (!confirmed) {
                    log.info('Delete operation cancelled');
                    return { success: false, cancelled: true };
                }
                result = await executeDelete(clients.dynamo, tableName, userInfo.userId, { debug });
                break;
            
            case 'reset':
                const resetConfirmed = await confirm('⚠️  This will DELETE existing data and generate new data. Continue?', false);
                if (!resetConfirmed) {
                    log.info('Reset operation cancelled');
                    return { success: false, cancelled: true };
                }
                const resetOptions = await getGenerationOptions();
                result = await executeReset(clients.dynamo, tableName, userInfo.userId, resetOptions, { debug });
                break;
        }

        log.success(`🎉 ${operation} operation completed in ${timer.elapsedFormatted()}`);
        return result;

    } catch (error) {
        log.error(`Test data operation failed: ${error.message}`);
        throw error;
    }
}

/**
 * 操作選択
 */
async function selectOperation() {
    const operations = [
        { id: 'generate', label: 'Generate new test data', description: 'Add new dummy records to existing data' },
        { id: 'delete', label: 'Delete all test data', description: 'Remove all existing test data for selected user' },
        { id: 'reset', label: 'Reset (Delete + Generate)', description: 'Delete existing data and generate fresh test data' }
    ];

    return await promptChoice('Select operation:', operations.map(op => op.label), operations[0].label)
        .then(selected => {
            const selectedOp = operations.find(op => op.label === selected);
            log.info(`Selected operation: ${selectedOp.label}`);
            return selectedOp.id;
        });
}

/**
 * テストユーザー選択
 */
async function selectTestUser(clients, stackCombination, options = {}) {
    // UserPool ID取得
    log.info('🔍 Retrieving UserPool ID...');
    const authOutputs = await getStackOutputs(
        clients.cloudFormation,
        stackCombination.authStack.StackName,
        [CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID],
        options
    );

    if (!authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID]) {
        throw new Error(`Required Auth stack output not found (${CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID})`);
    }

    const userPoolId = authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID];
    log.success(`UserPool ID: ${userPoolId}`);

    // ユーザー選択方法
    const selectionMethod = await promptChoice(
        'How would you like to specify the user?',
        ['Search by email address', 'Enter User ID directly', 'Select from user list'],
        'Search by email address'
    );

    switch (selectionMethod) {
        case 'Search by email address':
            const email = await prompt('Enter email address', GENERATE_TEST_DATA.DEFAULT_EMAIL);
            const user = await findUserByEmail(clients.cognito, userPoolId, email);
            if (!user) {
                log.error(`User not found with email: ${email}`);
                log.info('Available users:');
                const allUsers = await listAllUsers(clients.cognito, userPoolId);
                displayUserList(allUsers);
                throw new Error('User not found');
            }
            return user;

        case 'Enter User ID directly':
            const userId = await prompt('Enter User ID');
            if (!userId) throw new Error('User ID is required');
            return { userId, email: 'direct-input', userStatus: 'UNKNOWN' };

        case 'Select from user list':
            const allUsers = await listAllUsers(clients.cognito, userPoolId);
            if (allUsers.length === 0) {
                throw new Error('No users found in UserPool');
            }
            displayUserList(allUsers);
            return await selectUser(allUsers, { requireApproval: APPROVAL_MODES.ALWAYS });

        default:
            throw new Error('Invalid selection method');
    }
}

/**
 * 生成オプション取得
 */
async function getGenerationOptions() {
    const options = {};

    // レコード数
    options.count = await promptNumber(
        'Number of records to generate',
        GENERATE_TEST_DATA.DEFAULT_RECORD_COUNT,
        1,
        100
    );

    // ステータス選択
    const statusChoices = ['Pending', 'Active', 'Expired', 'Rejected', 'Revoked', 'Random'];
    options.status = await promptChoice(
        'Select status for test data',
        statusChoices,
        GENERATE_TEST_DATA.DEFAULT_STATUS
    );

    // メール設定
    const useRealEmail = await confirm('Use real email address in test data?', true);
    options.useRealEmail = useRealEmail;

    if (!useRealEmail) {
        const useDummyEmail = await confirm('Use specific dummy email address?', false);
        if (useDummyEmail) {
            options.dummyEmail = await prompt('Enter dummy email address');
        }
    }

    return options;
}

/**
 * データ生成実行
 */
async function executeGeneration(dynamoClient, tableName, userId, options, config = {}) {
    const items = generateDummyData(userId, options);
    const successCount = await batchWriteItems(dynamoClient, tableName, items, config);
    
    return {
        success: true,
        operation: 'generate',
        generated: successCount,
        total: items.length
    };
}

/**
 * データ削除実行
 */
async function executeDelete(dynamoClient, tableName, userId, config = {}) {
    const deletedCount = await deleteUserData(dynamoClient, tableName, userId, config);
    
    return {
        success: true,
        operation: 'delete',
        deleted: deletedCount
    };
}

/**
 * リセット実行
 */
async function executeReset(dynamoClient, tableName, userId, options, config = {}) {
    // 既存データ削除
    const deletedCount = await deleteUserData(dynamoClient, tableName, userId, config);
    log.success(`🗑️ Deleted ${deletedCount} existing items`);

    // 新データ生成
    const items = generateDummyData(userId, options);
    const successCount = await batchWriteItems(dynamoClient, tableName, items, config);

    return {
        success: true,
        operation: 'reset',
        deleted: deletedCount,
        generated: successCount,
        total: items.length
    };
}

/**
 * ユーザーの全データを削除
 */
async function deleteUserData(dynamoClient, tableName, userId, options) {
    const timer = new Timer();

    try {
        log.database(`🔍 Scanning existing data for user: ${userId}`);

        const queryCommand = new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': { S: userId }
            }
        });

        const queryResult = await dynamoClient.send(queryCommand);

        if (!queryResult.Items || queryResult.Items.length === 0) {
            log.info('No existing data found for this user');
            return 0;
        }

        const itemCount = queryResult.Items.length;
        log.warning(`Found ${itemCount} existing items for this user`);

        const deleteRequests = queryResult.Items.map(item => ({
            DeleteRequest: {
                Key: {
                    userId: item.userId,
                    sk: item.sk
                }
            }
        }));

        const batchSize = GENERATE_TEST_DATA.DYNAMODB_BATCH_SIZE;
        const totalBatches = Math.ceil(deleteRequests.length / batchSize);
        let deletedCount = 0;

        log.database(`🗑️ Deleting ${itemCount} items in ${totalBatches} batch(es)...`);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const start = batchIndex * batchSize;
            const end = Math.min(start + batchSize, deleteRequests.length);
            const batchItems = deleteRequests.slice(start, end);

            if (totalBatches > 1) {
                log.progress(`Deleting batch ${batchIndex + 1}/${totalBatches} (${batchItems.length} items)...`);
            }

            const batchRequest = {
                RequestItems: {
                    [tableName]: batchItems
                }
            };

            try {
                const command = new BatchWriteItemCommand(batchRequest);
                const result = await dynamoClient.send(command);

                if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
                    log.warning(`Unprocessed items found in delete batch ${batchIndex + 1}`);

                    let retryCount = 0;
                    const maxRetries = GENERATE_TEST_DATA.MAX_RETRIES;
                    let unprocessed = result.UnprocessedItems;

                    while (Object.keys(unprocessed).length > 0 && retryCount < maxRetries) {
                        retryCount++;
                        log.progress(`  Retrying delete ${retryCount}/${maxRetries}...`);
                        await new Promise(resolve => setTimeout(resolve, GENERATE_TEST_DATA.RETRY_DELAY_MS * retryCount));

                        const retryCommand = new BatchWriteItemCommand({ RequestItems: unprocessed });
                        const retryResult = await dynamoClient.send(retryCommand);
                        unprocessed = retryResult.UnprocessedItems || {};
                    }

                    if (Object.keys(unprocessed).length === 0) {
                        deletedCount += batchItems.length;
                        if (totalBatches > 1) {
                            log.success(`  Delete batch ${batchIndex + 1} succeeded (after retry)`);
                        }
                    } else {
                        log.error(`  Some items in delete batch ${batchIndex + 1} could not be processed`);
                    }
                } else {
                    deletedCount += batchItems.length;
                    if (totalBatches > 1) {
                        log.success(`  Delete batch ${batchIndex + 1} succeeded`);
                    }
                }

            } catch (error) {
                log.error(`Delete batch ${batchIndex + 1} failed: ${error.message}`);
            }
        }

        log.info(`Deleted ${deletedCount}/${itemCount} items in ${timer.elapsedFormatted()}`);
        return deletedCount;

    } catch (error) {
        throw new Error(`Failed to delete user data: ${error.message}`);
    }
}

/**
 * ダミーデータ生成
 */
function generateDummyData(userId, options) {
    const timer = new Timer();
    const count = parseInt(options.count);
    const items = [];

    log.generate(`Generating ${count} dummy records...`);

    for (let i = 1; i <= count; i++) {
        const appliedAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_APPLIED_AT);
        const accountNumber = `100${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;
        const eaName = SAMPLE_DATA.EA_NAMES[Math.floor(Math.random() * SAMPLE_DATA.EA_NAMES.length)];
        const broker = SAMPLE_DATA.BROKERS[Math.floor(Math.random() * SAMPLE_DATA.BROKERS.length)];
        const sk = `${GENERATE_TEST_DATA.DB_SK_PREFIXES.APPLICATION}${appliedAt}#${broker}#${accountNumber}#${eaName}`;

        let itemStatus;
        if (options.status !== GENERATE_TEST_DATA.STATUS_RANDOM) {
            itemStatus = options.status;
        } else {
            itemStatus = getWeightedRandomStatus();
        }

        const xAccount = SAMPLE_DATA.TWITTER_HANDLES[Math.floor(Math.random() * SAMPLE_DATA.TWITTER_HANDLES.length)];

        let emailToUse = '';
        if (options.useRealEmail) {
            emailToUse = options.email || GENERATE_TEST_DATA.DEFAULT_EMAIL;
        } else if (options.dummyEmail) {
            emailToUse = options.dummyEmail;
        } else {
            emailToUse = generateDummyEmail();
        }

        const item = {
            PutRequest: {
                Item: {
                    userId: { S: userId },
                    sk: { S: sk },
                    accountNumber: { S: accountNumber },
                    eaName: { S: eaName },
                    broker: { S: broker },
                    email: { S: emailToUse },
                    xAccount: { S: xAccount },
                    status: { S: itemStatus },
                    appliedAt: { S: appliedAt },
                    updatedAt: { S: new Date().toISOString() }
                }
            }
        };

        // ステータスに応じて追加フィールド
        switch (itemStatus) {
            case 'Active':
                const approvedAt = new Date(new Date(appliedAt).getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
                const expiresAt = new Date(Date.now() + (Math.random() * 335 + 30) * 24 * 60 * 60 * 1000).toISOString();
                const licenseKey = `SMP-2025-${Math.floor(Math.random() * 2147483647).toString(16).toUpperCase()}`;

                item.PutRequest.Item.approvedAt = { S: approvedAt };
                item.PutRequest.Item.expiresAt = { S: expiresAt };
                item.PutRequest.Item.licenseKey = { S: licenseKey };
                break;

            case 'Expired':
                const expiredApprovedAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_EXPIRED_APPROVED_AT);
                const expiredExpiresAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_EXPIRED_EXPIRES_AT);
                const expiredLicenseKey = `SMP-2024-${Math.floor(Math.random() * 2147483647).toString(16).toUpperCase()}`;

                item.PutRequest.Item.approvedAt = { S: expiredApprovedAt };
                item.PutRequest.Item.expiresAt = { S: expiredExpiresAt };
                item.PutRequest.Item.licenseKey = { S: expiredLicenseKey };
                break;

            case 'Revoked':
                const revokedApprovedAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_REVOKED_APPROVED_AT);
                const revokedAt = new Date(new Date(revokedApprovedAt).getTime() + (Math.random() * 83 + 7) * 24 * 60 * 60 * 1000).toISOString();
                const revokedLicenseKey = `SMP-2025-${Math.floor(Math.random() * 2147483647).toString(16).toUpperCase()}`;

                item.PutRequest.Item.approvedAt = { S: revokedApprovedAt };
                item.PutRequest.Item.revokedAt = { S: revokedAt };
                item.PutRequest.Item.licenseKey = { S: revokedLicenseKey };
                break;
        }

        items.push(item);

        if (i % Math.max(1, Math.floor(count / 10)) === 0 || i === count) {
            displayProgress(i, count, '  Progress');
        }
    }

    log.info(`Generated ${count} dummy records in ${timer.elapsedFormatted()}`);
    return items;
}

/**
 * DynamoDBバッチ書き込み
 */
async function batchWriteItems(dynamoClient, tableName, items, options) {
    const timer = new Timer();
    const batchSize = GENERATE_TEST_DATA.DYNAMODB_BATCH_SIZE;
    const totalBatches = Math.ceil(items.length / batchSize);
    let successCount = 0;

    log.database(`Writing ${items.length} items to DynamoDB in ${totalBatches} batch(es)...`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, items.length);
        const batchItems = items.slice(start, end);

        if (totalBatches > 1) {
            log.progress(`Processing batch ${batchIndex + 1}/${totalBatches} (${batchItems.length} items)...`);
        }

        const batchRequest = {
            RequestItems: {
                [tableName]: batchItems
            }
        };

        try {
            const command = new BatchWriteItemCommand(batchRequest);
            const result = await dynamoClient.send(command);

            if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
                log.warning(`Unprocessed items found in batch ${batchIndex + 1}`);

                let retryCount = 0;
                const maxRetries = GENERATE_TEST_DATA.MAX_RETRIES;
                let unprocessed = result.UnprocessedItems;

                while (Object.keys(unprocessed).length > 0 && retryCount < maxRetries) {
                    retryCount++;
                    log.progress(`  Retrying ${retryCount}/${maxRetries}...`);
                    await new Promise(resolve => setTimeout(resolve, GENERATE_TEST_DATA.RETRY_DELAY_MS * retryCount));

                    const retryCommand = new BatchWriteItemCommand({ RequestItems: unprocessed });
                    const retryResult = await dynamoClient.send(retryCommand);
                    unprocessed = retryResult.UnprocessedItems || {};
                }

                if (Object.keys(unprocessed).length === 0) {
                    successCount += batchItems.length;
                    if (totalBatches > 1) {
                        log.success(`  Batch ${batchIndex + 1} succeeded (after retry)`);
                    }
                } else {
                    log.error(`  Some items in batch ${batchIndex + 1} could not be processed`);
                }
            } else {
                successCount += batchItems.length;
                if (totalBatches > 1) {
                    log.success(`  Batch ${batchIndex + 1} succeeded`);
                }
            }

        } catch (error) {
            log.error(`Batch ${batchIndex + 1} failed: ${error.message}`);
        }
    }

    log.info(`Batch write completed: ${successCount}/${items.length} items succeeded in ${timer.elapsedFormatted()}`);
    return successCount;
}

/**
 * ヘルパー関数群
 */

function getRandomDateTime(daysBack = GENERATE_TEST_DATA.DAYS_BACK_DEFAULT) {
    const now = new Date();
    const start = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
    const randomTime = start.getTime() + Math.random() * (now.getTime() - start.getTime());
    return new Date(randomTime).toISOString();
}

function getWeightedRandomStatus() {
    const totalWeight = WEIGHTED_STATUSES.reduce((sum, item) => sum + item.weight, 0);
    const random = Math.random() * totalWeight;
    let currentWeight = 0;

    for (const statusItem of WEIGHTED_STATUSES) {
        currentWeight += statusItem.weight;
        if (random < currentWeight) {
            return statusItem.status;
        }
    }
    return WEIGHTED_STATUSES[0].status;
}

function generateDummyEmail() {
    const prefix = SAMPLE_DATA.EMAIL_PREFIXES[Math.floor(Math.random() * SAMPLE_DATA.EMAIL_PREFIXES.length)];
    const domain = SAMPLE_DATA.EMAIL_DOMAINS[Math.floor(Math.random() * SAMPLE_DATA.EMAIL_DOMAINS.length)];
    const number = Math.floor(Math.random() * 999) + 1;
    return `${prefix}${number}@${domain}`;
}

module.exports = {
    executeTestDataWorkflow,
    selectOperation,
    selectTestUser,
    getGenerationOptions,
    executeGeneration,
    executeDelete,
    executeReset
};