// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for API Gateway Stack CloudFormation Template
 * 
 * Tests verify that the apigateway.yaml template creates all required resources
 * with proper security controls as specified in the design document.
 * 
 * Requirements tested: 1.1, 1.2, 1.7, 1.8, 6.2, 6.5, 6.6, 9.3, 9.4, 11.1
 */

const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

// Custom YAML schema to handle CloudFormation intrinsic functions
const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('!Ref', {
    kind: 'scalar',
    construct: (data) => ({ Ref: data }),
  }),
  new yaml.Type('!GetAtt', {
    kind: 'scalar',
    construct: (data) => {
      // Handle both "Resource.Attribute" and array format
      if (typeof data === 'string' && data.includes('.')) {
        return { 'Fn::GetAtt': data.split('.') };
      }
      return { 'Fn::GetAtt': data };
    },
  }),
  new yaml.Type('!Sub', {
    kind: 'scalar',
    construct: (data) => ({ 'Fn::Sub': data }),
  }),
  new yaml.Type('!Join', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Join': data }),
  }),
]);

describe('API Gateway Stack CloudFormation Template', () => {
  let template;

  beforeAll(() => {
    // Load the apigateway.yaml template
    const templatePath = path.join(__dirname, '..', '..', 'apigateway.yaml');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    template = yaml.load(templateContent, { schema: CFN_SCHEMA });
  });

  describe('Template Structure', () => {
    test('should have valid CloudFormation format version', () => {
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
    });

    test('should have a description', () => {
      expect(template.Description).toBeDefined();
      expect(template.Description).toContain('API Gateway');
    });

    test('should have Parameters section', () => {
      expect(template.Parameters).toBeDefined();
      expect(typeof template.Parameters).toBe('object');
    });

    test('should have Resources section', () => {
      expect(template.Resources).toBeDefined();
      expect(typeof template.Resources).toBe('object');
    });

    test('should have Outputs section', () => {
      expect(template.Outputs).toBeDefined();
      expect(typeof template.Outputs).toBe('object');
    });
  });

  describe('Parameters - Requirement 9.3, 9.4', () => {
    test('should accept S3KMSKeyArn parameter from Foundation stack', () => {
      const param = template.Parameters.S3KMSKeyArn;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('Foundation');
    });

    test('should accept UICodeS3Bucket parameter from CICD stack', () => {
      const param = template.Parameters.UICodeS3Bucket;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('CICD');
    });

    test('should accept APIGatewayName parameter', () => {
      const param = template.Parameters.APIGatewayName;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
    });

    test('should not have any nested stack dependencies', () => {
      // Verify no AWS::CloudFormation::Stack resources exist
      const nestedStacks = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::CloudFormation::Stack'
      );
      expect(nestedStacks.length).toBe(0);
    });
  });

  describe('IAM Managed Policy - Requirement 1.1, 1.2, 1.7, 1.8', () => {
    test('should create managed policy for API Gateway S3 access', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
    });

    test('should use managed policy instead of inline policy - Requirement 1.1, 1.7', () => {
      const role = template.Resources.IAMRole;
      expect(role).toBeDefined();
      
      // Verify role uses ManagedPolicyArns
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(role.Properties.ManagedPolicyArns)).toBe(true);
      
      // Verify no inline Policies property
      expect(role.Properties.Policies).toBeUndefined();
    });

    test('should scope S3 permissions to specific bucket - Requirement 1.2, 1.8', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const s3Statement = statements.find(s => s.Sid === 'GetObjectInBucket');
      expect(s3Statement).toBeDefined();
      expect(s3Statement.Effect).toBe('Allow');
      expect(s3Statement.Action).toContain('s3:GetObject');
      
      // Verify specific bucket ARN is used (no wildcards)
      const resource = s3Statement.Resource[0];
      expect(resource['Fn::Sub']).toContain('${UICodeS3Bucket}');
      expect(resource['Fn::Sub']).not.toBe('*');
    });

    test('should include KMS decrypt permissions for encrypted S3 objects - Requirement 1.2', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const kmsStatement = statements.find(s => s.Sid === 'KMSDecryptAccess');
      expect(kmsStatement).toBeDefined();
      expect(kmsStatement.Effect).toBe('Allow');
      expect(kmsStatement.Action).toContain('kms:Decrypt');
      expect(kmsStatement.Action).toContain('kms:DescribeKey');
      
      // Verify specific KMS key ARN is used
      const resource = kmsStatement.Resource[0];
      expect(resource.Ref).toBe('S3KMSKeyArn');
    });

    test('should not use wildcard resources - Requirement 1.8', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      statements.forEach(statement => {
        const resources = statement.Resource;
        if (Array.isArray(resources)) {
          resources.forEach(resource => {
            // Check if resource is a plain string
            if (typeof resource === 'string') {
              expect(resource).not.toBe('*');
            }
          });
        } else if (typeof resources === 'string') {
          expect(resources).not.toBe('*');
        }
      });
    });

    test('should use AWS::Partition for regional compatibility', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const s3Statement = statements.find(s => s.Sid === 'GetObjectInBucket');
      const resource = s3Statement.Resource[0];
      
      expect(resource['Fn::Sub']).toContain('${AWS::Partition}');
    });
  });

  describe('IAM Role', () => {
    test('should create IAM role for API Gateway', () => {
      const role = template.Resources.IAMRole;
      expect(role).toBeDefined();
      expect(role.Type).toBe('AWS::IAM::Role');
    });

    test('should allow API Gateway service to assume role', () => {
      const role = template.Resources.IAMRole;
      const assumePolicy = JSON.parse(role.Properties.AssumeRolePolicyDocument);
      
      expect(assumePolicy.Statement[0].Effect).toBe('Allow');
      expect(assumePolicy.Statement[0].Principal.Service).toBe('apigateway.amazonaws.com');
      expect(assumePolicy.Statement[0].Action).toBe('sts:AssumeRole');
    });

    test('should attach managed policies', () => {
      const role = template.Resources.IAMRole;
      const managedPolicies = role.Properties.ManagedPolicyArns;
      
      expect(managedPolicies).toBeDefined();
      expect(managedPolicies.length).toBeGreaterThan(0);
      
      // Should include AWS managed policy for CloudWatch Logs
      const cwLogsPolicy = managedPolicies.find(p => 
        p['Fn::Sub'] && p['Fn::Sub'].includes('AmazonAPIGatewayPushToCloudWatchLogs')
      );
      expect(cwLogsPolicy).toBeDefined();
      
      // Should include custom S3 access policy
      const s3Policy = managedPolicies.find(p => p.Ref === 'APIGatewayS3AccessPolicy');
      expect(s3Policy).toBeDefined();
    });
  });

  describe('API Gateway REST API', () => {
    test('should create REST API', () => {
      const api = template.Resources.ApiGatewayRestApi;
      expect(api).toBeDefined();
      expect(api.Type).toBe('AWS::ApiGateway::RestApi');
    });

    test('should use APIGatewayName parameter', () => {
      const api = template.Resources.ApiGatewayRestApi;
      expect(api.Properties.Name['Fn::Sub']).toContain('APIGatewayName');
    });

    test('should configure binary media types', () => {
      const api = template.Resources.ApiGatewayRestApi;
      expect(api.Properties.BinaryMediaTypes).toBeDefined();
      expect(api.Properties.BinaryMediaTypes).toContain('*/*');
    });

    test('should use regional endpoint', () => {
      const api = template.Resources.ApiGatewayRestApi;
      expect(api.Properties.EndpointConfiguration.Types).toContain('REGIONAL');
    });
  });

  describe('API Gateway Methods - Requirement 11.1', () => {
    test('should create GET method', () => {
      const method = template.Resources.ApiGatewayMethod;
      expect(method).toBeDefined();
      expect(method.Type).toBe('AWS::ApiGateway::Method');
      expect(method.Properties.HttpMethod).toBe('GET');
    });

    test('should set AuthorizationType to NONE - Requirement 11.1', () => {
      const method = template.Resources.ApiGatewayMethod;
      expect(method.Properties.AuthorizationType).toBe('NONE');
    });

    test('should create OPTIONS method for CORS', () => {
      const method = template.Resources.ApiGatewayMethod2;
      expect(method).toBeDefined();
      expect(method.Type).toBe('AWS::ApiGateway::Method');
      expect(method.Properties.HttpMethod).toBe('OPTIONS');
    });

    test('OPTIONS method should also have AuthorizationType NONE', () => {
      const method = template.Resources.ApiGatewayMethod2;
      expect(method.Properties.AuthorizationType).toBe('NONE');
    });

    test('GET method should integrate with S3', () => {
      const method = template.Resources.ApiGatewayMethod;
      const integration = method.Properties.Integration;
      
      expect(integration.Type).toBe('AWS');
      expect(integration.IntegrationHttpMethod).toBe('GET');
      expect(integration.Uri['Fn::Sub']).toContain('s3:path');
    });

    test('GET method should use IAM role credentials', () => {
      const method = template.Resources.ApiGatewayMethod;
      const integration = method.Properties.Integration;
      
      expect(integration.Credentials['Fn::GetAtt'][0]).toBe('IAMRole');
      expect(integration.Credentials['Fn::GetAtt'][1]).toBe('Arn');
    });

    test('should configure CORS headers', () => {
      const method = template.Resources.ApiGatewayMethod;
      const response = method.Properties.MethodResponses[0];
      
      expect(response.ResponseParameters['method.response.header.Access-Control-Allow-Origin']).toBe(false);
    });
  });

  describe('API Gateway Resources', () => {
    test('should create chatbot resource', () => {
      const resource = template.Resources.ChatbotResource;
      expect(resource).toBeDefined();
      expect(resource.Type).toBe('AWS::ApiGateway::Resource');
      expect(resource.Properties.PathPart).toBe('chatbot');
    });

    test('should create folder path parameter resource', () => {
      const resource = template.Resources.ApiGatewayResource;
      expect(resource).toBeDefined();
      expect(resource.Type).toBe('AWS::ApiGateway::Resource');
      expect(resource.Properties.PathPart).toBe('{folder}');
    });

    test('should create item path parameter resource', () => {
      const resource = template.Resources.ApiGatewayResource2;
      expect(resource).toBeDefined();
      expect(resource.Type).toBe('AWS::ApiGateway::Resource');
      expect(resource.Properties.PathPart).toBe('{item+}');
    });
  });

  describe('API Gateway Stage and Deployment', () => {
    test('should create deployment', () => {
      const deployment = template.Resources.ApiGatewayDeployment;
      expect(deployment).toBeDefined();
      expect(deployment.Type).toBe('AWS::ApiGateway::Deployment');
    });

    test('should create stage', () => {
      const stage = template.Resources.ApiGatewayStage;
      expect(stage).toBeDefined();
      expect(stage.Type).toBe('AWS::ApiGateway::Stage');
      expect(stage.Properties.StageName).toBe('v1');
    });

    test('deployment should depend on methods', () => {
      const deployment = template.Resources.ApiGatewayDeployment;
      expect(deployment.DependsOn).toBeDefined();
      expect(deployment.DependsOn).toContain('ApiGatewayMethod');
      expect(deployment.DependsOn).toContain('ApiGatewayMethod2');
    });
  });

  describe('Access Logging - Requirement 6.2, 6.5, 6.6', () => {
    test('should create CloudWatch Log Group for access logs - Requirement 6.2, 6.5', () => {
      const logGroup = template.Resources.APIGatewayLogGroup;
      expect(logGroup).toBeDefined();
      expect(logGroup.Type).toBe('AWS::Logs::LogGroup');
    });

    test('should set log retention to 90 days - Requirement 6.6', () => {
      const logGroup = template.Resources.APIGatewayLogGroup;
      expect(logGroup.Properties.RetentionInDays).toBe(90);
    });

    test('should configure access logging on API Gateway stage - Requirement 6.2', () => {
      const stage = template.Resources.ApiGatewayStage;
      expect(stage.Properties.AccessLogSetting).toBeDefined();
      expect(stage.Properties.AccessLogSetting.DestinationArn).toBeDefined();
    });

    test('access log destination should reference log group', () => {
      const stage = template.Resources.ApiGatewayStage;
      const destinationArn = stage.Properties.AccessLogSetting.DestinationArn;
      
      expect(destinationArn['Fn::GetAtt']).toBeDefined();
      expect(destinationArn['Fn::GetAtt'][0]).toBe('APIGatewayLogGroup');
      expect(destinationArn['Fn::GetAtt'][1]).toBe('Arn');
    });

    test('should configure access log format', () => {
      const stage = template.Resources.ApiGatewayStage;
      expect(stage.Properties.AccessLogSetting.Format).toBeDefined();
      expect(typeof stage.Properties.AccessLogSetting.Format).toBe('string');
      expect(stage.Properties.AccessLogSetting.Format).toContain('$context');
    });

    test('log group name should follow naming convention', () => {
      const logGroup = template.Resources.APIGatewayLogGroup;
      expect(logGroup.Properties.LogGroupName['Fn::Sub']).toContain('/aws/apigateway/');
    });
  });

  describe('Stack Outputs', () => {
    test('should export API endpoint', () => {
      const output = template.Outputs.ApiEndpoint;
      expect(output).toBeDefined();
      expect(output.Description).toContain('API Gateway endpoint');
      expect(output.Value['Fn::Sub']).toContain('execute-api');
    });

    test('should export user URL', () => {
      const output = template.Outputs.UserURL;
      expect(output).toBeDefined();
      expect(output.Description).toContain('API Gateway endpoint');
      expect(output.Value['Fn::Sub']).toContain('index.html');
    });

    test('outputs should reference UICodeS3Bucket parameter', () => {
      const userUrl = template.Outputs.UserURL;
      expect(userUrl.Value['Fn::Sub']).toContain('UICodeS3Bucket');
    });
  });

  describe('No Nested Stack Dependencies - Requirement 9.3', () => {
    test('should not contain any nested stack resources', () => {
      const nestedStacks = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::CloudFormation::Stack'
      );
      
      expect(nestedStacks.length).toBe(0);
    });

    test('should use parameters instead of nested stack references', () => {
      // Verify that all required parameters are defined
      expect(template.Parameters.S3KMSKeyArn).toBeDefined();
      expect(template.Parameters.UICodeS3Bucket).toBeDefined();
      expect(template.Parameters.APIGatewayName).toBeDefined();
    });
  });

  describe('Integration with Other Stacks', () => {
    test('should accept Foundation stack outputs as parameters', () => {
      const foundationParams = ['S3KMSKeyArn'];
      
      foundationParams.forEach(param => {
        expect(template.Parameters[param]).toBeDefined();
        expect(template.Parameters[param].Description).toContain('Foundation');
      });
    });

    test('should accept CICD stack outputs as parameters', () => {
      const cicdParams = ['UICodeS3Bucket'];
      
      cicdParams.forEach(param => {
        expect(template.Parameters[param]).toBeDefined();
        expect(template.Parameters[param].Description).toContain('CICD');
      });
    });

    test('should use Foundation KMS key for S3 decryption', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const kmsStatement = statements.find(s => s.Sid === 'KMSDecryptAccess');
      expect(kmsStatement.Resource[0].Ref).toBe('S3KMSKeyArn');
    });

    test('should use CICD UI code bucket for S3 integration', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const s3Statement = statements.find(s => s.Sid === 'GetObjectInBucket');
      expect(s3Statement.Resource[0]['Fn::Sub']).toContain('${UICodeS3Bucket}');
    });
  });

  describe('Security Controls', () => {
    test('should not use wildcard IAM permissions', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      statements.forEach(statement => {
        // Check actions are not wildcards
        if (Array.isArray(statement.Action)) {
          statement.Action.forEach(action => {
            expect(action).not.toBe('*');
          });
        } else {
          expect(statement.Action).not.toBe('*');
        }
        
        // Check resources are not wildcards
        if (statement.Resource) {
          const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
          resources.forEach(resource => {
            if (typeof resource === 'string') {
              expect(resource).not.toBe('*');
            }
          });
        }
      });
    });

    test('should use specific S3 bucket ARN', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const s3Statement = statements.find(s => s.Sid === 'GetObjectInBucket');
      const resource = s3Statement.Resource[0];
      
      // Should reference specific bucket parameter
      expect(resource['Fn::Sub']).toBeDefined();
      expect(resource['Fn::Sub']).toContain('UICodeS3Bucket');
    });

    test('should use specific KMS key ARN', () => {
      const policy = template.Resources.APIGatewayS3AccessPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const kmsStatement = statements.find(s => s.Sid === 'KMSDecryptAccess');
      const resource = kmsStatement.Resource[0];
      
      // Should reference specific KMS key parameter
      expect(resource.Ref).toBe('S3KMSKeyArn');
    });

    test('should maintain authorization as NONE per requirement', () => {
      // Verify all methods have AuthorizationType NONE
      const method1 = template.Resources.ApiGatewayMethod;
      const method2 = template.Resources.ApiGatewayMethod2;
      
      expect(method1.Properties.AuthorizationType).toBe('NONE');
      expect(method2.Properties.AuthorizationType).toBe('NONE');
    });
  });
});
