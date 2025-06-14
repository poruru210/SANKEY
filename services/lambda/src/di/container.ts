import { createContainer, asValue, AwilixContainer, InjectionMode } from 'awilix';
import { DIContainer } from '../di/dependencies';
import { registerAWSModule } from './modules/aws.module';
import { registerServicesModule } from './modules/services.module';
import { registerRepositoriesModule } from './modules/repositories.module';

/**
 * 本番環境用のDIコンテナを作成
 */
export function createProductionContainer(): AwilixContainer<DIContainer> {
    const container = createContainer<DIContainer>({
        injectionMode: InjectionMode.PROXY, // 遅延初期化を有効化
    });

    // 環境変数から設定を読み込み
    const environment = process.env.ENVIRONMENT || 'dev';
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    const tableName = process.env.TABLE_NAME || 'ea-applications';
    const integrationTestTableName = process.env.INTEGRATION_TEST_TABLE_NAME || 'integration-tests';

    // 設定の登録
    container.register({
        environment: asValue(environment),
        region: asValue(region),
        tableName: asValue(tableName),
        integrationTestTableName: asValue(integrationTestTableName),
    });

    // AWS基盤サービスの登録
    registerAWSModule(container);

    // ビジネスサービスの登録
    registerServicesModule(container);

    // リポジトリの登録
    registerRepositoriesModule(container);

    return container;
}

/**
 * コンテナのキャッシュ（コールドスタート対策）
 */
let cachedContainer: AwilixContainer<DIContainer> | null = null;

/**
 * キャッシュされたコンテナを取得（シングルトン）
 */
export function getContainer(): AwilixContainer<DIContainer> {
    if (!cachedContainer) {
        cachedContainer = createProductionContainer();
    }
    return cachedContainer;
}

/**
 * コンテナのクリア（主にテスト用）
 */
export function clearContainer(): void {
    if (cachedContainer) {
        cachedContainer.dispose();
        cachedContainer = null;
    }
}