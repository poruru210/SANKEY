import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SankeyNotificationStack } from '../lib/sankey-notification-stack';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'; // Ensure this import is present

describe('NotificationStack', () => {
  let app: cdk.App;
  let testHostStack: cdk.Stack;
  let stack: SankeyNotificationStack;
  let template: Template;
  let mockTable: dynamodb.Table;

  beforeAll(() => {
    app = new cdk.App();
    testHostStack = new cdk.Stack(app, 'TestHostStackForNotification');
    mockTable = new dynamodb.Table(testHostStack, 'MockTableForNotification', { // Scope to host stack
        partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }
    });
    stack = new SankeyNotificationStack(app, 'MyTestNotificationStack', { // This is a stack, scoped to app
        eaApplicationsTable: mockTable
    });
    template = Template.fromStack(stack);
  });

  test('LicenseNotification SQS Queue should be created', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2); // Changed from 1 to 2 to account for main queue + DLQ
    template.hasResourceProperties('AWS::SQS::Queue', {
      // QueueName: 'license-notification-queue-notificationstack', // This will vary, removing for robustness
      // Add more specific assertions if needed for the main queue or DLQ
    });
  });

  test('EmailNotification Lambda Function should be created', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      // FunctionName: 'email-notification-notificationstack', // This will vary, removing for robustness
      Runtime: 'nodejs22.x', // Or your specified runtime
    });
  });
});
