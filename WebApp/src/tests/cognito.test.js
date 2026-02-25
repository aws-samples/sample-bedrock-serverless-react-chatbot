// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for Cognito Stack CloudFormation Template
 * 
 * Tests verify that the cognito.yaml template creates all required resources
 * with proper security controls as specified in the design document.
 * 
 * Requirements tested: 2.1, 6.4
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
]);

describe('Cognito Stack CloudFormation Template', () => {
  let template;

  beforeAll(() => {
    // Load the cognito.yaml template
    const templatePath = path.join(__dirname, '..', '..', 'cognito.yaml');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    template = yaml.load(templateContent, { schema: CFN_SCHEMA });
  });

  describe('Template Structure', () => {
    test('should have valid CloudFormation format version', () => {
      // YAML parser may parse the date as a Date object, so convert to string
      const version = template.AWSTemplateFormatVersion instanceof Date 
        ? template.AWSTemplateFormatVersion.toISOString().split('T')[0]
        : template.AWSTemplateFormatVersion;
      expect(version).toBe('2010-09-09');
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

  describe('Parameters - Foundation Stack Outputs', () => {
    test('should have DynamoDBKMSKeyId parameter', () => {
      const param = template.Parameters.DynamoDBKMSKeyId;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('DynamoDB encryption');
    });

    test('should have DynamoDBKMSKeyArn parameter', () => {
      const param = template.Parameters.DynamoDBKMSKeyArn;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('DynamoDB encryption');
    });

    test('should have S3KMSKeyArn parameter', () => {
      const param = template.Parameters.S3KMSKeyArn;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('S3 encryption');
    });
  });

  describe('DynamoDB Tables - Requirement 2.1, 6.4', () => {
    test('should create UserConversationHistory table', () => {
      const table = template.Resources.UserConversationHistory;
      expect(table).toBeDefined();
      expect(table.Type).toBe('AWS::DynamoDB::Table');
    });

    test('should enable KMS encryption on UserConversationHistory table', () => {
      const table = template.Resources.UserConversationHistory;
      const sseSpec = table.Properties.SSESpecification;
      
      expect(sseSpec).toBeDefined();
      expect(sseSpec.SSEEnabled).toBe(true);
      expect(sseSpec.SSEType).toBe('KMS');
      expect(sseSpec.KMSMasterKeyId.Ref).toBe('DynamoDBKMSKeyId');
    });

    test('should enable point-in-time recovery on UserConversationHistory table', () => {
      const table = template.Resources.UserConversationHistory;
      const pitr = table.Properties.PointInTimeRecoverySpecification;
      
      expect(pitr).toBeDefined();
      expect(pitr.PointInTimeRecoveryEnabled).toBe(true);
    });

    test('should enable TTL on UserConversationHistory table', () => {
      const table = template.Resources.UserConversationHistory;
      const ttl = table.Properties.TimeToLiveSpecification;
      
      expect(ttl).toBeDefined();
      expect(ttl.Enabled).toBe(true);
      expect(ttl.AttributeName).toBe('ttl');
    });

    test('should create UserPersonas table', () => {
      const table = template.Resources.UserPersonas;
      expect(table).toBeDefined();
      expect(table.Type).toBe('AWS::DynamoDB::Table');
    });

    test('should enable KMS encryption on UserPersonas table', () => {
      const table = template.Resources.UserPersonas;
      const sseSpec = table.Properties.SSESpecification;
      
      expect(sseSpec).toBeDefined();
      expect(sseSpec.SSEEnabled).toBe(true);
      expect(sseSpec.SSEType).toBe('KMS');
      expect(sseSpec.KMSMasterKeyId.Ref).toBe('DynamoDBKMSKeyId');
    });

    test('should enable point-in-time recovery on UserPersonas table', () => {
      const table = template.Resources.UserPersonas;
      const pitr = table.Properties.PointInTimeRecoverySpecification;
      
      expect(pitr).toBeDefined();
      expect(pitr.PointInTimeRecoveryEnabled).toBe(true);
    });

    test('should enable TTL on UserPersonas table', () => {
      const table = template.Resources.UserPersonas;
      const ttl = table.Properties.TimeToLiveSpecification;
      
      expect(ttl).toBeDefined();
      expect(ttl.Enabled).toBe(true);
      expect(ttl.AttributeName).toBe('ttl');
    });

    test('should use on-demand billing mode for both tables', () => {
      const convHistory = template.Resources.UserConversationHistory;
      const personas = template.Resources.UserPersonas;
      
      expect(convHistory.Properties.BillingMode).toBe('PAY_PER_REQUEST');
      expect(personas.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    });
  });

  describe('IAM Role - KMS Permissions', () => {
    test('should create UserAuthdRole', () => {
      const role = template.Resources.UserAuthdRole;
      expect(role).toBeDefined();
      expect(role.Type).toBe('AWS::IAM::Role');
    });

    test('should use managed policy instead of inline policy - Requirement 1.1, 1.7', () => {
      const role = template.Resources.UserAuthdRole;
      
      // Verify no inline policies
      expect(role.Properties.Policies).toBeUndefined();
      
      // Verify managed policy is attached
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(Array.isArray(role.Properties.ManagedPolicyArns)).toBe(true);
      expect(role.Properties.ManagedPolicyArns.length).toBeGreaterThan(0);
      
      // Verify reference to CognitoAuthenticatedUserPolicy
      const managedPolicyRef = role.Properties.ManagedPolicyArns.find(arn => 
        arn.Ref === 'CognitoAuthenticatedUserPolicy'
      );
      expect(managedPolicyRef).toBeDefined();
    });

    test('should create CognitoAuthenticatedUserPolicy managed policy', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
      expect(policy.Properties.Description).toBeDefined();
      expect(policy.Properties.PolicyDocument).toBeDefined();
    });

    test('should grant KMS permissions in managed policy', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const kmsStatement = statements.find(s => 
        s.Sid === 'KMSKeyAccess' || (s.Action && s.Action.includes('kms:Decrypt'))
      );
      
      expect(kmsStatement).toBeDefined();
      expect(kmsStatement.Effect).toBe('Allow');
      expect(kmsStatement.Action).toContain('kms:Decrypt');
      expect(kmsStatement.Action).toContain('kms:DescribeKey');
      expect(kmsStatement.Action).toContain('kms:GenerateDataKey');
      
      // Verify it references both KMS keys
      expect(kmsStatement.Resource).toBeDefined();
      expect(Array.isArray(kmsStatement.Resource)).toBe(true);
      expect(kmsStatement.Resource.length).toBeGreaterThanOrEqual(2);
      
      // Check for DynamoDB KMS key reference
      const dynamoKmsRef = kmsStatement.Resource.find(r => r.Ref === 'DynamoDBKMSKeyArn');
      expect(dynamoKmsRef).toBeDefined();
      
      // Check for S3 KMS key reference
      const s3KmsRef = kmsStatement.Resource.find(r => r.Ref === 'S3KMSKeyArn');
      expect(s3KmsRef).toBeDefined();
    });
  });

  describe('DynamoDB Access Policy', () => {
    test('should create DynamoDBAccessPolicy', () => {
      const policy = template.Resources.DynamoDBAccessPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::IAM::Policy');
    });

    test('should grant DynamoDB permissions to UserAuthdRole', () => {
      const policy = template.Resources.DynamoDBAccessPolicy;
      const policyDoc = policy.Properties.PolicyDocument;
      
      expect(policyDoc.Statement).toBeDefined();
      expect(Array.isArray(policyDoc.Statement)).toBe(true);
      
      const statement = policyDoc.Statement[0];
      expect(statement.Effect).toBe('Allow');
      expect(statement.Action).toContain('dynamodb:PutItem');
      expect(statement.Action).toContain('dynamodb:GetItem');
      expect(statement.Action).toContain('dynamodb:Query');
      expect(statement.Action).toContain('dynamodb:UpdateItem');
      expect(statement.Action).toContain('dynamodb:DeleteItem');
    });

    test('should reference both DynamoDB tables', () => {
      const policy = template.Resources.DynamoDBAccessPolicy;
      const statement = policy.Properties.PolicyDocument.Statement[0];
      
      expect(statement.Resource).toBeDefined();
      expect(Array.isArray(statement.Resource)).toBe(true);
      
      // Check for UserConversationHistory table reference
      const convHistoryRef = statement.Resource.find(r => 
        r['Fn::GetAtt'] && r['Fn::GetAtt'][0] === 'UserConversationHistory'
      );
      expect(convHistoryRef).toBeDefined();
      
      // Check for UserPersonas table reference
      const personasRef = statement.Resource.find(r => 
        r['Fn::GetAtt'] && r['Fn::GetAtt'][0] === 'UserPersonas'
      );
      expect(personasRef).toBeDefined();
    });
  });

  describe('Cognito Resources', () => {
    test('should create Cognito User Pool', () => {
      const pool = template.Resources.CognitoUserPool;
      expect(pool).toBeDefined();
      expect(pool.Type).toBe('AWS::Cognito::UserPool');
    });

    test('should create Cognito Identity Pool', () => {
      const pool = template.Resources.CognitoIdentityPool;
      expect(pool).toBeDefined();
      expect(pool.Type).toBe('AWS::Cognito::IdentityPool');
    });

    test('should create Cognito User Pool Client', () => {
      const client = template.Resources.CognitoUserPoolClient;
      expect(client).toBeDefined();
      expect(client.Type).toBe('AWS::Cognito::UserPoolClient');
    });

    test('should create Identity Pool Role Mapping', () => {
      const mapping = template.Resources.IdPoolRoleMapping;
      expect(mapping).toBeDefined();
      expect(mapping.Type).toBe('AWS::Cognito::IdentityPoolRoleAttachment');
    });
  });

  describe('Stack Outputs', () => {
    test('should export Cognito User Pool ID', () => {
      const output = template.Outputs.CognitoUserPoolId;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('CognitoUserPool');
    });

    test('should export Cognito User Pool Client ID', () => {
      const output = template.Outputs.CognitoUserPoolClientId;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('CognitoUserPoolClient');
    });

    test('should export Cognito Identity Pool ID', () => {
      const output = template.Outputs.CognitoIdentityPoolId;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('CognitoIdentityPool');
    });

    test('should export UserConversationHistory table name', () => {
      const output = template.Outputs.UserConHistTable;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('UserConversationHistory');
    });

    test('should export UserPersonas table name', () => {
      const output = template.Outputs.UserPersonasTable;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('UserPersonas');
    });
  });

  describe('Security Controls', () => {
    test('all DynamoDB tables should have KMS encryption enabled', () => {
      const tables = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::DynamoDB::Table'
      );
      
      expect(tables.length).toBeGreaterThan(0);
      
      tables.forEach(table => {
        const sseSpec = table.Properties.SSESpecification;
        expect(sseSpec).toBeDefined();
        expect(sseSpec.SSEEnabled).toBe(true);
        expect(sseSpec.SSEType).toBe('KMS');
        expect(sseSpec.KMSMasterKeyId).toBeDefined();
      });
    });

    test('all DynamoDB tables should have point-in-time recovery enabled', () => {
      const tables = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::DynamoDB::Table'
      );
      
      tables.forEach(table => {
        const pitr = table.Properties.PointInTimeRecoverySpecification;
        expect(pitr).toBeDefined();
        expect(pitr.PointInTimeRecoveryEnabled).toBe(true);
      });
    });

    test('UserAuthdRole should have KMS permissions for encrypted resources', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      expect(policy).toBeDefined();
      
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const kmsStatement = statements.find(s => 
        s.Sid === 'KMSKeyAccess' || (s.Action && s.Action.includes('kms:Decrypt'))
      );
      
      expect(kmsStatement).toBeDefined();
      expect(kmsStatement.Action).toContain('kms:GenerateDataKey');
    });
  });

  describe('IAM Permission Scoping - Requirements 1.2, 1.6, 1.8', () => {
    test('S3 permissions should be scoped to specific bucket ARNs', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const s3Statement = statements.find(s => s.Sid === 'S3BucketAccess');
      expect(s3Statement).toBeDefined();
      expect(s3Statement.Resource).toBeDefined();
      expect(Array.isArray(s3Statement.Resource)).toBe(true);
      
      // Verify no wildcard-only resources
      s3Statement.Resource.forEach(resource => {
        expect(resource).not.toBe('*');
        // Should reference specific buckets
        expect(resource['Fn::Sub']).toBeDefined();
        expect(resource['Fn::Sub']).toMatch(/KnowledgeBaseS3Bucket|PersonaS3Bucket/);
      });
    });

    test('Bedrock InvokeModel permissions should be scoped to foundation models', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const modelStatement = statements.find(s => s.Sid === 'BedrockModelInvoke');
      expect(modelStatement).toBeDefined();
      expect(modelStatement.Resource).toBeDefined();
      expect(Array.isArray(modelStatement.Resource)).toBe(true);
      
      // Verify resources are scoped to foundation-model/* not just *
      modelStatement.Resource.forEach(resource => {
        expect(resource).not.toBe('*');
        expect(resource['Fn::Sub']).toBeDefined();
        expect(resource['Fn::Sub']).toContain('foundation-model/');
      });
    });

    test('Bedrock agent permissions should be scoped to specific agent ID', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const agentStatement = statements.find(s => s.Sid === 'BedrockAgentAliasAccess');
      expect(agentStatement).toBeDefined();
      expect(agentStatement.Resource).toBeDefined();
      
      // Verify resources reference specific agent ID
      agentStatement.Resource.forEach(resource => {
        expect(resource).not.toBe('*');
        expect(resource['Fn::Sub']).toBeDefined();
        expect(resource['Fn::Sub']).toContain('${BedrockAgentId}');
      });
    });

    test('Bedrock knowledge base permissions should be scoped to specific KB ID', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const kbStatement = statements.find(s => s.Sid === 'BedrockKnowledgeBaseOperations');
      expect(kbStatement).toBeDefined();
      expect(kbStatement.Resource).toBeDefined();
      
      // Verify resources reference specific knowledge base ID
      kbStatement.Resource.forEach(resource => {
        expect(resource).not.toBe('*');
        expect(resource['Fn::Sub']).toBeDefined();
        expect(resource['Fn::Sub']).toContain('${KnowledgeBaseId}');
      });
    });

    test('DynamoDB permissions should be scoped to specific table ARNs', () => {
      const policy = template.Resources.DynamoDBAccessPolicy;
      const statement = policy.Properties.PolicyDocument.Statement[0];
      
      expect(statement.Resource).toBeDefined();
      expect(Array.isArray(statement.Resource)).toBe(true);
      
      // Verify no wildcard-only resources
      statement.Resource.forEach(resource => {
        expect(resource).not.toBe('*');
        // Should reference specific tables via GetAtt or Sub
        expect(resource['Fn::GetAtt'] || resource['Fn::Sub']).toBeDefined();
      });
    });

    test('Bedrock List operations should use wildcard (no resource-level permissions)', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const listStatement = statements.find(s => s.Sid === 'BedrockListOperations');
      expect(listStatement).toBeDefined();
      
      // List operations don't support resource-level permissions, so wildcard is acceptable
      expect(listStatement.Resource).toEqual(['*']);
      expect(listStatement.Action).toContain('bedrock:ListFoundationModels');
      expect(listStatement.Action).toContain('bedrock:ListInferenceProfiles');
    });

    test('Bedrock inference profile permissions should be scoped to account', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      const profileStatement = statements.find(s => s.Sid === 'BedrockInferenceProfileAccess');
      expect(profileStatement).toBeDefined();
      expect(profileStatement.Resource).toBeDefined();
      
      // Verify resources are scoped to inference-profile/* not just *
      profileStatement.Resource.forEach(resource => {
        expect(resource).not.toBe('*');
        expect(resource['Fn::Sub']).toBeDefined();
        expect(resource['Fn::Sub']).toContain('inference-profile/');
      });
    });

    test('no IAM policy statements should use unscoped wildcard resources except List operations', () => {
      const policy = template.Resources.CognitoAuthenticatedUserPolicy;
      const statements = policy.Properties.PolicyDocument.Statement;
      
      statements.forEach(statement => {
        // Skip List operations which legitimately need wildcards
        if (statement.Sid === 'BedrockListOperations') {
          return;
        }
        
        // All other statements should not have bare wildcard resources
        if (Array.isArray(statement.Resource)) {
          statement.Resource.forEach(resource => {
            if (resource === '*') {
              fail(`Statement ${statement.Sid} uses unscoped wildcard resource`);
            }
          });
        } else if (statement.Resource === '*') {
          fail(`Statement ${statement.Sid} uses unscoped wildcard resource`);
        }
      });
    });
  });
});
