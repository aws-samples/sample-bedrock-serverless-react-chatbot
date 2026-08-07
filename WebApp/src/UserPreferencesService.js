// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { config, DynamoConfig, vpceEndpoints } from './aws-config';

/**
 * Service for managing per-user preferences stored in DynamoDB.
 * Each user has a single record keyed by userID containing their preferences.
 */
export const UserPreferencesService = {
  /**
   * Get the user's preferences from DynamoDB.
   * @param {string} userId - The user's email/ID
   * @param {object} credentials - AWS credentials from Cognito Identity Pool
   * @returns {object|null} User preferences or null if none set
   */
  getUserPreferences: async (userId, credentials) => {
    if (!userId || !credentials) return null;

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    try {
      const response = await client.send(new GetItemCommand({
        TableName: DynamoConfig.preferencesTable,
        Key: marshall({ userID: userId })
      }));

      if (!response.Item) return null;

      const item = unmarshall(response.Item);
      if (config.debug) {
        console.log('User preferences loaded:', JSON.stringify(item, null, 2));
      }
      return item;
    } catch (error) {
      if (config.debug) {
        console.error('Error loading user preferences:', error);
      }
      return null;
    }
  },

  /**
   * Save the user's default model preference.
   * @param {string} userId - The user's email/ID
   * @param {string} modelId - The model ID to set as default
   * @param {string} modelName - Display name of the model
   * @param {string} modelProvider - Provider name (e.g., "Anthropic")
   * @param {object} credentials - AWS credentials from Cognito Identity Pool
   */
  saveDefaultModel: async (userId, modelId, modelName, modelProvider, credentials) => {
    if (!userId || !credentials) {
      throw new Error('userId and credentials are required');
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    const timestamp = Date.now();

    // Get existing preferences to merge with new model preference
    let existingPrefs = {};
    try {
      const existing = await UserPreferencesService.getUserPreferences(userId, credentials);
      if (existing) {
        existingPrefs = existing;
      }
    } catch {
      // If we can't read existing, we'll just overwrite
    }

    const item = {
      ...existingPrefs,
      userID: userId,
      defaultModelId: modelId,
      defaultModelName: modelName || '',
      defaultModelProvider: modelProvider || '',
      updatedAt: timestamp
    };

    try {
      await client.send(new PutItemCommand({
        TableName: DynamoConfig.preferencesTable,
        Item: marshall(item, { removeUndefinedValues: true })
      }));

      if (config.debug) {
        console.log('User preferences saved:', JSON.stringify(item, null, 2));
      }
      return item;
    } catch (error) {
      if (config.debug) {
        console.error('Error saving user preferences:', error);
      }
      throw error;
    }
  },

  /**
   * Clear the user's default model preference (revert to system default).
   * @param {string} userId - The user's email/ID
   * @param {object} credentials - AWS credentials from Cognito Identity Pool
   */
  clearDefaultModel: async (userId, credentials) => {
    if (!userId || !credentials) {
      throw new Error('userId and credentials are required');
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    // Get existing preferences and remove model fields
    let existingPrefs = {};
    try {
      const existing = await UserPreferencesService.getUserPreferences(userId, credentials);
      if (existing) {
        existingPrefs = existing;
      }
    } catch {
      // Nothing to clear if we can't read
      return;
    }

    const item = {
      ...existingPrefs,
      userID: userId,
      defaultModelId: '',
      defaultModelName: '',
      defaultModelProvider: '',
      updatedAt: Date.now()
    };

    try {
      await client.send(new PutItemCommand({
        TableName: DynamoConfig.preferencesTable,
        Item: marshall(item, { removeUndefinedValues: true })
      }));

      if (config.debug) {
        console.log('User model preference cleared');
      }
    } catch (error) {
      if (config.debug) {
        console.error('Error clearing user preferences:', error);
      }
      throw error;
    }
  }
};
