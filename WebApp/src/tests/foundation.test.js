// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for Foundation Stack CloudFormation Template
 * 
 * Tests verify that the foundation.yaml template creates all required resources
 * with proper security controls as specified in the design document.
 * 
 * Requirements tested: 2.3, 2.4, 2.5, 3.6, 4.4, 5.2
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

describe('Foundation Stack CloudFormation Template', () => {
  let template;

  beforeAll(() => {
    // Load the foundation.yaml template
    const templatePath = path.join(__dirname, '..', '..', 'foundation.yaml');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    template = yaml.load(templateContent, { schema: CFN_SCHEMA });
  });

  describe('Template Structure', () => {
    test('should have valid CloudFormation format version', () => {
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
    });

    test('should have a description', () => {
      expect(template.Description).toBeDefined();
      expect(template.Description).toContain('Foundation Stack');
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

  describe('KMS Key Resources - Requirement 2.3, 2.4, 2.5', () => {
    test('should create DynamoDB encryption key', () => {
      const key = template.Resources.DynamoDBEncryptionKey;
      expect(key).toBeDefined();
      expect(key.Type).toBe('AWS::KMS::Key');
    });

    test('should enable key rotation for DynamoDB key', () => {
      const key = template.Resources.DynamoDBEncryptionKey;
      expect(key.Properties.EnableKeyRotation).toBe(true);
    });

    test('should have proper key policy for DynamoDB key', () => {
      const key = template.Resources.DynamoDBEncryptionKey;
      const policy = key.Properties.KeyPolicy;
      
      expect(policy.Version).toBe('2012-10-17');
      expect(policy.Statement).toBeDefined();
      expect(Array.isArray(policy.Statement)).toBe(true);
      
      // Check for root account permissions
      const rootStatement = policy.Statement.find(s => s.Sid === 'Enable IAM User Permissions');
      expect(rootStatement).toBeDefined();
      expect(rootStatement.Effect).toBe('Allow');
      
      // Check for DynamoDB service permissions
      const serviceStatement = policy.Statement.find(s => s.Sid === 'Allow DynamoDB Service to Use Key');
      expect(serviceStatement).toBeDefined();
      expect(serviceStatement.Principal.Service).toBe('dynamodb.amazonaws.com');
    });

    test('should create DynamoDB key alias', () => {
      const alias = template.Resources.DynamoDBEncryptionKeyAlias;
      expect(alias).toBeDefined();
      expect(alias.Type).toBe('AWS::KMS::Alias');
      expect(alias.Properties.TargetKeyId.Ref).toBe('DynamoDBEncryptionKey');
    });

    test('should create S3 encryption key', () => {
      const key = template.Resources.S3EncryptionKey;
      expect(key).toBeDefined();
      expect(key.Type).toBe('AWS::KMS::Key');
    });

    test('should enable key rotation for S3 key', () => {
      const key = template.Resources.S3EncryptionKey;
      expect(key.Properties.EnableKeyRotation).toBe(true);
    });

    test('should have proper key policy for S3 key', () => {
      const key = template.Resources.S3EncryptionKey;
      const policy = key.Properties.KeyPolicy;
      
      expect(policy.Version).toBe('2012-10-17');
      expect(policy.Statement).toBeDefined();
      
      // Check for root account permissions
      const rootStatement = policy.Statement.find(s => s.Sid === 'Enable IAM User Permissions');
      expect(rootStatement).toBeDefined();
      
      // Check for S3 service permissions
      const serviceStatement = policy.Statement.find(s => s.Sid === 'Allow S3 Service to Use Key');
      expect(serviceStatement).toBeDefined();
      expect(serviceStatement.Principal.Service).toBe('s3.amazonaws.com');
    });

    test('should create S3 key alias', () => {
      const alias = template.Resources.S3EncryptionKeyAlias;
      expect(alias).toBeDefined();
      expect(alias.Type).toBe('AWS::KMS::Alias');
      expect(alias.Properties.TargetKeyId.Ref).toBe('S3EncryptionKey');
    });
  });

  describe('S3 Logging Buckets - Requirement 3.6, 4.4', () => {
    test('should create S3 access logs bucket', () => {
      const bucket = template.Resources.S3AccessLogsBucket;
      expect(bucket).toBeDefined();
      expect(bucket.Type).toBe('AWS::S3::Bucket');
    });

    test('should enable encryption on S3 access logs bucket', () => {
      const bucket = template.Resources.S3AccessLogsBucket;
      const encryption = bucket.Properties.BucketEncryption;
      
      expect(encryption).toBeDefined();
      expect(encryption.ServerSideEncryptionConfiguration).toBeDefined();
      expect(encryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe('AES256');
    });

    test('should enable Block Public Access on S3 access logs bucket', () => {
      const bucket = template.Resources.S3AccessLogsBucket;
      const publicAccess = bucket.Properties.PublicAccessBlockConfiguration;
      
      expect(publicAccess.BlockPublicAcls).toBe(true);
      expect(publicAccess.BlockPublicPolicy).toBe(true);
      expect(publicAccess.IgnorePublicAcls).toBe(true);
      expect(publicAccess.RestrictPublicBuckets).toBe(true);
    });

    test('should enable versioning on S3 access logs bucket', () => {
      const bucket = template.Resources.S3AccessLogsBucket;
      expect(bucket.Properties.VersioningConfiguration.Status).toBe('Enabled');
    });

    test('should have lifecycle policy on S3 access logs bucket', () => {
      const bucket = template.Resources.S3AccessLogsBucket;
      const lifecycle = bucket.Properties.LifecycleConfiguration;
      
      expect(lifecycle).toBeDefined();
      expect(lifecycle.Rules).toBeDefined();
      expect(Array.isArray(lifecycle.Rules)).toBe(true);
      
      const deleteRule = lifecycle.Rules.find(r => r.Id === 'DeleteOldLogs');
      expect(deleteRule).toBeDefined();
      expect(deleteRule.Status).toBe('Enabled');
      expect(deleteRule.ExpirationInDays).toBe(90);
    });

    test('should have bucket policy with TLS enforcement on S3 access logs bucket', () => {
      const policy = template.Resources.S3AccessLogsBucketPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::S3::BucketPolicy');
      
      const policyDoc = policy.Properties.PolicyDocument;
      const denyStatement = policyDoc.Statement.find(s => s.Sid === 'DenyInsecureTransport');
      
      expect(denyStatement).toBeDefined();
      expect(denyStatement.Effect).toBe('Deny');
      expect(denyStatement.Condition.Bool['aws:SecureTransport']).toBe(false);
    });

    test('should create CloudFront logs bucket', () => {
      const bucket = template.Resources.CloudFrontLogsBucket;
      expect(bucket).toBeDefined();
      expect(bucket.Type).toBe('AWS::S3::Bucket');
    });

    test('should enable encryption on CloudFront logs bucket', () => {
      const bucket = template.Resources.CloudFrontLogsBucket;
      const encryption = bucket.Properties.BucketEncryption;
      
      expect(encryption).toBeDefined();
      expect(encryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe('AES256');
    });

    test('should enable Block Public Access on CloudFront logs bucket', () => {
      const bucket = template.Resources.CloudFrontLogsBucket;
      const publicAccess = bucket.Properties.PublicAccessBlockConfiguration;
      
      expect(publicAccess.BlockPublicAcls).toBe(true);
      expect(publicAccess.BlockPublicPolicy).toBe(true);
      expect(publicAccess.IgnorePublicAcls).toBe(true);
      expect(publicAccess.RestrictPublicBuckets).toBe(true);
    });

    test('should enable versioning on CloudFront logs bucket', () => {
      const bucket = template.Resources.CloudFrontLogsBucket;
      expect(bucket.Properties.VersioningConfiguration.Status).toBe('Enabled');
    });

    test('should have lifecycle policy on CloudFront logs bucket', () => {
      const bucket = template.Resources.CloudFrontLogsBucket;
      const lifecycle = bucket.Properties.LifecycleConfiguration;
      
      expect(lifecycle).toBeDefined();
      const deleteRule = lifecycle.Rules.find(r => r.Id === 'DeleteOldLogs');
      expect(deleteRule).toBeDefined();
      expect(deleteRule.ExpirationInDays).toBe(90);
    });

    test('should have bucket policy with TLS enforcement on CloudFront logs bucket', () => {
      const policy = template.Resources.CloudFrontLogsBucketPolicy;
      expect(policy).toBeDefined();
      
      const policyDoc = policy.Properties.PolicyDocument;
      const denyStatement = policyDoc.Statement.find(s => s.Sid === 'DenyInsecureTransport');
      
      expect(denyStatement).toBeDefined();
      expect(denyStatement.Effect).toBe('Deny');
    });
  });

  describe('Lambda Dead Letter Queue - Requirement 5.2', () => {
    test('should create Lambda DLQ', () => {
      const queue = template.Resources.LambdaDLQ;
      expect(queue).toBeDefined();
      expect(queue.Type).toBe('AWS::SQS::Queue');
    });

    test('should configure message retention on DLQ', () => {
      const queue = template.Resources.LambdaDLQ;
      expect(queue.Properties.MessageRetentionPeriod).toBe(1209600); // 14 days
    });

    test('should enable encryption on DLQ', () => {
      const queue = template.Resources.LambdaDLQ;
      expect(queue.Properties.KmsMasterKeyId).toBe('alias/aws/sqs');
    });

    test('should have queue policy allowing Lambda to send messages', () => {
      const policy = template.Resources.LambdaDLQPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::SQS::QueuePolicy');
      
      const policyDoc = policy.Properties.PolicyDocument;
      const allowStatement = policyDoc.Statement.find(s => s.Sid === 'AllowLambdaToSendMessages');
      
      expect(allowStatement).toBeDefined();
      expect(allowStatement.Effect).toBe('Allow');
      expect(allowStatement.Principal.Service).toBe('lambda.amazonaws.com');
      expect(allowStatement.Action).toContain('sqs:SendMessage');
    });
  });

  describe('Stack Outputs', () => {
    test('should export DynamoDB KMS key ID', () => {
      const output = template.Outputs.DynamoDBKMSKeyId;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('DynamoDBEncryptionKey');
      expect(output.Export).toBeDefined();
    });

    test('should export DynamoDB KMS key ARN', () => {
      const output = template.Outputs.DynamoDBKMSKeyArn;
      expect(output).toBeDefined();
      expect(output.Value['Fn::GetAtt'][0]).toBe('DynamoDBEncryptionKey');
      expect(output.Value['Fn::GetAtt'][1]).toBe('Arn');
    });

    test('should export S3 KMS key ID', () => {
      const output = template.Outputs.S3KMSKeyId;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('S3EncryptionKey');
    });

    test('should export S3 KMS key ARN', () => {
      const output = template.Outputs.S3KMSKeyArn;
      expect(output).toBeDefined();
      expect(output.Value['Fn::GetAtt'][0]).toBe('S3EncryptionKey');
    });

    test('should export S3 access logs bucket name', () => {
      const output = template.Outputs.S3AccessLogsBucket;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('S3AccessLogsBucket');
    });

    test('should export S3 access logs bucket ARN', () => {
      const output = template.Outputs.S3AccessLogsBucketArn;
      expect(output).toBeDefined();
      expect(output.Value['Fn::GetAtt'][0]).toBe('S3AccessLogsBucket');
    });

    test('should export CloudFront logs bucket name', () => {
      const output = template.Outputs.CloudFrontLogsBucket;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('CloudFrontLogsBucket');
    });

    test('should export CloudFront logs bucket ARN', () => {
      const output = template.Outputs.CloudFrontLogsBucketArn;
      expect(output).toBeDefined();
      expect(output.Value['Fn::GetAtt'][0]).toBe('CloudFrontLogsBucket');
    });

    test('should export Lambda DLQ ARN', () => {
      const output = template.Outputs.LambdaDLQArn;
      expect(output).toBeDefined();
      expect(output.Value['Fn::GetAtt'][0]).toBe('LambdaDLQ');
      expect(output.Value['Fn::GetAtt'][1]).toBe('Arn');
    });

    test('should export Lambda DLQ URL', () => {
      const output = template.Outputs.LambdaDLQUrl;
      expect(output).toBeDefined();
      expect(output.Value.Ref).toBe('LambdaDLQ');
    });
  });

  describe('Security Controls', () => {
    test('all KMS keys should have key rotation enabled', () => {
      const dynamoKey = template.Resources.DynamoDBEncryptionKey;
      const s3Key = template.Resources.S3EncryptionKey;
      
      expect(dynamoKey.Properties.EnableKeyRotation).toBe(true);
      expect(s3Key.Properties.EnableKeyRotation).toBe(true);
    });

    test('all S3 buckets should have Block Public Access enabled', () => {
      const s3Buckets = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::S3::Bucket'
      );
      
      expect(s3Buckets.length).toBeGreaterThan(0);
      
      s3Buckets.forEach(bucket => {
        const publicAccess = bucket.Properties.PublicAccessBlockConfiguration;
        expect(publicAccess.BlockPublicAcls).toBe(true);
        expect(publicAccess.BlockPublicPolicy).toBe(true);
        expect(publicAccess.IgnorePublicAcls).toBe(true);
        expect(publicAccess.RestrictPublicBuckets).toBe(true);
      });
    });

    test('all S3 buckets should have versioning enabled', () => {
      const s3Buckets = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::S3::Bucket'
      );
      
      s3Buckets.forEach(bucket => {
        expect(bucket.Properties.VersioningConfiguration.Status).toBe('Enabled');
      });
    });

    test('all S3 buckets should have encryption enabled', () => {
      const s3Buckets = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::S3::Bucket'
      );
      
      s3Buckets.forEach(bucket => {
        expect(bucket.Properties.BucketEncryption).toBeDefined();
        expect(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration).toBeDefined();
      });
    });

    test('all S3 bucket policies should enforce TLS', () => {
      const bucketPolicies = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::S3::BucketPolicy'
      );
      
      expect(bucketPolicies.length).toBeGreaterThan(0);
      
      bucketPolicies.forEach(policy => {
        const policyDoc = policy.Properties.PolicyDocument;
        const denyStatement = policyDoc.Statement.find(
          s => s.Sid === 'DenyInsecureTransport'
        );
        
        expect(denyStatement).toBeDefined();
        expect(denyStatement.Effect).toBe('Deny');
        expect(denyStatement.Condition.Bool['aws:SecureTransport']).toBe(false);
      });
    });
  });
});
