// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for CloudFront Stack CloudFormation Template
 * 
 * Tests verify that the cloudfront.yaml template creates all required resources
 * with proper security controls as specified in the design document.
 * 
 * Requirements tested: 4.1, 4.2, 4.3, 6.3, 9.3, 9.4
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

describe('CloudFront Stack CloudFormation Template', () => {
  let template;

  beforeAll(() => {
    // Load the cloudfront.yaml template
    const templatePath = path.join(__dirname, '..', '..', 'cloudfront.yaml');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    template = yaml.load(templateContent, { schema: CFN_SCHEMA });
  });

  describe('Template Structure', () => {
    test('should have valid CloudFormation format version', () => {
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
    });

    test('should have a description', () => {
      expect(template.Description).toBeDefined();
      expect(template.Description).toContain('CloudFront');
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
    test('should accept CloudFrontLogsBucket parameter from Foundation stack', () => {
      const param = template.Parameters.CloudFrontLogsBucket;
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

    test('should accept UICodeS3BucketDomainName parameter from CICD stack', () => {
      const param = template.Parameters.UICodeS3BucketDomainName;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('CICD');
    });

    test('should accept UICodeS3BucketArn parameter from CICD stack', () => {
      const param = template.Parameters.UICodeS3BucketArn;
      expect(param).toBeDefined();
      expect(param.Type).toBe('String');
      expect(param.Description).toContain('CICD');
    });

    test('should not have any nested stack dependencies', () => {
      // Verify no AWS::CloudFormation::Stack resources exist
      const nestedStacks = Object.values(template.Resources).filter(
        r => r.Type === 'AWS::CloudFormation::Stack'
      );
      expect(nestedStacks.length).toBe(0);
    });
  });

  describe('CloudFront Response Headers Policy - Requirement 4.1', () => {
    test('should create response headers policy', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::CloudFront::ResponseHeadersPolicy');
    });

    test('should configure Strict-Transport-Security header', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      const hsts = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.StrictTransportSecurity;
      
      expect(hsts).toBeDefined();
      expect(hsts.AccessControlMaxAgeSec).toBe(31536000); // 1 year
      expect(hsts.IncludeSubdomains).toBe(true);
      expect(hsts.Override).toBe(true);
    });

    test('should configure Content-Type-Options header', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      const contentType = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentTypeOptions;
      
      expect(contentType).toBeDefined();
      expect(contentType.Override).toBe(true);
    });

    test('should configure Frame-Options header', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      const frameOptions = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.FrameOptions;
      
      expect(frameOptions).toBeDefined();
      expect(frameOptions.FrameOption).toBe('DENY');
      expect(frameOptions.Override).toBe(true);
    });

    test('should configure XSS-Protection header', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      const xssProtection = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.XSSProtection;
      
      expect(xssProtection).toBeDefined();
      expect(xssProtection.ModeBlock).toBe(true);
      expect(xssProtection.Protection).toBe(true);
      expect(xssProtection.Override).toBe(true);
    });

    test('should configure Referrer-Policy header', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      const referrerPolicy = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ReferrerPolicy;
      
      expect(referrerPolicy).toBeDefined();
      expect(referrerPolicy.ReferrerPolicy).toBe('strict-origin-when-cross-origin');
      expect(referrerPolicy.Override).toBe(true);
    });
  });

  describe('CloudFront Distribution - Requirement 4.1, 4.2, 4.3, 6.3', () => {
    test('should create CloudFront distribution', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      expect(distribution).toBeDefined();
      expect(distribution.Type).toBe('AWS::CloudFront::Distribution');
    });

    test('should set MinimumProtocolVersion to TLSv1.2_2021 - Requirement 4.1, 4.2', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const minProtocol = distribution.Properties.DistributionConfig.ViewerCertificate.MinimumProtocolVersion;
      
      expect(minProtocol).toBe('TLSv1.2_2021');
      expect(minProtocol).not.toBe('TLSv1');
    });

    test('should enable access logging - Requirement 4.3, 6.3', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const logging = distribution.Properties.DistributionConfig.Logging;
      
      expect(logging).toBeDefined();
      expect(logging.Bucket).toBeDefined();
      expect(logging.IncludeCookies).toBe(true);
      expect(logging.Prefix).toBeDefined();
    });

    test('should use CloudFrontLogsBucket parameter for logging', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const logging = distribution.Properties.DistributionConfig.Logging;
      
      // Check that the bucket reference includes CloudFrontLogsBucket parameter
      expect(logging.Bucket['Fn::Sub']).toContain('CloudFrontLogsBucket');
    });

    test('should attach response headers policy to distribution', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const cacheBehavior = distribution.Properties.DistributionConfig.DefaultCacheBehavior;
      
      expect(cacheBehavior.ResponseHeadersPolicyId).toBeDefined();
      expect(cacheBehavior.ResponseHeadersPolicyId.Ref).toBe('CloudFrontResponseHeadersPolicy');
    });

    test('should enable HTTP/2 and HTTP/3', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const httpVersion = distribution.Properties.DistributionConfig.HttpVersion;
      
      expect(httpVersion).toBe('http2and3');
    });

    test('should redirect HTTP to HTTPS', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const viewerProtocol = distribution.Properties.DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy;
      
      expect(viewerProtocol).toBe('redirect-to-https');
    });

    test('should enable compression', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const compress = distribution.Properties.DistributionConfig.DefaultCacheBehavior.Compress;
      
      expect(compress).toBe(true);
    });

    test('should use Origin Access Control', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const origin = distribution.Properties.DistributionConfig.Origins[0];
      
      expect(origin.OriginAccessControlId).toBeDefined();
      expect(origin.OriginAccessControlId['Fn::GetAtt'][0]).toBe('CloudFrontOriginAccessControl');
    });

    test('should reference UICodeS3BucketDomainName parameter', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const origin = distribution.Properties.DistributionConfig.Origins[0];
      
      expect(origin.DomainName.Ref).toBe('UICodeS3BucketDomainName');
    });
  });

  describe('CloudFront Origin Access Control', () => {
    test('should create Origin Access Control', () => {
      const oac = template.Resources.CloudFrontOriginAccessControl;
      expect(oac).toBeDefined();
      expect(oac.Type).toBe('AWS::CloudFront::OriginAccessControl');
    });

    test('should configure OAC for S3', () => {
      const oac = template.Resources.CloudFrontOriginAccessControl;
      const config = oac.Properties.OriginAccessControlConfig;
      
      expect(config.OriginAccessControlOriginType).toBe('s3');
      expect(config.SigningBehavior).toBe('always');
      expect(config.SigningProtocol).toBe('sigv4');
    });
  });

  describe('S3 Bucket Policy', () => {
    test('should create S3 bucket policy', () => {
      const policy = template.Resources.S3BucketPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe('AWS::S3::BucketPolicy');
    });

    test('should reference UICodeS3Bucket parameter', () => {
      const policy = template.Resources.S3BucketPolicy;
      expect(policy.Properties.Bucket.Ref).toBe('UICodeS3Bucket');
    });

    test('should allow CloudFront service principal to access S3', () => {
      const policy = template.Resources.S3BucketPolicy;
      const statement = policy.Properties.PolicyDocument.Statement[0];
      
      expect(statement.Effect).toBe('Allow');
      expect(statement.Principal.Service).toBe('cloudfront.amazonaws.com');
      expect(statement.Action).toBe('s3:GetObject');
    });

    test('should use AWS::Partition for regional compatibility', () => {
      const policy = template.Resources.S3BucketPolicy;
      const statement = policy.Properties.PolicyDocument.Statement[0];
      const sourceArn = statement.Condition.StringEquals['AWS:SourceArn'];
      
      expect(sourceArn['Fn::Sub']).toContain('${AWS::Partition}');
    });

    test('should restrict access to specific CloudFront distribution', () => {
      const policy = template.Resources.S3BucketPolicy;
      const statement = policy.Properties.PolicyDocument.Statement[0];
      
      expect(statement.Condition).toBeDefined();
      expect(statement.Condition.StringEquals).toBeDefined();
      expect(statement.Condition.StringEquals['AWS:SourceArn']).toBeDefined();
    });

    test('should reference UICodeS3BucketArn parameter in resource', () => {
      const policy = template.Resources.S3BucketPolicy;
      const statement = policy.Properties.PolicyDocument.Statement[0];
      const resource = statement.Resource;
      
      expect(resource['Fn::Sub']).toContain('UICodeS3BucketArn');
    });
  });

  describe('Stack Outputs', () => {
    test('should export CloudFront distribution ID', () => {
      const output = template.Outputs.CloudFrontDistributionId;
      expect(output).toBeDefined();
      expect(output.Description).toContain('Distribution ID');
      expect(output.Value.Ref).toBe('CloudFrontDistribution');
    });

    test('should export CloudFront domain name', () => {
      const output = template.Outputs.CloudFrontDomainName;
      expect(output).toBeDefined();
      expect(output.Description).toContain('Domain Name');
      expect(output.Value['Fn::GetAtt'][0]).toBe('CloudFrontDistribution');
      expect(output.Value['Fn::GetAtt'][1]).toBe('DomainName');
    });
  });

  describe('Security Controls', () => {
    test('should not use deprecated TLS versions', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const minProtocol = distribution.Properties.DistributionConfig.ViewerCertificate.MinimumProtocolVersion;
      
      // Ensure TLSv1 and TLSv1.1 are not used
      expect(minProtocol).not.toBe('TLSv1');
      expect(minProtocol).not.toBe('TLSv1.1_2016');
      expect(minProtocol).not.toBe('TLSv1_2016');
    });

    test('should enforce HTTPS for viewer connections', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const viewerProtocol = distribution.Properties.DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy;
      
      expect(viewerProtocol).toBe('redirect-to-https');
    });

    test('should have comprehensive security headers configured', () => {
      const policy = template.Resources.CloudFrontResponseHeadersPolicy;
      const securityHeaders = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
      
      // Verify all major security headers are present
      expect(securityHeaders.StrictTransportSecurity).toBeDefined();
      expect(securityHeaders.ContentTypeOptions).toBeDefined();
      expect(securityHeaders.FrameOptions).toBeDefined();
      expect(securityHeaders.XSSProtection).toBeDefined();
      expect(securityHeaders.ReferrerPolicy).toBeDefined();
    });

    test('should use Origin Access Control instead of OAI', () => {
      const oac = template.Resources.CloudFrontOriginAccessControl;
      expect(oac).toBeDefined();
      
      // Verify no Origin Access Identity is used (deprecated)
      const oai = Object.values(template.Resources).find(
        r => r.Type === 'AWS::CloudFront::CloudFrontOriginAccessIdentity'
      );
      expect(oai).toBeUndefined();
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
      expect(template.Parameters.CloudFrontLogsBucket).toBeDefined();
      expect(template.Parameters.UICodeS3Bucket).toBeDefined();
      expect(template.Parameters.UICodeS3BucketDomainName).toBeDefined();
      expect(template.Parameters.UICodeS3BucketArn).toBeDefined();
    });
  });

  describe('Integration with Other Stacks', () => {
    test('should accept Foundation stack outputs as parameters', () => {
      const foundationParams = ['CloudFrontLogsBucket'];
      
      foundationParams.forEach(param => {
        expect(template.Parameters[param]).toBeDefined();
        expect(template.Parameters[param].Description).toContain('Foundation');
      });
    });

    test('should accept CICD stack outputs as parameters', () => {
      const cicdParams = ['UICodeS3Bucket', 'UICodeS3BucketDomainName', 'UICodeS3BucketArn'];
      
      cicdParams.forEach(param => {
        expect(template.Parameters[param]).toBeDefined();
        expect(template.Parameters[param].Description).toContain('CICD');
      });
    });

    test('should use Foundation CloudFront logs bucket for access logging', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const logging = distribution.Properties.DistributionConfig.Logging;
      
      expect(logging.Bucket['Fn::Sub']).toContain('CloudFrontLogsBucket');
    });

    test('should use CICD UI code bucket as origin', () => {
      const distribution = template.Resources.CloudFrontDistribution;
      const origin = distribution.Properties.DistributionConfig.Origins[0];
      
      expect(origin.DomainName.Ref).toBe('UICodeS3BucketDomainName');
    });
  });
});
