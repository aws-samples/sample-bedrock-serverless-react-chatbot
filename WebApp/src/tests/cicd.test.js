// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const yaml = require('js-yaml');
const fs = require('fs');
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
  new yaml.Type('!If', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::If': data }),
  }),
  new yaml.Type('!Equals', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Equals': data }),
  }),
  new yaml.Type('!Not', {
    kind: 'sequence',
    construct: (data) => ({ 'Fn::Not': data }),
  }),
]);

describe('CICD Stack CloudFormation Template', () => {
  let template;

  beforeAll(() => {
    const templatePath = path.join(__dirname, '../../cicd.yaml');
    const fileContents = fs.readFileSync(templatePath, 'utf8');
    template = yaml.load(fileContents, { schema: CFN_SCHEMA });
  });

  describe('Parameters', () => {
    test('should have Foundation stack output parameters', () => {
      expect(template.Parameters).toHaveProperty('S3KMSKeyId');
      expect(template.Parameters).toHaveProperty('S3KMSKeyArn');
      expect(template.Parameters).toHaveProperty('S3AccessLogsBucket');
    });

    test('should have Bedrock stack output parameters', () => {
      expect(template.Parameters).toHaveProperty('AgentId');
      expect(template.Parameters).toHaveProperty('AgentAliasId');
      expect(template.Parameters).toHaveProperty('AgentName');
      expect(template.Parameters).toHaveProperty('AgentRoleArn');
      expect(template.Parameters).toHaveProperty('KnowledgeBaseId');
      expect(template.Parameters).toHaveProperty('DataSourceId');
      expect(template.Parameters).toHaveProperty('PersonaS3Bucket');
    });

    test('should have Cognito stack output parameters', () => {
      expect(template.Parameters).toHaveProperty('CognitoIdentityPoolId');
      expect(template.Parameters).toHaveProperty('CognitoUserPoolId');
      expect(template.Parameters).toHaveProperty('CognitoUserPoolClientId');
      expect(template.Parameters).toHaveProperty('UserConHistTable');
      expect(template.Parameters).toHaveProperty('UserPersonasTable');
    });

    test('should have user-provided parameters', () => {
      expect(template.Parameters).toHaveProperty('KnowledgeBaseS3Bucket');
      expect(template.Parameters).toHaveProperty('CodeS3BucketName');
      expect(template.Parameters).toHaveProperty('SourceObjectKey');
    });
  });

  describe('UICodeS3Bucket Security Configuration', () => {
    let bucket;

    beforeAll(() => {
      bucket = template.Resources.UICodeS3Bucket;
    });

    test('should enable KMS encryption', () => {
      expect(bucket.Properties.BucketEncryption).toBeDefined();
      const encryption = bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0];
      expect(encryption.ServerSideEncryptionByDefault.SSEAlgorithm).toBe('aws:kms');
      expect(encryption.ServerSideEncryptionByDefault.KMSMasterKeyID).toEqual({ Ref: 'S3KMSKeyId' });
      expect(encryption.BucketKeyEnabled).toBe(true);
    });

    test('should enable Block Public Access', () => {
      const publicAccessBlock = bucket.Properties.PublicAccessBlockConfiguration;
      expect(publicAccessBlock.BlockPublicAcls).toBe(true);
      expect(publicAccessBlock.BlockPublicPolicy).toBe(true);
      expect(publicAccessBlock.IgnorePublicAcls).toBe(true);
      expect(publicAccessBlock.RestrictPublicBuckets).toBe(true);
    });

    test('should enable versioning', () => {
      expect(bucket.Properties.VersioningConfiguration.Status).toBe('Enabled');
    });

    test('should enable access logging', () => {
      expect(bucket.Properties.LoggingConfiguration).toBeDefined();
      expect(bucket.Properties.LoggingConfiguration.DestinationBucketName).toEqual({ Ref: 'S3AccessLogsBucket' });
      expect(bucket.Properties.LoggingConfiguration.LogFilePrefix).toBe('ui-code-bucket/');
    });

    test('should have appropriate tags', () => {
      expect(bucket.Properties.Tags).toBeDefined();
      const nameTag = bucket.Properties.Tags.find(tag => tag.Key === 'Name');
      const purposeTag = bucket.Properties.Tags.find(tag => tag.Key === 'Purpose');
      expect(nameTag).toBeDefined();
      expect(purposeTag).toBeDefined();
      expect(purposeTag.Value).toBe('UI code storage');
    });
  });

  describe('UICodeS3BucketPolicy', () => {
    let bucketPolicy;

    beforeAll(() => {
      bucketPolicy = template.Resources.UICodeS3BucketPolicy;
    });

    test('should exist', () => {
      expect(bucketPolicy).toBeDefined();
      expect(bucketPolicy.Type).toBe('AWS::S3::BucketPolicy');
    });

    test('should deny insecure transport', () => {
      const statements = bucketPolicy.Properties.PolicyDocument.Statement;
      const denyInsecureTransport = statements.find(s => s.Sid === 'DenyInsecureTransport');
      
      expect(denyInsecureTransport).toBeDefined();
      expect(denyInsecureTransport.Effect).toBe('Deny');
      expect(denyInsecureTransport.Action).toBe('s3:*');
      expect(denyInsecureTransport.Condition.Bool['aws:SecureTransport']).toBe(false);
    });
  });

  describe('IAM Roles - No Inline Policies', () => {
    test('CodeBuildRole should use managed policies only', () => {
      const role = template.Resources.CodeBuildRole;
      expect(role.Properties.Policies).toBeUndefined();
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(role.Properties.ManagedPolicyArns).toContainEqual({ Ref: 'CodeBuildRolePolicy' });
    });

    test('CodePipelineRole should use managed policies only', () => {
      const role = template.Resources.CodePipelineRole;
      expect(role.Properties.Policies).toBeUndefined();
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(role.Properties.ManagedPolicyArns).toContainEqual({ Ref: 'CodePipelineRolePolicy' });
    });

    test('EventBridgeRole should use managed policies only', () => {
      const role = template.Resources.EventBridgeRole;
      expect(role.Properties.Policies).toBeUndefined();
      expect(role.Properties.ManagedPolicyArns).toBeDefined();
      expect(role.Properties.ManagedPolicyArns).toContainEqual({ Ref: 'EventBridgeRolePolicy' });
    });
  });

  describe('CodeBuildRolePolicy - Scoped Permissions', () => {
    let policy;

    beforeAll(() => {
      policy = template.Resources.CodeBuildRolePolicy;
    });

    test('should be a managed policy', () => {
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
    });

    test('should have specific S3 permissions (no wildcards)', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const s3Statement = statements.find(s => s.Sid === 'S3UICodeBucketAccess');
      
      expect(s3Statement).toBeDefined();
      expect(s3Statement.Resource).toBeDefined();
      expect(s3Statement.Resource).not.toContain('*');
      expect(s3Statement.Resource).toContainEqual({ 'Fn::GetAtt': ['UICodeS3Bucket', 'Arn'] });
    });

    test('should have KMS permissions with specific key ARN', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const kmsStatement = statements.find(s => s.Sid === 'KMSKeyAccess');
      
      expect(kmsStatement).toBeDefined();
      expect(kmsStatement.Resource).toContainEqual({ Ref: 'S3KMSKeyArn' });
    });

    test('should have scoped CloudWatch Logs permissions', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const createLogGroupStatement = statements.find(s => s.Sid === 'CloudWatchLogsCreateLogGroup');
      const writeLogsStatement = statements.find(s => s.Sid === 'CloudWatchLogsWriteLogs');
      
      expect(createLogGroupStatement).toBeDefined();
      expect(writeLogsStatement).toBeDefined();
      
      // Should not use wildcard for log group ARN
      expect(createLogGroupStatement.Resource).not.toContain('*');
      // Check that the resource contains the log group path
      const resourceStr = JSON.stringify(createLogGroupStatement.Resource[0]);
      expect(resourceStr).toContain('/aws/codebuild/');
    });
  });

  describe('CodePipelineRolePolicy - Scoped Permissions', () => {
    let policy;

    beforeAll(() => {
      policy = template.Resources.CodePipelineRolePolicy;
    });

    test('should be a managed policy', () => {
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
    });

    test('should have specific CodeBuild permissions', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const codeBuildStatement = statements.find(s => s.Sid === 'CodeBuildProjectAccess');
      
      expect(codeBuildStatement).toBeDefined();
      expect(codeBuildStatement.Resource).toContainEqual({ 'Fn::GetAtt': ['CodeBuildProject', 'Arn'] });
    });

    test('should have specific S3 permissions (no wildcards)', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const s3Statement = statements.find(s => s.Sid === 'S3ArtifactBucketAccess');
      
      expect(s3Statement).toBeDefined();
      expect(s3Statement.Resource).toBeDefined();
      
      // Check that it includes specific bucket ARNs
      expect(s3Statement.Resource).toContainEqual({ 'Fn::GetAtt': ['UICodeS3Bucket', 'Arn'] });
    });

    test('should have KMS permissions with specific key ARN', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const kmsStatement = statements.find(s => s.Sid === 'KMSKeyAccess');
      
      expect(kmsStatement).toBeDefined();
      expect(kmsStatement.Resource).toContainEqual({ Ref: 'S3KMSKeyArn' });
    });
  });

  describe('EventBridgeRolePolicy - Scoped Permissions', () => {
    let policy;

    beforeAll(() => {
      policy = template.Resources.EventBridgeRolePolicy;
    });

    test('should be a managed policy', () => {
      expect(policy.Type).toBe('AWS::IAM::ManagedPolicy');
    });

    test('should have specific CodePipeline permissions', () => {
      const statements = policy.Properties.PolicyDocument.Statement;
      const pipelineStatement = statements.find(s => s.Sid === 'CodePipelineStartExecution');
      
      expect(pipelineStatement).toBeDefined();
      expect(pipelineStatement.Action).toContain('codepipeline:StartPipelineExecution');
      
      // Should reference specific pipeline, not wildcard
      expect(pipelineStatement.Resource).toBeDefined();
      const resourceStr = JSON.stringify(pipelineStatement.Resource[0]);
      expect(resourceStr).toContain('codepipeline');
    });
  });

  describe('No Nested Stacks', () => {
    test('should not contain any nested stack resources', () => {
      const resources = template.Resources;
      const nestedStacks = Object.keys(resources).filter(key => 
        resources[key].Type === 'AWS::CloudFormation::Stack'
      );
      expect(nestedStacks).toHaveLength(0);
    });
  });

  describe('AWS Partition Usage', () => {
    test('should use AWS::Partition in ARN constructions', () => {
      const templateString = JSON.stringify(template);
      
      // Check that we're using ${AWS::Partition} in ARNs
      expect(templateString).toContain('${AWS::Partition}');
      
      // Should not have hardcoded 'aws' or 'aws-us-gov' in ARNs
      const arnPattern = /"arn:(aws|aws-us-gov):/g;
      const hardcodedArns = templateString.match(arnPattern);
      expect(hardcodedArns).toBeNull();
    });
  });

  describe('Outputs', () => {
    test('should export necessary outputs for dependent stacks', () => {
      expect(template.Outputs).toHaveProperty('UICodeS3Bucket');
      expect(template.Outputs).toHaveProperty('UICodeS3BucketDomainName');
      expect(template.Outputs).toHaveProperty('UICodeS3BucketArn');
      expect(template.Outputs).toHaveProperty('PipelineName');
    });
  });

  describe('CodeBuildProject Configuration', () => {
    let codeBuildProject;

    beforeAll(() => {
      codeBuildProject = template.Resources.CodeBuildProject;
    });

    test('should reference all required parameters in environment variables', () => {
      const envVars = codeBuildProject.Properties.Environment.EnvironmentVariables;
      const envVarNames = envVars.map(v => v.Name);

      // Foundation stack outputs
      expect(envVarNames).toContain('S3_BUCKET');
      
      // Cognito stack outputs
      expect(envVarNames).toContain('VITE_AMAZON_COGNITO_IDENTITY_POOL_ID');
      expect(envVarNames).toContain('VITE_AMAZON_COGNITO_USER_POOL_ID');
      expect(envVarNames).toContain('VITE_AMAZON_COGNITO_USER_POOL_WEB_CLIENT_ID');
      
      // Bedrock stack outputs
      expect(envVarNames).toContain('VITE_AMAZON_BEDROCK_AGENT_ID');
      expect(envVarNames).toContain('VITE_AMAZON_BEDROCK_AGENT_ALIAS_ID');
      expect(envVarNames).toContain('VITE_AMAZON_BEDROCK_KNOWLEDGE_BASE_ID');
      expect(envVarNames).toContain('VITE_AMAZON_BEDROCK_DATA_SOURCE_ID');
      expect(envVarNames).toContain('VITE_AMAZON_BEDROCK_PERSONA_S3_BUCKET');
      
      // DynamoDB tables
      expect(envVarNames).toContain('VITE_USERCONVERSATIONHISTORY_DYNAMO_TABLE');
      expect(envVarNames).toContain('VITE_USERPERSONAS_DYNAMO_TABLE');
    });
  });
});
