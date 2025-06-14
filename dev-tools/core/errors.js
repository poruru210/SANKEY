/**
 * カスタムエラークラス定義
 */

export class BaseError extends Error {
    constructor(message, cause = null) {
        super(message);
        this.name = this.constructor.name;
        this.cause = cause;
        if (cause instanceof Error && cause.stack) {
            this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
        } else if (cause) {
            this.stack = `${this.stack}\nCaused by: ${cause}`;
        }
    }
}

export class ConfigurationError extends BaseError {
    constructor(message, cause = null) {
        super(message, cause);
    }
}

export class ApiError extends BaseError {
    constructor(message, serviceName = 'API', statusCode = null, cause = null) {
        super(message, cause);
        this.serviceName = serviceName;
        this.statusCode = statusCode;
    }
}

export class ResourceNotFoundError extends BaseError {
    constructor(resourceType, resourceIdentifier, cause = null) {
        super(`${resourceType} '${resourceIdentifier}' not found.`, cause);
        this.resourceType = resourceType;
        this.resourceIdentifier = resourceIdentifier;
    }
}

export class CdkNotDeployedError extends ConfigurationError {
    constructor(missingResources = [], environment = null, cause = null) {
        const envMessage = environment ? ` for environment '${environment}'` : '';
        let message = `Required CDK resources are not deployed${envMessage}.`;
        if (missingResources.length > 0) {
            message += ` Missing: ${missingResources.join(', ')}.`;
        }
        super(message, cause);
        this.missingResources = missingResources;
        this.environment = environment;
    }
}