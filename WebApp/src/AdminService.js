// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { fetchAuthSession } from 'aws-amplify/auth';
import { getConfig, clearConfig } from './configService';

/**
 * Service for admin-only operations such as updating the system-wide default model.
 * Calls the Config API's PUT /config/defaultModel endpoint which validates
 * Administrator group membership server-side.
 */
export const AdminService = {
  /**
   * Update the system-wide default model (SSM Parameter Store).
   * Only users in the Cognito Administrator group can perform this action.
   *
   * @param {string} modelId - The Bedrock model ID to set as default
   * @param {string} modelName - Display name of the model
   * @param {string} modelProvider - Provider name (e.g., "Anthropic")
   * @returns {object} Response with message, modelId, modelName, modelProvider
   * @throws {Error} If the user is not an admin or the request fails
   */
  updateDefaultModel: async (modelId, modelName, modelProvider) => {
    const session = await fetchAuthSession();
    const jwtToken = session.tokens?.idToken?.toString();

    if (!jwtToken) {
      throw new Error('Not authenticated');
    }

    // Build the admin endpoint URL from the config API URL
    const cfg = getConfig();
    const configApiUrl = import.meta.env.VITE_CONFIG_API_URL;
    if (!configApiUrl) {
      throw new Error('Config API URL not configured');
    }

    // The config API URL is like: https://xxx.execute-api.region.amazonaws.com/v1/config
    // The admin endpoint is:       https://xxx.execute-api.region.amazonaws.com/v1/config/defaultModel
    const adminUrl = `${configApiUrl}/defaultModel`;

    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': jwtToken
      },
      body: JSON.stringify({
        modelId,
        modelName: modelName || '',
        modelProvider: modelProvider || ''
      })
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody.error || `Request failed with status ${response.status}`;

      if (response.status === 403) {
        throw new Error('Access denied. Administrator group membership required.');
      }
      throw new Error(errorMessage);
    }

    // Clear the cached config so the next fetch picks up the new default
    clearConfig();

    return await response.json();
  },

  /**
   * Check if the current user is an admin (based on config API response).
   * The isAdmin flag is set by the Config Lambda after checking Cognito group membership.
   * @returns {boolean}
   */
  isAdmin: () => {
    const cfg = getConfig();
    return cfg?.userContext?.isAdmin === true;
  }
};
