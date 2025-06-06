// tests/helpers/localstack.helper.ts
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export class LocalStackTestHelper {
    private container: StartedTestContainer | null = null;
    private dynamoClient: DynamoDBClient | null = null;
    private docClient: DynamoDBDocumentClient | null = null;

    async start(): Promise<void> {
        console.log('Starting LocalStack container...');

        this.container = await new GenericContainer('localstack/localstack:latest')
            .withEnvironment({
                SERVICES: 'dynamodb',
                DEBUG: '1',
                DATA_DIR: '/tmp/localstack/data',
                DOCKER_HOST: 'unix:///var/run/docker.sock'
            })
            .withExposedPorts(4566)
            .withWaitStrategy(Wait.forLogMessage('Ready.'))
            .withLogConsumer(stream => {
                stream.on('data', line => console.log(line));
            })
            .start();

        const port = this.container.getMappedPort(4566);
        const endpoint = `http://localhost:${port}`;

        console.log(`LocalStack started on ${endpoint}`);

        // DynamoDB クライアントの設定
        this.dynamoClient = new DynamoDBClient({
            endpoint,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        });

        this.docClient = DynamoDBDocumentClient.from(this.dynamoClient);
    }

    async stop(): Promise<void> {
        if (this.container) {
            console.log('Stopping LocalStack container...');
            await this.container.stop();
            this.container = null;
            this.dynamoClient = null;
            this.docClient = null;
        }
    }

    getDynamoClient(): DynamoDBClient {
        if (!this.dynamoClient) {
            throw new Error('LocalStack not started. Call start() first.');
        }
        return this.dynamoClient;
    }

    getDocClient(): DynamoDBDocumentClient {
        if (!this.docClient) {
            throw new Error('LocalStack not started. Call start() first.');
        }
        return this.docClient;
    }

    async createEAApplicationsTable(tableName: string): Promise<void> {
        const createTableCommand = new CreateTableCommand({
            TableName: tableName,
            KeySchema: [
                { AttributeName: 'userId', KeyType: 'HASH' },
                { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
            AttributeDefinitions: [
                { AttributeName: 'userId', AttributeType: 'S' },
                { AttributeName: 'sk', AttributeType: 'S' },
                { AttributeName: 'broker', AttributeType: 'S' },
                { AttributeName: 'accountNumber', AttributeType: 'S' },
                { AttributeName: 'status', AttributeType: 'S' },
            ],
            BillingMode: 'PAY_PER_REQUEST',
            GlobalSecondaryIndexes: [
                {
                    IndexName: 'BrokerAccountIndex',
                    KeySchema: [
                        { AttributeName: 'broker', KeyType: 'HASH' },
                        { AttributeName: 'accountNumber', KeyType: 'RANGE' },
                    ],
                    Projection: { ProjectionType: 'ALL' },
                },
                {
                    IndexName: 'StatusIndex',
                    KeySchema: [
                        { AttributeName: 'userId', KeyType: 'HASH' },
                        { AttributeName: 'status', KeyType: 'RANGE' },
                    ],
                    Projection: { ProjectionType: 'ALL' },
                },
            ],
        });

        try {
            await this.dynamoClient!.send(createTableCommand);
            console.log(`Table ${tableName} created successfully`);

            // テーブルがACTIVE状態になるまで待機
            await this.waitForTableActive(tableName);
        } catch (error) {
            console.error(`Failed to create table ${tableName}:`, error);
            throw error;
        }
    }

    async deleteTable(tableName: string): Promise<void> {
        try {
            await this.dynamoClient!.send(new DeleteTableCommand({ TableName: tableName }));
            console.log(`Table ${tableName} deleted successfully`);
        } catch (error) {
            console.error(`Failed to delete table ${tableName}:`, error);
            // テーブルが存在しない場合はエラーを無視
        }
    }

    private async waitForTableActive(tableName: string, maxRetries = 30): Promise<void> {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const { Table } = await this.dynamoClient!.send(
                    new (await import('@aws-sdk/client-dynamodb')).DescribeTableCommand({ TableName: tableName })
                );

                if (Table?.TableStatus === 'ACTIVE') {
                    console.log(`Table ${tableName} is now ACTIVE`);
                    return;
                }

                console.log(`Waiting for table ${tableName} to become ACTIVE... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Error checking table status:`, error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        throw new Error(`Table ${tableName} did not become ACTIVE within ${maxRetries} seconds`);
    }
}