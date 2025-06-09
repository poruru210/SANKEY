#!/usr/bin/env node

const { Command } = require('commander');
const { createAwsClients, findSankeyStacks, getStackOutputs, findUserByEmail, listAllUsers } = require('./lib/aws-helpers');
const { log, displayTitle, displayStackOptions, displayUserList, displayProgress } = require('./lib/logger');
const { selectStackCombination, selectUser, validateOptions, Timer } = require('./lib/cli-helpers');
const { DynamoDBClient, BatchWriteItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const {
    GENERATE_TEST_DATA,
    SAMPLE_DATA,
    WEIGHTED_STATUSES,
    APPROVAL_MODES,
    CLOUDFORMATION_OUTPUT_KEYS
} = require('./lib/constants');

// コマンドライン引数の設定
const program = new Command();

program
    .name('generate-test-data')
    .description('Generate and insert dummy test data into SanKey DynamoDB table')
    .version('1.0.0')
    .requiredOption('-p, --profile <profile>', 'AWS SSO profile name')
    .option('-r, --region <region>', 'AWS region (defaults to profile default)')
    .option('-e, --email <email>', 'User email address for Cognito lookup', GENERATE_TEST_DATA.DEFAULT_EMAIL)
    .option('-u, --user-id <id>', 'Direct user ID specification (skip email lookup)')
    .option('-c, --count <number>', 'Number of records to generate', GENERATE_TEST_DATA.DEFAULT_RECORD_COUNT.toString())
    .option('--status <status>', 'Force specific status (Pending|Active|Expired|Rejected|Revoked|Random)', GENERATE_TEST_DATA.DEFAULT_STATUS)
    .option('--dummy-email <email>', 'Dummy email for test data (optional)')
    .option('--use-real-email', 'Use real email address in test data', true)
    .option('--delete', 'Delete all existing data for the user (no generation)')
    .option('--reset', 'Delete existing data and generate new data')
    .option('--require-approval <type>', 'Require approval for user selections', APPROVAL_MODES.ALWAYS)
    .option('--debug', 'Enable debug output');

/**
 * ユーザーの全データを削除
 * @param {DynamoDBClient} dynamoClient - DynamoDB クライアント
 * @param {string} tableName - テーブル名
 * @param {string} userId - ユーザーID
 * @param {Object} options - オプション
 * @returns {number} 削除件数
 */
async function deleteUserData(dynamoClient, tableName, userId, options) {
    const timer = new Timer();

    try {
        log.database(`🔍 Scanning existing data for user: ${userId}`);

        // ユーザーの全データを取得
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

        // 削除用のバッチリクエストを作成
        const deleteRequests = queryResult.Items.map(item => ({
            DeleteRequest: {
                Key: {
                    userId: item.userId,
                    sk: item.sk
                }
            }
        }));

        // バッチ削除実行
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

                // 未処理アイテムのチェック
                if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
                    log.warning(`Unprocessed items found in delete batch ${batchIndex + 1}`);

                    // リトライ処理
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
 * ランダムな日時を生成
 * @param {number} daysBack - 何日前まで遡るか
 * @returns {string} ISO文字列
 */
function getRandomDateTime(daysBack = GENERATE_TEST_DATA.DAYS_BACK_DEFAULT) {
    const now = new Date();
    const start = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
    const randomTime = start.getTime() + Math.random() * (now.getTime() - start.getTime());
    return new Date(randomTime).toISOString();
}

/**
 * 重み付きランダムステータス選択
 * @returns {string} ステータス
 */
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

/**
 * ダミーメールアドレス生成
 * @returns {string} メールアドレス
 */
function generateDummyEmail() {
    const prefix = SAMPLE_DATA.EMAIL_PREFIXES[Math.floor(Math.random() * SAMPLE_DATA.EMAIL_PREFIXES.length)];
    const domain = SAMPLE_DATA.EMAIL_DOMAINS[Math.floor(Math.random() * SAMPLE_DATA.EMAIL_DOMAINS.length)];
    const number = Math.floor(Math.random() * 999) + 1;
    return `${prefix}${number}@${domain}`;
}

/**
 * ダミーデータ生成
 * @param {string} userId - ユーザーID
 * @param {Object} options - オプション
 * @returns {Array} ダミーデータ配列
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

        // ステータスの決定
        let itemStatus;
        if (options.status !== GENERATE_TEST_DATA.STATUS_RANDOM) {
            itemStatus = options.status;
        } else {
            itemStatus = getWeightedRandomStatus();
        }

        const xAccount = SAMPLE_DATA.TWITTER_HANDLES[Math.floor(Math.random() * SAMPLE_DATA.TWITTER_HANDLES.length)];

        // ダミーメール生成
        let emailToUse = '';
        if (options.useRealEmail) {
            emailToUse = options.email;
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

        // プログレス表示
        if (i % Math.max(1, Math.floor(count / 10)) === 0 || i === count) {
            displayProgress(i, count, '  Progress');
        }

        log.debug(`Generated item ${i}: ${eaName} (${itemStatus}) - Account: ${accountNumber}`, options);
    }

    log.info(`Generated ${count} dummy records in ${timer.elapsedFormatted()}`);
    return items;
}

/**
 * DynamoDBバッチ書き込み
 * @param {DynamoDBClient} dynamoClient - DynamoDB クライアント
 * @param {string} tableName - テーブル名
 * @param {Array} items - アイテム配列
 * @param {Object} options - オプション
 * @returns {number} 成功件数
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

        // バッチリクエスト作成
        const batchRequest = {
            RequestItems: {
                [tableName]: batchItems
            }
        };

        try {
            const command = new BatchWriteItemCommand(batchRequest);
            const result = await dynamoClient.send(command);

            // 未処理アイテムのチェック
            if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
                log.warning(`Unprocessed items found in batch ${batchIndex + 1}`);

                // リトライ処理
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
 * メイン処理
 */
async function main() {
    const timer = new Timer();

    try {
        // コマンドライン引数をパース
        program.parse();
        const options = program.opts();

        // 引数検証
        validateOptions(options, ['profile']);

        // オプションの組み合わせ検証
        if (options.delete && (process.argv.includes('--count') || process.argv.includes('-c'))) {
            log.error('--delete option cannot be used with --count. Use --reset instead.');
            log.info('Usage:');
            log.info('  Delete only: --delete');
            log.info('  Delete + Generate: --reset --count N');
            process.exit(1);
        }

        if (options.delete && (process.argv.includes('--reset'))) {
            log.error('--delete and --reset cannot be used together.');
            log.info('Usage:');
            log.info('  Delete only: --delete');
            log.info('  Delete + Generate: --reset --count N');
            process.exit(1);
        }

        // タイトル表示
        displayTitle('SanKey Dummy Data Generator');

        log.info(`📧 Profile: ${options.profile}`);
        if (options.region) {
            log.info(`🌍 Region: ${options.region} (specified)`);
        } else {
            log.info(`🌍 Region: Using profile default`);
        }

        if (options.userId) {
            log.user(`👤 User ID: ${options.userId} (direct specification)`);
        } else {
            log.user(`📧 Email: ${options.email}`);
        }

        if (options.delete) {
            log.warning(`🗑️ Delete mode: Will delete all existing data (no generation)`);
        } else if (options.reset) {
            log.warning(`🔄 Reset mode: Will delete existing data and generate ${options.count} new items`);
            log.info(`📊 Records: ${options.count}`);
        } else {
            log.info(`📊 Records: ${options.count}`);
        }

        // メールアドレスオプションの表示（生成する場合のみ）
        if (!options.delete) {
            if (options.useRealEmail) {
                log.email(`📧 Using real email address: ${options.email}`);
            } else if (options.dummyEmail) {
                log.email(`📧 Using specified dummy email: ${options.dummyEmail}`);
            } else {
                log.email(`📧 Generating random dummy emails`);
            }

            // ステータスオプションの表示
            if (options.status !== 'Pending') {
                log.info(`📊 Status: Fixed to ${options.status}`);
            } else {
                log.info(`📊 Status: Pending (default)`);
            }
        }

        // AWS クライアントの初期化
        log.info('🔧 Initializing AWS clients...');
        const clients = createAwsClients(options.profile, options.region);
        log.success('AWS clients initialized successfully');

        // Step 1: スタック検索
        log.info('🔍 Searching for Sankey stacks...');
        const stackCombinations = await findSankeyStacks(clients.cloudFormation, options);

        if (stackCombinations.length === 0) {
            log.error('No Sankey stacks found. Please check:');
            log.error('- Stack naming convention: Sankey{Environment}{Type}Stack');
            log.error('- AWS region and profile settings');
            return;
        }

        log.success(`Found ${stackCombinations.length} stack combination(s):`);
        displayStackOptions(stackCombinations);

        // Step 2: スタック選択
        log.info('🎯 Selecting stack combination...');
        const selectedCombination = await selectStackCombination(stackCombinations, options);

        // Step 3: テーブル名取得
        log.info('🔍 Retrieving DynamoDB table name...');
        const dbOutputs = await getStackOutputs(
            clients.cloudFormation,
            selectedCombination.dbStack.StackName,
            [CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME],
            options
        );

        if (!dbOutputs[CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME]) {
            throw new Error(`Required DB stack output not found (${CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME})`);
        }

        const tableName = dbOutputs[CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME];
        log.success(`Table Name: ${tableName}`);

        // Step 4: ユーザー検索/選択
        let userId;
        if (options.userId) {
            userId = options.userId;
            log.success(`Using direct User ID: ${userId}`);
        } else {
            // UserPool ID取得
            log.info('🔍 Retrieving UserPool ID...');
            const authOutputs = await getStackOutputs(
                clients.cloudFormation,
                selectedCombination.authStack.StackName,
                [CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID],
                options
            );

            if (!authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID]) {
                throw new Error(`Required Auth stack output not found (${CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID})`);
            }

            const userPoolId = authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID];
            log.success(`UserPool ID: ${userPoolId}`);

            // ユーザー検索
            log.search(`Looking up user by email: ${options.email}`);
            const user = await findUserByEmail(clients.cognito, userPoolId, options.email);

            if (!user) {
                log.error(`User not found with email: ${options.email}`);
                log.info('Available users:');
                const allUsers = await listAllUsers(clients.cognito, userPoolId);
                displayUserList(allUsers);
                return;
            }

            userId = user.userId;
            log.success(`User ID: ${userId}`);
        }

        // Step 5: 既存データ削除（deleteまたはresetオプション）
        if (options.delete || options.reset) {
            const deletedCount = await deleteUserData(clients.dynamo, tableName, userId, options);
            if (deletedCount > 0) {
                log.success(`🗑️ Deleted ${deletedCount} existing items`);
            }

            // deleteオプションの場合はここで終了
            if (options.delete) {
                log.complete(`🎉 Delete operation completed in ${timer.elapsedFormatted()}`);
                return;
            }
        }

        // Step 6: ダミーデータ生成
        const dummyItems = generateDummyData(userId, options);

        // Step 7: DynamoDB書き込み
        const successCount = await batchWriteItems(clients.dynamo, tableName, dummyItems, options);

        // Step 8: 結果確認
        if (successCount === dummyItems.length) {
            log.complete(`🎉 All ${successCount} items inserted successfully!`);
        } else {
            log.warning(`⚠️ Insert result: ${successCount}/${dummyItems.length} items`);
        }

        log.info(`🎉 Operation completed in ${timer.elapsedFormatted()}`);

    } catch (error) {
        log.error(`Error: ${error.message}`);

        if (error.message.includes('profile')) {
            log.warning('Make sure you have run: aws sso login --profile ' + (options?.profile || '<profile>'));
        }

        process.exit(1);
    }
}

// エラーハンドリング
process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${error.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error(`Unhandled rejection: ${reason}`);
    process.exit(1);
});

// 実行
if (require.main === module) {
    main();
}