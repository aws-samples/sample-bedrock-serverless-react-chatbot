// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for Bedrock Stack CloudFormation Template
 * 
 * Tests verify that the bedrock.yaml template has no inline IAM policies
 * and uses managed policies instead, as specified in task 2.2.
 * 
 * Requirements tested: 1.1, 1.7 (No inline IAM policies)
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
  new yaml.Type('!If', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::If': data }),
  }),
  new yaml.Type('!Not', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Not': data }),
  }),
  new yaml.Type('!Equals', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Equals': data }),
  }),
]);

describe('Bedrock Stack CloudFormation Template', () => {
  let template;

  beforeAll(() => {
    // Load the bedrock.yaml template
    const templatePath = path.join(__dirname, '..', '..', 'bedrock.yaml');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    template = yaml.load(templateContent, { schema: CFN_SCHEMA });
  });

  describe('Template Structure', () => {
    test('should have valid CloudFormation format version', () => {
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
    });

    test('should have a description', () => {
      expect(template.Description).toBeDefined();
      expect(template.Description).toContain('Bedrock Stack');
    });

    test('should have Resources section', () => {
      expect(template.Resources).toBeDefined();
      expect(typeof template.Resources).toBe('object');
    });
  });

  describe('IAM Roles - No Inline Policies (Requirements 1.1, 1.7)', () => {
    test('should not have any IAM roles with inline Policies', () => {
      const iamRoles = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::Role'
      );

      expect(iamRoles.length).toBeGreaterThan(0);

      iamRoles.forEach(([roleName, role]) => {
        expect(role.Properties.Policies).toBeUndefined();
      });
    });

    test('LambdaServiceRole should use ManagedPolicyArns', () => {
      const role = template.Resources.LambdaServiceRole;
      expect(role).toBeDefined();
      expect(role.Type).toBe('AWS::IAM::Role');
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(role.Properties.ManagedPolicyArns)).toBe(true);
      expect(role.Properties.ManagedPolicyArns.length).toBeGreaterThan(0);
    });

    test('BedrockKnowledgeBaseRole should use ManagedPolicyArns', () => {
      const role = template.Resources.BedrockKnowledgeBaseRole;
      expect(role).toBeDefined();
      expect(role.Type).toBe('AWS::IAM::Role');
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(role.Properties.ManagedPolicyArns)).toBe(true);
      expect(role.Properties.ManagedPolicyArns.length).toBeGreaterThan(0);
    });

    test('BedrockAgentResourceRole should use ManagedPolicyArns', () => {
      const role = template.Resources.BedrockAgentResourceRole;
      expect(role).toBeDefined();
      expect(role.Type).toBe('AWS::IAM::Role');
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(role.Properties.ManagedPolicyArns)).toBe(true);
      expect(role.Properties.ManagedPolicyArns.length).toBeGreaterThan(0);
    });

    test('BedrockAgentRole should use ManagedPolicyArns', () => {
      const role = template.Resources.BedrockAgentRole;
      expect(role).toBeDefined();
      expect(role.Type).toBe('AWS::IAM::Role');
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(role.Properties.ManagedPolicyArns)).toBe(true);
      expect(role.Properties.ManagedPolicyArns.length).toBeGreaterThan(0);
    });
  });

  describe('IAM Managed Policies', () => {
    test('should have LambdaServiceRolePolicy managed policy', () => {
      const policy = template.Resources.LambdaServiceRolePolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
      expect(policy.Properties.PolicyDocument).toBeDefined();
      expect(policy.Properties.PolicyDocument.Statement).toBeDefined();
    });

    test('LambdaServiceRolePolicy should include DLQ permissions', () => {
      const policy = template.Resources.LambdaServiceRolePolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const dlqStatement = statements.find(s => s.Sid === 'SQSSendMessageToDLQ');
      expect(dlqStatement).toBeDefined();
      expect(dlqStatement.Action).toContain('sqs:SendMessage');
    });

    test('should have BedrockKnowledgeBaseRolePolicy managed policy', () => {
      const policy = template.Resources.BedrockKnowledgeBaseRolePolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
      expect(policy.Properties.PolicyDocument).toBeDefined();
    });

    test('should have BedrockAgentResourceRolePolicy managed policy', () => {
      const policy = template.Resources.BedrockAgentResourceRolePolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
      expect(policy.Properties.PolicyDocument).toBeDefined();
    });

    test('should have BedrockAgentRolePolicy managed policy', () => {
      const policy = template.Resources.BedrockAgentRolePolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
      expect(policy.Properties.PolicyDocument).toBeDefined();
    });

    test('all managed policies should have descriptive names', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        expect(policy.Properties.ManagedPolicyName).toBeDefined();
        expect(policy.Properties.Description).toBeDefined();
      });
    });

    test('all managed policies should have Sid for each statement', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach(statement => {
          expect(statement.Sid).toBeDefined();
        });
      });
    });
  });

  describe('Lambda Function Configuration', () => {
    test('IndexCreatorFunction should have DeadLetterConfig', () => {
      const lambda = template.Resources.IndexCreatorFunction;
      expect(lambda).toBeDefined();
      expect(lambda.Type).toBe('AWS::Lambda::Function');
      expect(lambda.Properties.DeadLetterConfig).toBeDefined();
      expect(lambda.Properties.DeadLetterConfig.TargetArn).toBeDefined();
    });

    test('IndexCreatorFunction should reference LambdaDLQArn parameter', () => {
      const lambda = template.Resources.IndexCreatorFunction;
      const dlqArn = lambda.Properties.DeadLetterConfig.TargetArn;
      
      // Check if it references the parameter
      expect(dlqArn.Ref).toBe('LambdaDLQArn');
    });
  });

  describe('Foundation Stack Parameters', () => {
    test('should have DynamoDBKMSKeyId parameter', () => {
      expect(template.Parameters.DynamoDBKMSKeyId).toBeDefined();
      expect(template.Parameters.DynamoDBKMSKeyId.Type).toBe('String');
    });

    test('should have S3KMSKeyId parameter', () => {
      expect(template.Parameters.S3KMSKeyId).toBeDefined();
      expect(template.Parameters.S3KMSKeyId.Type).toBe('String');
    });

    test('should have S3AccessLogsBucket parameter', () => {
      expect(template.Parameters.S3AccessLogsBucket).toBeDefined();
      expect(template.Parameters.S3AccessLogsBucket.Type).toBe('String');
    });

    test('should have LambdaDLQArn parameter', () => {
      expect(template.Parameters.LambdaDLQArn).toBeDefined();
      expect(template.Parameters.LambdaDLQArn.Type).toBe('String');
    });
  });

  describe('GuardrailId Parameter Validation (Requirements 7.1, 7.2, 7.5)', () => {
    test('should have GuardrailId parameter', () => {
      expect(template.Parameters.GuardrailId).toBeDefined();
      expect(template.Parameters.GuardrailId.Type).toBe('String');
    });

    test('GuardrailId should be optional with empty default', () => {
      expect(template.Parameters.GuardrailId.Default).toBe('');
    });

    test('GuardrailId should have AllowedPattern to reject TODO', () => {
      expect(template.Parameters.GuardrailId.AllowedPattern).toBeDefined();
      const pattern = template.Parameters.GuardrailId.AllowedPattern;
      
      // Pattern should allow empty string or alphanumeric but NOT 'TODO'
      expect(pattern).toMatch(/\^\$/); // Allows empty
      expect(pattern).toMatch(/\[a-zA-Z0-9\]/); // Allows alphanumeric
      
      // Pattern should use negative lookahead to reject 'TODO'
      expect(pattern).toContain('(?!TODO');
      
      // Verify the constraint description mentions TODO
      expect(template.Parameters.GuardrailId.ConstraintDescription).toBeDefined();
      expect(template.Parameters.GuardrailId.ConstraintDescription).toContain('TODO');
      
      // Test the pattern with a regex
      const regex = new RegExp(pattern);
      expect(regex.test('')).toBe(true); // Empty should match
      expect(regex.test('abc123')).toBe(true); // Valid ID should match
      expect(regex.test('TODO')).toBe(false); // TODO should NOT match
      expect(regex.test('todo')).toBe(true); // lowercase todo should match (case-sensitive)
    });

    test('should have GuardrailVersion parameter', () => {
      expect(template.Parameters.GuardrailVersion).toBeDefined();
      expect(template.Parameters.GuardrailVersion.Type).toBe('String');
      expect(template.Parameters.GuardrailVersion.Default).toBe('');
    });

    test('should have HasGuardrailId condition', () => {
      expect(template.Conditions).toBeDefined();
      expect(template.Conditions.HasGuardrailId).toBeDefined();
      
      // Condition should check if GuardrailId is not empty
      const condition = template.Conditions.HasGuardrailId;
      expect(condition['Fn::Not']).toBeDefined();
      expect(condition['Fn::Not'][0]['Fn::Equals']).toBeDefined();
      expect(condition['Fn::Not'][0]['Fn::Equals'][0].Ref).toBe('GuardrailId');
      expect(condition['Fn::Not'][0]['Fn::Equals'][1]).toBe('');
    });

    test('BedrockAgent should conditionally include GuardrailConfiguration', () => {
      const agent = template.Resources.BedrockAgent;
      expect(agent).toBeDefined();
      expect(agent.Properties.GuardrailConfiguration).toBeDefined();
      
      // Should use Fn::If with HasGuardrailId condition
      const guardrailConfig = agent.Properties.GuardrailConfiguration;
      expect(guardrailConfig['Fn::If']).toBeDefined();
      expect(guardrailConfig['Fn::If'][0]).toBe('HasGuardrailId');
      
      // When condition is true, should have GuardrailIdentifier and GuardrailVersion
      const whenTrue = guardrailConfig['Fn::If'][1];
      expect(whenTrue.GuardrailIdentifier).toBeDefined();
      expect(whenTrue.GuardrailIdentifier.Ref).toBe('GuardrailId');
      expect(whenTrue.GuardrailVersion).toBeDefined();
      expect(whenTrue.GuardrailVersion.Ref).toBe('GuardrailVersion');
      
      // When condition is false, should use AWS::NoValue
      const whenFalse = guardrailConfig['Fn::If'][2];
      expect(whenFalse.Ref).toBe('AWS::NoValue');
    });
  });

  describe('Security Best Practices', () => {
    test('all IAM policy statements should use AWS::Partition for ARNs', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach(statement => {
          if (statement.Resource) {
            const resources = Array.isArray(statement.Resource) 
              ? statement.Resource 
              : [statement.Resource];
            
            resources.forEach(resource => {
              // Check if resource is an ARN string (not a Ref or GetAtt)
              if (typeof resource === 'object' && resource['Fn::Sub']) {
                const arnString = resource['Fn::Sub'];
                if (arnString.includes('arn:')) {
                  expect(arnString).toContain('${AWS::Partition}');
                }
              }
            });
          }
        });
      });
    });

    test('no IAM policies should have wildcard-only resources', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach((statement, idx) => {
          if (statement.Resource) {
            const resources = Array.isArray(statement.Resource) 
              ? statement.Resource 
              : [statement.Resource];
            
            // Check each resource for wildcards
            resources.forEach(resource => {
              if (resource === '*') {
                // Wildcard is only acceptable with conditions (e.g., CloudWatch metrics)
                const hasCondition = statement.Condition !== undefined;
                
                expect(hasCondition).toBe(true);
                if (!hasCondition) {
                  throw new Error(`Policy ${policyName} statement ${idx} (${statement.Sid}) has wildcard resource without condition`);
                }
              }
            });
          }
        });
      });
    });

    test('IAM policies should scope S3 permissions to specific buckets', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach(statement => {
          // Check if statement has S3 actions
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          const hasS3Actions = actions.some(action => action.startsWith('s3:'));
          
          if (hasS3Actions && statement.Resource) {
            const resources = Array.isArray(statement.Resource) 
              ? statement.Resource 
              : [statement.Resource];
            
            resources.forEach(resource => {
              // S3 resources should not be wildcards
              expect(resource).not.toBe('*');
              
              // If it's a Fn::Sub, check the ARN pattern
              if (typeof resource === 'object' && resource['Fn::Sub']) {
                const arnString = resource['Fn::Sub'];
                // Should have specific bucket name, not s3:*
                expect(arnString).not.toMatch(/arn:.*:s3:::\*/);
              }
            });
          }
        });
      });
    });

    test('IAM policies should scope CloudWatch Logs permissions to specific log groups', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach(statement => {
          // Check if statement has CloudWatch Logs actions
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          const hasLogsActions = actions.some(action => action.startsWith('logs:'));
          
          if (hasLogsActions && statement.Resource) {
            const resources = Array.isArray(statement.Resource) 
              ? statement.Resource 
              : [statement.Resource];
            
            resources.forEach(resource => {
              // CloudWatch Logs resources should not be wildcards
              expect(resource).not.toBe('*');
              
              // If it's a Fn::Sub, check the ARN pattern
              if (typeof resource === 'object' && resource['Fn::Sub']) {
                const arnString = resource['Fn::Sub'];
                // Should contain log-group in the ARN (specific log group)
                expect(arnString).toMatch(/log-group:/);
                // Should not end with just :* (without log-group name)
                // Pattern like arn:...:logs:...:...:* is bad
                // Pattern like arn:...:logs:...:...:log-group:/aws/lambda/Function:* is good
                const hasSpecificLogGroup = arnString.match(/log-group:\/[^:]+/);
                expect(hasSpecificLogGroup).toBeTruthy();
              }
            });
          }
        });
      });
    });

    test('IAM policies should scope Bedrock permissions to specific models or resources', () => {
      const managedPolicies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::ManagedPolicy'
      );

      managedPolicies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach(statement => {
          // Check if statement has Bedrock actions
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          const hasBedrockActions = actions.some(action => action.startsWith('bedrock:'));
          
          if (hasBedrockActions && statement.Resource) {
            const resources = Array.isArray(statement.Resource) 
              ? statement.Resource 
              : [statement.Resource];
            
            resources.forEach(resource => {
              // If it's a Fn::Sub, check the ARN pattern
              if (typeof resource === 'object' && resource['Fn::Sub']) {
                const arnString = resource['Fn::Sub'];
                // Should have specific resource type (foundation-model, knowledge-base, agent, etc.)
                // Not just bedrock:*
                if (arnString.includes('bedrock')) {
                  expect(arnString).toMatch(/foundation-model|knowledge-base|agent|inference-profile/);
                }
              }
            });
          }
        });
      });
    });

    test('IAM policies should scope AOSS permissions to specific collections', () => {
      const policies = Object.entries(template.Resources).filter(
        ([_, resource]) => resource.Type === 'AWS::IAM::Policy'
      );

      policies.forEach(([policyName, policy]) => {
        const statements = policy.Properties.PolicyDocument.Statement;
        statements.forEach(statement => {
          // Check if statement has AOSS actions
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          const hasAOSSActions = actions.some(action => action.startsWith('aoss:'));
          
          if (hasAOSSActions && statement.Resource) {
            const resources = Array.isArray(statement.Resource) 
              ? statement.Resource 
              : [statement.Resource];
            
            resources.forEach(resource => {
              // AOSS resources should not be wildcards
              expect(resource).not.toBe('*');
              
              // Should reference specific collection
              if (typeof resource === 'object' && resource['Fn::GetAtt']) {
                expect(resource['Fn::GetAtt'][0]).toBe('OSSCollection');
              }
            });
          }
        });
      });
    });
  });

  describe('S3 Bucket Security - PersonaS3Bucket (Requirements 2.2, 3.1, 3.2, 3.3, 3.4, 3.5)', () => {
    test('PersonaS3Bucket should exist', () => {
      const bucket = template.Resources.PersonaS3Bucket;
      expect(bucket).toBeDefined();
      expect(bucket.Type).toBe('AWS::S3::Bucket');
    });

    test('PersonaS3Bucket should have KMS encryption enabled (Requirement 2.2, 3.5)', () => {
      const bucket = template.Resources.PersonaS3Bucket;
      expect(bucket.Properties.BucketEncryption).toBeDefined();
      expect(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration).toBeDefined();
      
      const sseConfig = bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0];
      expect(sseConfig.ServerSideEncryptionByDefault).toBeDefined();
      expect(sseConfig.ServerSideEncryptionByDefault.SSEAlgorithm).toBe('aws:kms');
      expect(sseConfig.ServerSideEncryptionByDefault.KMSMasterKeyID).toBeDefined();
      
      // Should reference S3KMSKeyId parameter
      expect(sseConfig.ServerSideEncryptionByDefault.KMSMasterKeyID.Ref).toBe('S3KMSKeyId');
    });

    test('PersonaS3Bucket should have Block Public Access enabled (Requirement 3.1)', () => {
      const bucket = template.Resources.PersonaS3Bucket;
      expect(bucket.Properties.PublicAccessBlockConfiguration).toBeDefined();
      
      const blockConfig = bucket.Properties.PublicAccessBlockConfiguration;
      expect(blockConfig.BlockPublicAcls).toBe(true);
      expect(blockConfig.BlockPublicPolicy).toBe(true);
      expect(blockConfig.IgnorePublicAcls).toBe(true);
      expect(blockConfig.RestrictPublicBuckets).toBe(true);
    });

    test('PersonaS3Bucket should have versioning enabled (Requirement 3.2)', () => {
      const bucket = template.Resources.PersonaS3Bucket;
      expect(bucket.Properties.VersioningConfiguration).toBeDefined();
      expect(bucket.Properties.VersioningConfiguration.Status).toBe('Enabled');
    });

    test('PersonaS3Bucket should have server access logging enabled (Requirement 3.3)', () => {
      const bucket = template.Resources.PersonaS3Bucket;
      expect(bucket.Properties.LoggingConfiguration).toBeDefined();
      expect(bucket.Properties.LoggingConfiguration.DestinationBucketName).toBeDefined();
      
      // Should reference S3AccessLogsBucket parameter
      expect(bucket.Properties.LoggingConfiguration.DestinationBucketName.Ref).toBe('S3AccessLogsBucket');
      expect(bucket.Properties.LoggingConfiguration.LogFilePrefix).toBeDefined();
    });

    test('PersonaS3BucketPolicy should enforce TLS-only access (Requirement 3.4)', () => {
      const bucketPolicy = template.Resources.PersonaS3BucketPolicy;
      expect(bucketPolicy).toBeDefined();
      expect(bucketPolicy.Type).toBe('AWS::S3::BucketPolicy');
      expect(bucketPolicy.Properties.Bucket).toBeDefined();
      
      // Should reference PersonaS3Bucket
      expect(bucketPolicy.Properties.Bucket.Ref).toBe('PersonaS3Bucket');
      
      const statements = bucketPolicy.Properties.PolicyDocument.Statement;
      expect(statements).toBeDefined();
      
      // Find the DenyInsecureTransport statement
      const tlsStatement = statements.find(s => s.Sid === 'DenyInsecureTransport');
      expect(tlsStatement).toBeDefined();
      expect(tlsStatement.Effect).toBe('Deny');
      expect(tlsStatement.Principal).toBe('*');
      expect(tlsStatement.Action).toBe('s3:*');
      expect(tlsStatement.Condition).toBeDefined();
      expect(tlsStatement.Condition.Bool).toBeDefined();
      expect(tlsStatement.Condition.Bool['aws:SecureTransport']).toBe(false);
    });

    test('IAM policies should have KMS permissions for S3 encryption', () => {
      // Check BedrockKnowledgeBaseRolePolicy
      const kbPolicy = template.Resources.BedrockKnowledgeBaseRolePolicy;
      expect(kbPolicy).toBeDefined();
      
      const kbStatements = kbPolicy.Properties.PolicyDocument.Statement;
      const kmsStatement = kbStatements.find(s => s.Sid === 'KMSDecryptForS3');
      expect(kmsStatement).toBeDefined();
      expect(kmsStatement.Action).toContain('kms:Decrypt');
      expect(kmsStatement.Action).toContain('kms:GenerateDataKey');
      
      // Check BedrockAgentResourceRolePolicy
      const agentPolicy = template.Resources.BedrockAgentResourceRolePolicy;
      expect(agentPolicy).toBeDefined();
      
      const agentStatements = agentPolicy.Properties.PolicyDocument.Statement;
      const agentKmsStatement = agentStatements.find(s => s.Sid === 'KMSDecryptForS3');
      expect(agentKmsStatement).toBeDefined();
      expect(agentKmsStatement.Action).toContain('kms:Decrypt');
    });
  });
});
