const { SSMClient, PutParameterCommand, GetParameterCommand, DeleteParameterCommand } = require('@aws-sdk/client-ssm');
const { log } = require('../lib/logger');
const { SSM_PARAMETERS } = require('../lib/constants');

/**
 * SSM Parameter Store操作モジュール
 * 証明書ARNの保存・取得を管理
 */

/**
 * SSMクライアントの作成
 * @param {string} profile - AWS SSO profile
 * @param {string} region - AWS region
 * @returns {SSMClient} SSM client instance
 */
function createSSMClient(profile, region) {
    const config = {
        profile: profile
    };

    if (region) {
        config.region = region;
    }

    try {
        return new SSMClient(config);
    } catch (error) {
        throw new Error(`Failed to initialize SSM client: ${error.message}`);
    }
}

/**
 * パラメータ名の生成
 * @param {string} type - パラメータタイプ（定数から選択）
 * @returns {string} パラメータ名
 */
function generateParameterName(type = 'CERTIFICATE_ARN') {
    // typeがSSM_PARAMETERSのキーの場合
    if (SSM_PARAMETERS[type]) {
        return SSM_PARAMETERS[type];
    }
    
    // 後方互換性のため、直接パスが渡された場合はそのまま返す
    if (type.startsWith('/')) {
        return type;
    }
    
    // デフォルトは証明書ARN
    return SSM_PARAMETERS.CERTIFICATE_ARN;
}

/**
 * パラメータの保存
 * @param {SSMClient} ssmClient - SSM client
 * @param {string} parameterName - パラメータ名
 * @param {string} value - 保存する値
 * @param {Object} options - オプション
 * @returns {Object} 保存結果
 */
async function putParameter(ssmClient, parameterName, value, options = {}) {
    try {
        const { description, dryRun = false, overwrite = true } = options;

        if (dryRun) {
            log.info(`[DRY-RUN] Would save parameter: ${parameterName}`);
            return { 
                success: true, 
                dryRun: true,
                parameterName,
                action: 'dry-run'
            };
        }

        log.debug(`Saving parameter: ${parameterName}`, options);

        const command = new PutParameterCommand({
            Name: parameterName,
            Value: value,
            Type: 'String',
            Description: description || `Managed by Sankey setup script - ${new Date().toISOString()}`,
            Overwrite: overwrite,
            Tier: 'Standard'
        });

        const response = await ssmClient.send(command);

        log.success(`✅ Parameter saved: ${parameterName}`);
        log.debug(`Version: ${response.Version}`, options);

        return {
            success: true,
            parameterName,
            version: response.Version,
            action: response.Version > 1 ? 'updated' : 'created'
        };

    } catch (error) {
        if (error.name === 'ParameterAlreadyExists' && !options.overwrite) {
            log.warning(`Parameter already exists: ${parameterName}`);
            return {
                success: false,
                parameterName,
                error: 'already_exists',
                message: 'Use --force-update to overwrite'
            };
        }
        
        throw new Error(`Failed to save parameter: ${error.message}`);
    }
}

/**
 * パラメータの取得
 * @param {SSMClient} ssmClient - SSM client
 * @param {string} parameterName - パラメータ名
 * @param {Object} options - オプション
 * @returns {Object} パラメータ値と情報
 */
async function getParameter(ssmClient, parameterName, options = {}) {
    try {
        log.debug(`Retrieving parameter: ${parameterName}`, options);

        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssmClient.send(command);

        if (!response.Parameter) {
            return null;
        }

        const parameter = response.Parameter;
        log.debug(`Found parameter version ${parameter.Version}`, options);

        return {
            name: parameter.Name,
            value: parameter.Value,
            version: parameter.Version,
            lastModifiedDate: parameter.LastModifiedDate,
            description: parameter.Description
        };

    } catch (error) {
        if (error.name === 'ParameterNotFound') {
            log.debug(`Parameter not found: ${parameterName}`, options);
            return null;
        }
        
        throw new Error(`Failed to retrieve parameter: ${error.message}`);
    }
}

/**
 * パラメータの削除
 * @param {SSMClient} ssmClient - SSM client
 * @param {string} parameterName - パラメータ名
 * @param {Object} options - オプション
 * @returns {Object} 削除結果
 */
async function deleteParameter(ssmClient, parameterName, options = {}) {
    try {
        const { dryRun = false } = options;

        if (dryRun) {
            log.info(`[DRY-RUN] Would delete parameter: ${parameterName}`);
            return { 
                success: true, 
                dryRun: true,
                parameterName,
                action: 'dry-run-delete'
            };
        }

        log.debug(`Deleting parameter: ${parameterName}`, options);

        const command = new DeleteParameterCommand({
            Name: parameterName
        });

        await ssmClient.send(command);

        log.success(`✅ Parameter deleted: ${parameterName}`);

        return {
            success: true,
            parameterName,
            action: 'deleted'
        };

    } catch (error) {
        if (error.name === 'ParameterNotFound') {
            log.warning(`Parameter not found: ${parameterName}`);
            return {
                success: false,
                parameterName,
                error: 'not_found'
            };
        }
        
        throw new Error(`Failed to delete parameter: ${error.message}`);
    }
}

/**
 * 証明書ARNの保存（高レベルAPI）
 * @param {Object} config - 設定オブジェクト
 * @returns {Object} 保存結果
 */
async function saveCertificateArn(config) {
    const { certificateArn, profile, region, dryRun = false, forceUpdate = false, debug = false } = config;

    try {
        // SSMクライアント作成
        const ssmClient = createSSMClient(profile, region);

        // パラメータ名
        const parameterName = SSM_PARAMETERS.CERTIFICATE_ARN;

        // 既存パラメータの確認
        const existingParam = await getParameter(ssmClient, parameterName, { debug });

        if (existingParam && !forceUpdate) {
            log.info(`Existing certificate ARN found: ${existingParam.value}`);
            log.info(`Last modified: ${existingParam.lastModifiedDate}`);
            
            if (existingParam.value === certificateArn) {
                log.success('Certificate ARN is already up to date');
                return {
                    success: true,
                    action: 'no-change',
                    parameterName,
                    certificateArn
                };
            } else {
                log.warning('Certificate ARN differs from stored value');
                log.info('Use --force-update to overwrite');
                return {
                    success: false,
                    action: 'differs',
                    parameterName,
                    storedArn: existingParam.value,
                    newArn: certificateArn
                };
            }
        }

        // パラメータ保存
        const result = await putParameter(
            ssmClient,
            parameterName,
            certificateArn,
            {
                description: `Wildcard certificate ARN for *.sankey.trade`,
                dryRun,
                overwrite: true
            }
        );

        return result;

    } catch (error) {
        throw new Error(`Failed to save certificate ARN: ${error.message}`);
    }
}

/**
 * 証明書ARNの取得（高レベルAPI）
 * @param {Object} config - 設定オブジェクト
 * @returns {string|null} 証明書ARN
 */
async function getCertificateArn(config) {
    const { profile, region, debug = false } = config;

    try {
        // SSMクライアント作成
        const ssmClient = createSSMClient(profile, region);

        // パラメータ名
        const parameterName = SSM_PARAMETERS.CERTIFICATE_ARN;

        // パラメータ取得
        const param = await getParameter(ssmClient, parameterName, { debug });

        if (!param) {
            log.info('No certificate ARN found in SSM Parameter Store');
            return null;
        }

        log.info(`Found certificate ARN: ${param.value}`);
        log.debug(`Version: ${param.version}, Modified: ${param.lastModifiedDate}`, { debug });

        return param.value;

    } catch (error) {
        throw new Error(`Failed to retrieve certificate ARN: ${error.message}`);
    }
}

/**
 * パラメータ情報の表示
 * @param {Object} paramInfo - パラメータ情報
 */
function displayParameterInfo(paramInfo) {
    if (!paramInfo) {
        log.info('No parameter found');
        return;
    }

    console.log('\n📋 Parameter Information:');
    console.log(`   Name: ${paramInfo.name}`);
    console.log(`   Value: ${paramInfo.value}`);
    console.log(`   Version: ${paramInfo.version}`);
    console.log(`   Modified: ${paramInfo.lastModifiedDate}`);
    
    if (paramInfo.description) {
        console.log(`   Description: ${paramInfo.description}`);
    }
}

module.exports = {
    createSSMClient,
    generateParameterName,
    putParameter,
    getParameter,
    deleteParameter,
    saveCertificateArn,
    getCertificateArn,
    displayParameterInfo
};