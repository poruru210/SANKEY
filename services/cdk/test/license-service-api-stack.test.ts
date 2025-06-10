import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SankeyApplicationStack } from '../lib/sankey-application-stack';
import { SankeyAuthStack } from '../lib/sankey-auth-stack';
import { SankeyDbStack } from '../lib/sankey-db-stack';
import { SankeyNotificationStack } from '../lib/sankey-notification-stack';

// Helper function to create common stack props for testing
const createApiStackWithDependencies = () => {
  const app = new cdk.App();
  // It's good practice to use distinct names for test stacks if they are synthesized in the same app
  const cognitoStack = new SankeyAuthStack(app, 'TestCognitoStackForApi', { domainPrefix: 'test-api-auth' });
      // Pass the required userPool prop to LicenseServiceDbStack
      const dbStack = new SankeyDbStack(app, 'TestDbStackForApi', {
        userPool: cognitoStack.userPool
      });
      // Pass the required eaApplicationsTable prop to NotificationStack
      // Assuming 'table' is the correct public property name in LicenseServiceDbStack for the DynamoDB table
      const notificationStack = new SankeyNotificationStack(app, 'TestNotificationStackForApi', {
        eaApplicationsTable: dbStack.table
      });
  const apiStack = new SankeyApplicationStack(app, 'MyTestLicenseServiceApiStack', {
    userPool: cognitoStack.userPool,
    userPoolClient: cognitoStack.userPoolClient,
        // Assuming 'table' is the correct public property name in LicenseServiceDbStack
        eaApplicationsTable: dbStack.table,
    licenseNotificationQueue: notificationStack.licenseNotificationQueue,
  });
  return { app, apiStack, cognitoStack, dbStack, notificationStack };
};

describe('LicenseServiceApiStack', () => {
  let template: Template;
  let app: cdk.App;

  beforeAll(() => {
    const stacks = createApiStackWithDependencies();
    template = Template.fromStack(stacks.apiStack);
    app = stacks.app;
  });

  describe('API Key Requirement Tests', () => {
    const cognitoAuthenticatedEndpoints = [
      { path: 'applications', method: 'GET' },
      { path: 'applications/{id}/approve', method: 'POST' },
      { path: 'applications/{id}/cancel', method: 'POST' },
      { path: 'applications/{id}/reject', method: 'POST' },
      { path: 'licenses/{id}/revoke', method: 'POST' },
      { path: 'licenses/{id}/decrypt', method: 'POST' },
      { path: 'plans', method: 'GET' },
      { path: 'plans/change', method: 'POST' },
    ];

    cognitoAuthenticatedEndpoints.forEach(endpoint => {
      test(`Method ${endpoint.method} for /${endpoint.path} should have apiKeyRequired set to false or undefined`, () => {
        const methods = template.findResources('AWS::ApiGateway::Method', {
          Properties: {
            HttpMethod: endpoint.method,
            AuthorizationType: 'COGNITO_USER_POOLS',
            // Note: Matching specific path is complex here due to how CDK generates logical IDs and resolves paths.
            // This test broadly checks all Cognito authenticated methods of a certain HTTP type.
          }
        });
        let foundSpecificMethod = false;
        for (const logicalId in methods) {
          const methodProps = methods[logicalId].Properties;
          // Check if ApiKeyRequired is explicitly false or not present (implying false for COGNITO_USER_POOLS)
          expect(methodProps.ApiKeyRequired === false || methodProps.ApiKeyRequired === undefined).toBe(true);
          // A more robust test would involve inspecting the ResourceId and its path parts.
          // For now, we assume any COGNITO_USER_POOLS authenticated method of this type should have ApiKeyRequired:false
          if(methodProps.HttpMethod === endpoint.method) foundSpecificMethod = true;
        }
        // This assertion helps to ensure that we are indeed testing something.
        // It might need adjustment if not all HttpMethods uniquely identify the modified endpoints.
         expect(foundSpecificMethod).toBe(true);
      });
    });

    test('GET /health endpoint should remain apiKeyRequired: false and Auth NONE', () => {
      const healthResourceLogicalId = Object.keys(template.findResources('AWS::ApiGateway::Resource', { Properties: { PathPart: 'health' }}))[0];
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        ResourceId: { Ref: healthResourceLogicalId },
        HttpMethod: 'GET',
        AuthorizationType: 'NONE',
        ApiKeyRequired: false,
      });
    });

    test('POST /applications/webhook endpoint should remain apiKeyRequired: false and Auth NONE', () => {
      const appResources = template.findResources('AWS::ApiGateway::Resource', { Properties: { PathPart: 'applications' }});
      const appResourceLogicalId = Object.keys(appResources)[0];
      const webhookResourceLogicalId = Object.keys(template.findResources('AWS::ApiGateway::Resource', { Properties: { PathPart: 'webhook', ParentId: { Ref: appResourceLogicalId} }}))[0];
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        ResourceId: { Ref: webhookResourceLogicalId },
        HttpMethod: 'POST',
        AuthorizationType: 'NONE',
        ApiKeyRequired: false,
      });
    });
  });

});
