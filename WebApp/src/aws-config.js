// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { getConfig } from './configService';

const env = import.meta.env;

const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: env.VITE_AMAZON_COGNITO_USER_POOL_ID,
      userPoolClientId: env.VITE_AMAZON_COGNITO_USER_POOL_WEB_CLIENT_ID,
      identityPoolId: env.VITE_AMAZON_COGNITO_IDENTITY_POOL_ID,
      region: env.VITE_AWS_REGION,
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: "code",
      userAttributes: {
        email: {
          required: true,
        },
      },
      allowGuestAccess: true,
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
    },
  },
};

// Runtime config from sessionStorage (populated after auth via configService)
export const bedrockConfig = new Proxy({}, {
  get(_, prop) {
    const cfg = getConfig();
    return cfg?.bedrockConfig?.[prop] ?? '';
  }
});

export const DynamoConfig = new Proxy({}, {
  get(_, prop) {
    const cfg = getConfig();
    return cfg?.dynamoConfig?.[prop] ?? '';
  }
});

export const vpceEndpoints = new Proxy({}, {
  get(_, prop) {
    const cfg = getConfig();
    return cfg?.vpceEndpoints?.[prop] ?? '';
  }
});

/**
 * True when this deployment's knowledge base is an Amazon Bedrock Managed Knowledge
 * Base. Managed knowledge bases differ from customer-managed ones at query time:
 * they reject RetrieveAndGenerate/RetrieveAndGenerateStream entirely, and Retrieve
 * takes managedSearchConfiguration rather than vectorSearchConfiguration.
 *
 * Lives here so callers can branch without pulling in the Bedrock SDK.
 */
export const isManagedKnowledgeBase = () => bedrockConfig.vectorStore === 'managed';

export const config = {
  debug: false
}

export default awsConfig;
