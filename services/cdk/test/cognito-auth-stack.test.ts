import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SankeyAuthStack } from '../lib/sankey-auth-stack';

describe('CognitoAuthStack', () => {
  test('should not have apiKeyId and apiKey custom attributes', () => {
    const app = new cdk.App();
    // Stack Props for testing (adjust domainPrefix as needed)
    const stack = new SankeyAuthStack(app, 'MyTestCognitoAuthStack', {
      domainPrefix: 'mytestdomain',
      // callbackUrls and logoutUrls can be omitted or mocked if not essential for this specific test
    });

    const template = Template.fromStack(stack);

    // UserPoolリソースを取得
    const userPools = template.findResources('AWS::Cognito::UserPool');
    const userPoolIds = Object.keys(userPools);

    // UserPoolが1つだけ存在することを期待
    expect(userPoolIds.length).toBe(1);
    const userPoolId = userPoolIds[0];

    const userPoolResource = template.toJSON().Resources[userPoolId];
    // SchemaAttributeが存在し、その中に custom:apiKeyId や custom:apiKey が *ない* ことを確認
    // もし Schema プロパティ自体が存在しない、または空配列ならそれもOK
    if (userPoolResource.Properties.Schema) {
      const schemaAttributes = userPoolResource.Properties.Schema as Array<any>;
      const customApiKeyIdAttr = schemaAttributes.find(attr => attr.Name === 'apiKeyId');
      const customApiKeyAttr = schemaAttributes.find(attr => attr.Name === 'apiKey');
      expect(customApiKeyIdAttr).toBeUndefined();
      expect(customApiKeyAttr).toBeUndefined();
    } else {
      // Schemaプロパティ自体が存在しない場合は、カスタム属性がないのでOK
      expect(true).toBe(true);
    }
  });
});
