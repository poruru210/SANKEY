import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SankeyDbStack } from '../lib/sankey-db-stack';
import * as cognito from 'aws-cdk-lib/aws-cognito';

describe('LicenseServiceDbStack', () => {
  let app: cdk.App;
  let testHostStack: cdk.Stack;
  let stack: SankeyDbStack;
  let template: Template;
  let mockUserPool: cognito.UserPool;

  beforeAll(() => {
    app = new cdk.App();
    testHostStack = new cdk.Stack(app, 'TestHostStackForDb');
    mockUserPool = new cognito.UserPool(testHostStack, 'MockUserPoolForDb');
    stack = new SankeyDbStack(app, 'MyTestDbStack', {
      userPool: mockUserPool
    });
    template = Template.fromStack(stack);
  });

  test('EAApplications DynamoDB Table should be created with correct schema', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ]),
      KeySchema: Match.arrayWith([
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ]),
      TableName: Match.stringLikeRegexp('sankey-applications-dev'),
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true
      },
      // No GlobalSecondaryIndexes since they're not defined in the stack
    });
  });

  test('DynamoDB Table should have correct tags', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        { Key: 'Environment', Value: 'dev' },
        { Key: 'TTLMonths', Value: { Ref: 'TTLMonths' } },
      ])
    });
  });

  test('Stack should create correct outputs', () => {
    // Check that outputs exist - the exact names depend on how CdkHelpers.createOutputs works
    // Let's just verify some outputs exist for now
    const template_obj = template.toJSON();
    expect(template_obj.Outputs).toBeDefined();
    expect(Object.keys(template_obj.Outputs).length).toBeGreaterThan(0);

    // Check for outputs containing table information
    const outputKeys = Object.keys(template_obj.Outputs);
    const tableNameOutput = outputKeys.find(key => key.includes('SankeyTableName'));
    const tableArnOutput = outputKeys.find(key => key.includes('SankeyTableArn'));

    expect(tableNameOutput).toBeDefined();
    expect(tableArnOutput).toBeDefined();
  });

  test('Stack should have TTL parameter', () => {
    template.hasParameter('TTLMonths', {
      Type: 'Number',
      MinValue: 1,
      MaxValue: 60,
      Description: 'Number of months after which terminal status records will be automatically deleted'
    });
  });
});