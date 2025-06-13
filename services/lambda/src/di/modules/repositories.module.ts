// src/di/modules/repositories.module.ts
import { asClass, AwilixContainer } from 'awilix';
import { DIContainer } from '../../types/dependencies';

// Repositories
import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import { IntegrationTestRepository } from '../../repositories/integrationTestRepository';

/**
 * リポジトリを登録するモジュール
 */
export function registerRepositoriesModule(container: AwilixContainer<DIContainer>): void {
    container.register({
        // EAApplicationRepository
        eaApplicationRepository: asClass(EAApplicationRepository)
            .singleton()
            .inject(() => ({
                docClient: container.resolve('docClient'),
                tableName: container.resolve('tableName'),
                logger: container.resolve('logger'),
            })),

        // IntegrationTestRepository
        integrationTestRepository: asClass(IntegrationTestRepository)
            .singleton()
            .inject(() => ({
                dynamoClient: container.resolve('docClient'),
                tableName: process.env.USER_PROFILE_TABLE_NAME || 'user-profiles',
                logger: container.resolve('logger'),
            })),
    });
}