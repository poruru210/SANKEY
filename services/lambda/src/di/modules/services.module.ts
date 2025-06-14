import { asClass, AwilixContainer } from 'awilix';
import { DIContainer } from '../../di/dependencies';

// Services
import { IntegrationTestService } from '../../services/integrationTestService';
import { IntegrationTestProgressService } from '../../services/integrationTestProgressService';
import { MasterKeyService } from '../../services/masterKeyService';
import { JWTKeyService } from '../../services/jwtKeyService';

/**
 * ビジネスサービスを登録するモジュール
 */
export function registerServicesModule(container: AwilixContainer<DIContainer>): void {
    container.register({
        // IntegrationTestService
        integrationTestService: asClass(IntegrationTestService)
            .singleton()
            .inject(() => ({
                docClient: container.resolve('docClient'),
                integrationTestRepository: container.resolve('integrationTestRepository'),
                eaApplicationRepository: container.resolve('eaApplicationRepository'),
                userProfileRepository: container.resolve('userProfileRepository'),
                logger: container.resolve('logger'),
            })),

        // IntegrationTestProgressService
        integrationTestProgressService: asClass(IntegrationTestProgressService)
            .singleton()
            .inject(() => ({
                logger: container.resolve('logger'),
            })),

        // MasterKeyService
        masterKeyService: asClass(MasterKeyService)
            .singleton()
            .inject(() => ({
                ssmClient: container.resolve('ssmClient'),
                logger: container.resolve('logger'),
            })),

        // JWTKeyService
        jwtKeyService: asClass(JWTKeyService)
            .singleton()
            .inject(() => ({
                ssmClient: container.resolve('ssmClient'),
                logger: container.resolve('logger'),
            })),
    });
}