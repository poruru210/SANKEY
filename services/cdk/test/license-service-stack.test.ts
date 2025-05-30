import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { LicenseServiceStack } from '../lib/license-service-stack';

describe('LicenseServiceStack', () => {
  it('Lambda 関数が作成される', () => {
    const app = new cdk.App();
    const stack = new LicenseServiceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      MemorySize: 256,
      Timeout: 10,
    });
  });

  it('REST API が作成される', () => {
    const app = new cdk.App();
    const stack = new LicenseServiceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResource('AWS::ApiGateway::RestApi', {});
  });

  it('POST /generate メソッドに API Key 必須が設定される', () => {
    const app = new cdk.App();
    const stack = new LicenseServiceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      AuthorizationType: 'COGNITO_USER_POOLS',
      ApiKeyRequired: true,
    });
  });

  it('ApiKey リソースが作成される', () => {
    const app = new cdk.App();
    const stack = new LicenseServiceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'LicenseServiceKey',
    });
  });

  it('Usage Plan が作成され、ApiKey に紐付く', () => {
    const app = new cdk.App();
    const stack = new LicenseServiceStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResource('AWS::ApiGateway::UsagePlan', {});
    template.hasResourceProperties('AWS::ApiGateway::UsagePlanKey', {
      KeyType: 'API_KEY',
    });
  });
});
