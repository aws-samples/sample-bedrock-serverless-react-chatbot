// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from 'uuid';
import { config, DynamoConfig, vpceEndpoints } from './aws-config';
import pricingData from './bedrock_pricing.json';

// Helper function to calculate cost based on tokens and model ID
const calculateCost = (modelId, inputTokens, outputTokens) => {
  // Extract the model family and model name from the model ID
  // Example: us.anthropic.claude-3-7-sonnet-20250219-v1:0 -> claude-3-sonnet
  let modelFamily = null;
  let modelName = null;
  
  if (modelId) {
    if (modelId.includes('anthropic')) {
      modelFamily = 'anthropic';
      
      // Extract model name (claude-3-sonnet, claude-3-opus, claude-3-haiku)
      if (modelId.includes('sonnet')) {
        modelName = 'claude-3-sonnet';
      } else if (modelId.includes('opus')) {
        modelName = 'claude-3-opus';
      } else if (modelId.includes('haiku')) {
        modelName = 'claude-3-haiku';
      }
    }
    // Add more model families as needed
  }
  
  // If we couldn't determine the model family or name, return null
  if (!modelFamily || !modelName) {
    return null;
  }
  
  // Get pricing information
  const pricing = pricingData.models[modelFamily]?.[modelName];
  if (!pricing) {
    return null;
  }
  
  // Calculate costs - per 1000 tokens
  const inputCost = (inputTokens / 1000) * pricing.input.price;
  const outputCost = (outputTokens / 1000) * pricing.output.price;
  const totalCost = inputCost + outputCost;

  if (config.debug) {
    console.log('Total input tokens:', inputTokens);
    console.log('Total output tokens:', outputTokens);
    console.log('Calculated total cost:', totalCost);
    console.log('Model ID:', modelId);
    console.log('Model Name:', modelName);
  }
  
  return {
    inputCost,
    outputCost,
    totalCost,
    currency: pricing.input.currency
  };
};

export const convHistory = {
  saveConversation: async (record, credentials) => {
    if (config.debug) {
      console.log('Saving conversation record:', JSON.stringify(record, null, 2));
    }
    
    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });
    
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + (30 * 24 * 60 * 60); // 30 days
  
    // Calculate cost based on model ID and tokens
    const costInfo = calculateCost(
      record.modelId, 
      record.inputTokens || 0, 
      record.outputTokens || 0
    );
    
    const cleanRecord = {
      userID: record.userID,
      timestamp: timestamp,
      sessionID: record.sessionID,
      question: record.question,
      response: record.response,
      inputTokens: record.inputTokens || 0,
      outputTokens: record.outputTokens || 0,
      modelId: record.modelId,
      chatType: record.chatType,
      ttl: ttl
    };

    // Add citations if available
    if (record.citations) {
      cleanRecord.citations = record.citations;
    }

    // Add personaId if available
    if (record.personaId) {
      cleanRecord.personaId = record.personaId;
    }
    
    // Add cost information if available
    if (costInfo) {
      cleanRecord.inputCost = costInfo.inputCost;
      cleanRecord.outputCost = costInfo.outputCost;
      cleanRecord.totalCost = costInfo.totalCost;
      cleanRecord.currency = costInfo.currency;
    }
  
    if (record.documentContext) {
      if (config.debug) {
        console.log('Document context before processing:', record.documentContext);
      }
      if (typeof record.documentContext === 'string') {
        try {
          const parsed = JSON.parse(record.documentContext);
          if (Array.isArray(parsed) && parsed.length > 0 && Object.keys(parsed[0]).length > 0) {
            cleanRecord.documentContext = record.documentContext;
          }
        } catch (e) {
          if (config.debug) {
            console.warn('Invalid document context format:', e);
          }
        }
      } else if (Array.isArray(record.documentContext) && record.documentContext.length > 0) {
        cleanRecord.documentContext = JSON.stringify(record.documentContext);
      }
    }
  
    if (config.debug) {
      console.log('Clean record being saved:', JSON.stringify(cleanRecord, null, 2));
    }
  
    const params = {
      TableName: DynamoConfig.convHistoryTable,
      Item: marshall(cleanRecord, {
        removeUndefinedValues: true
      })
    };
  
    if (config.debug) {
      console.log('DynamoDB params:', JSON.stringify(params, null, 2));
    }
  
    try {
      const response = await client.send(new PutItemCommand(params));
      if (config.debug) {
        console.log('DynamoDB response:', JSON.stringify(response, null, 2));
      }
      return response;
    } catch (error) {
      if (config.debug) {
        console.error('Error saving to DynamoDB:', error);
      }
      throw error;
    }
  },

  loadUserHistory: async (userId, credentials) => {
    if (config.debug) {
      console.log('Loading history for userID:', userId);
    }
    
    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });
    const params = {
      TableName: DynamoConfig.convHistoryTable,
      KeyConditionExpression: "userID = :userId",
      ExpressionAttributeValues: marshall({
        ":userId": userId
      }),
      ScanIndexForward: false,
      Select: "ALL_ATTRIBUTES"
    };
  
    try {
      let allItems = [];
      let lastEvaluatedKey = undefined;
  
      do {
        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = lastEvaluatedKey;
        }
  
        const queryResponse = await client.send(new QueryCommand(params));
        
        if (queryResponse.Items && queryResponse.Items.length > 0) {
          const items = queryResponse.Items.map(item => unmarshall(item));
          allItems = [...allItems, ...items];
        }
  
        lastEvaluatedKey = queryResponse.LastEvaluatedKey;
  
      } while (lastEvaluatedKey);
  
      if (config.debug) {
        console.log('Total conversation history items:', allItems.length);
      }
      return allItems;
  
    } catch (error) {
      if (config.debug) {
        console.error('Error loading conversation history:', error);
      }
      return [];
    }
  },

  loadSessionHistory: async (userId, sessionId, credentials) => {
    if (config.debug) {
      console.log('Loading session history for userID:', userId, 'sessionID:', sessionId);
    }
    
    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });
  
    const params = {
      TableName: DynamoConfig.convHistoryTable,
      KeyConditionExpression: "userID = :userId",
      FilterExpression: "sessionID = :sessionId",
      ExpressionAttributeValues: marshall({
        ":userId": userId,
        ":sessionId": sessionId
      }),
      ScanIndexForward: true,
      Select: "ALL_ATTRIBUTES"
    };
  
    try {
      let allItems = [];
      let lastEvaluatedKey = undefined;

      do {
        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const response = await client.send(new QueryCommand(params));
        
        if (response.Items && response.Items.length > 0) {
          const items = response.Items.map(item => unmarshall(item));
          allItems = [...allItems, ...items];
        }

        lastEvaluatedKey = response.LastEvaluatedtedKey;

      } while (lastEvaluatedKey);

      if (config.debug) {
        console.log('Total session history items:', allItems.length);
      }
      return allItems;

    } catch (error) {
      if (config.debug) {
        console.error('Error loading session history:', error);
      }
      throw error;
    }
  },
  deleteSessionHistory: async (userId, sessionId, credentials) => {
    if (config.debug) {
      console.log('Deleting session history for userID:', userId, 'sessionID:', sessionId);
    }
    
    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });
  
    try {
      // First, query to get all items for this session
      const queryParams = {
        TableName: DynamoConfig.convHistoryTable,
        KeyConditionExpression: "userID = :userId",
        FilterExpression: "sessionID = :sessionId",
        ExpressionAttributeValues: marshall({
          ":userId": userId,
          ":sessionId": sessionId
        }),
        Select: "ALL_ATTRIBUTES"
      };
  
      let itemsToDelete = [];
      let lastEvaluatedKey = undefined;
  
      // Gather all items that need to be deleted
      do {
        if (lastEvaluatedKey) {
          queryParams.ExclusiveStartKey = lastEvaluatedKey;
        }
  
        const queryResponse = await client.send(new QueryCommand(queryParams));
        
        if (queryResponse.Items && queryResponse.Items.length > 0) {
          itemsToDelete = [...itemsToDelete, ...queryResponse.Items];
        }
  
        lastEvaluatedKey = queryResponse.LastEvaluatedKey;
      } while (lastEvaluatedKey);
  
      // Delete each item
      for (const item of itemsToDelete) {
        const unmarshalled = unmarshall(item);
        
        const deleteParams = {
          TableName: DynamoConfig.convHistoryTable,
          Key: marshall({
            userID: unmarshalled.userID,
            timestamp: unmarshalled.timestamp
          })
        };
  
        try {
          await client.send(new DeleteItemCommand(deleteParams));
        } catch (deleteError) {
          if (config.debug) {
            console.error('Error deleting item:', deleteError);
          }
          throw deleteError;
        }
      }
  
      if (config.debug) {
        console.log(`Successfully deleted ${itemsToDelete.length} items from session ${sessionId}`);
      }
      return true;
  
    } catch (error) {
      if (config.debug) {
        console.error('Error in deleteSessionHistory:', error);
      }
      throw error;
    }
  },

  updateFeedback: async (userId, timestamp, feedbackType, credentials, sessionId) => {
    if (config.debug) {
      console.log('Updating feedback for userID:', userId, 'timestamp:', timestamp, 'feedback:', feedbackType);
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    // First, query to find the exact record with matching timestamp
    // Query for records near this timestamp to find the right one
    const queryParams = {
      TableName: DynamoConfig.convHistoryTable,
      KeyConditionExpression: "userID = :userId AND #ts BETWEEN :startTime AND :endTime",
      ExpressionAttributeNames: {
        "#ts": "timestamp"
      },
      ExpressionAttributeValues: marshall({
        ":userId": userId,
        ":startTime": timestamp - 1000, // Look 1 second before
        ":endTime": timestamp + 1000    // and 1 second after
      }),
      ScanIndexForward: false,
      Limit: 10
    };

    try {
      const queryResponse = await client.send(new QueryCommand(queryParams));

      if (!queryResponse.Items || queryResponse.Items.length === 0) {
        throw new Error('No matching conversation record found');
      }

      // Find the record with the closest timestamp and matching sessionID if provided
      let targetRecord = null;
      let minDiff = Infinity;

      for (const item of queryResponse.Items) {
        const record = unmarshall(item);
        const timeDiff = Math.abs(record.timestamp - timestamp);

        // If sessionId provided, must match; otherwise just find closest timestamp
        if (sessionId) {
          if (record.sessionID === sessionId && timeDiff < minDiff) {
            minDiff = timeDiff;
            targetRecord = record;
          }
        } else if (timeDiff < minDiff) {
          minDiff = timeDiff;
          targetRecord = record;
        }
      }

      if (!targetRecord) {
        throw new Error('No matching conversation record found for session');
      }

      if (config.debug) {
        console.log('Found matching record with timestamp:', targetRecord.timestamp);
      }

      // Now update the found record
      const updateParams = {
        TableName: DynamoConfig.convHistoryTable,
        Key: marshall({
          userID: userId,
          timestamp: targetRecord.timestamp
        }),
        UpdateExpression: "SET feedback = :feedback",
        ExpressionAttributeValues: marshall({
          ":feedback": feedbackType
        }),
        ReturnValues: "ALL_NEW"
      };

      const response = await client.send(new UpdateItemCommand(updateParams));
      if (config.debug) {
        console.log('Feedback updated successfully:', JSON.stringify(response, null, 2));
      }
      return response;
    } catch (error) {
      if (config.debug) {
        console.error('Error updating feedback:', error);
      }
      throw error;
    }
  }
};