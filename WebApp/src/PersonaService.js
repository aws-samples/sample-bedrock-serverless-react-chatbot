// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, BatchWriteItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from 'uuid';
import { config, DynamoConfig, vpceEndpoints } from './aws-config';

// Default personas that will be created if none exist
const DEFAULT_PERSONAS = [
  {
    id: 'default',
    name: 'Default Assistant',
    description: 'A helpful AI assistant',
    prompt: 'You are a helpful AI Assistant',
    isDefault: true,
    isSystem: true
  }
];

export const PersonaService = {
  // Initialize default personas for a user if they don't exist
  initializeDefaultPersonas: async (userId, credentials) => {
    if (config.debug) {
      console.log('Initializing default personas for user:', userId);
    }

    try {
      // Check if user already has personas
      const existingPersonas = await PersonaService.getUserPersonas(userId, credentials);
      
      if (config.debug) {
        console.log('Existing personas found:', existingPersonas.length);
      }
      
      if (existingPersonas.length === 0) {
        // Create default personas using batch write for efficiency
        await PersonaService.batchCreatePersonas(userId, DEFAULT_PERSONAS, credentials);
        if (config.debug) {
          console.log('Default personas initialized for user:', userId);
        }
      } else {
        // Check if we're missing any default personas and add them
        const existingIds = new Set(existingPersonas.map(p => p.id));
        const missingPersonas = DEFAULT_PERSONAS.filter(p => !existingIds.has(p.id));
        
        if (missingPersonas.length > 0) {
          if (config.debug) {
            console.log('Adding missing default personas:', missingPersonas.map(p => p.id));
          }
          await PersonaService.batchCreatePersonas(userId, missingPersonas, credentials);
        }
      }
    } catch (error) {
      if (config.debug) {
        console.error('Error initializing default personas:', error);
      }
      throw error;
    }
  },

  // Batch create multiple personas efficiently
  batchCreatePersonas: async (userId, personas, credentials) => {
    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + (365 * 24 * 60 * 60); // 1 year TTL

    // Prepare batch write items
    const writeRequests = personas.map(persona => ({
      PutRequest: {
        Item: marshall({
          userID: userId,
          personaId: persona.id,
          name: persona.name,
          description: persona.description,
          prompt: persona.prompt,
          icon: 'gen-ai', // Always use default icon
          isDefault: persona.isDefault || false,
          isSystem: persona.isSystem || false,
          createdAt: timestamp,
          updatedAt: timestamp,
          ttl: ttl
        }, {
          removeUndefinedValues: true
        })
      }
    }));

    // DynamoDB batch write can handle max 25 items at a time
    const batchSize = 25;
    for (let i = 0; i < writeRequests.length; i += batchSize) {
      const batch = writeRequests.slice(i, i + batchSize);
      
      const params = {
        RequestItems: {
          [DynamoConfig.personaTable]: batch
        }
      };

      await client.send(new BatchWriteItemCommand(params));
    }
  },

  // Save a persona (create or update)
  savePersona: async (userId, persona, credentials) => {
    if (config.debug) {
      console.log('Saving persona:', persona);
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + (365 * 24 * 60 * 60); // 1 year TTL

    const personaId = persona.id || uuidv4();

    // Check if this is an update
    let createdAt = timestamp;
    if (persona.id) {
      const existing = await PersonaService.getPersonaById(userId, persona.id, credentials);
      if (existing) {
        createdAt = existing.createdAt || timestamp;
      }
    }

    const personaRecord = {
      userID: userId,
      personaId: personaId,
      name: persona.name,
      description: persona.description,
      prompt: persona.prompt,
      documents: persona.documents || [],
      s3Prefix: persona.s3Prefix || `personas/${userId}/${personaId}/`,
      icon: 'gen-ai', // Always use default icon
      isDefault: persona.isDefault || false,
      isSystem: persona.isSystem || false,
      createdAt: createdAt,
      updatedAt: timestamp,
      ttl: ttl
    };

    const params = {
      TableName: DynamoConfig.personaTable,
      Item: marshall(personaRecord, {
        removeUndefinedValues: true
      })
    };

    try {
      await client.send(new PutItemCommand(params));
      if (config.debug) {
        console.log('Persona saved successfully:', personaId);
      }
      return { ...personaRecord, id: personaId };
    } catch (error) {
      if (config.debug) {
        console.error('Error saving persona:', error);
      }
      throw error;
    }
  },

  // Get all personas for a user
  getUserPersonas: async (userId, credentials) => {
    if (config.debug) {
      console.log('Loading personas for user:', userId);
      console.log('Using table:', DynamoConfig.personaTable);
      console.log('Using region:', DynamoConfig.region);
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    const params = {
      TableName: DynamoConfig.personaTable,
      KeyConditionExpression: "userID = :userId",
      ExpressionAttributeValues: marshall({
        ":userId": userId
      })
    };

    if (config.debug) {
      console.log('Query params:', JSON.stringify(params, null, 2));
    }

    try {
      const response = await client.send(new QueryCommand(params));
      
      if (config.debug) {
        console.log('DynamoDB response:', response);
        console.log('Items found:', response.Items ? response.Items.length : 0);
      }
      
      const personas = response.Items ? response.Items.map(item => {
        const unmarshalled = unmarshall(item);
        if (config.debug) {
          console.log('Unmarshalled item:', unmarshalled);
        }
        return {
          id: unmarshalled.personaId,
          name: unmarshalled.name,
          description: unmarshalled.description,
          prompt: unmarshalled.prompt,
          documents: unmarshalled.documents || [],
          s3Prefix: unmarshalled.s3Prefix || `personas/${userId}/${unmarshalled.personaId}/`,
          icon: unmarshalled.icon,
          isDefault: unmarshalled.isDefault,
          isSystem: unmarshalled.isSystem,
          createdAt: unmarshalled.createdAt,
          updatedAt: unmarshalled.updatedAt
        };
      }) : [];

      // Sort personas: default first, then system personas, then custom personas
      personas.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        if (a.isSystem && !b.isSystem) return -1;
        if (b.isSystem && !a.isSystem) return 1;
        return a.name.localeCompare(b.name);
      });

      if (config.debug) {
        console.log('Final personas array:', personas);
        console.log('Loaded personas count:', personas.length);
      }
      return personas;
    } catch (error) {
      if (config.debug) {
        console.error('Error loading personas:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
      return [];
    }
  },

  // Delete a persona (only custom personas can be deleted)
  deletePersona: async (userId, personaId, credentials) => {
    if (config.debug) {
      console.log('Deleting persona:', personaId, 'for user:', userId);
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    try {
      // First, get the persona to check if it can be deleted
      const persona = await PersonaService.getPersonaById(userId, personaId, credentials);
      
      if (!persona) {
        throw new Error('Persona not found');
      }

      if (persona.isSystem) {
        throw new Error('System personas cannot be deleted');
      }

      // Delete the persona
      const deleteParams = {
        TableName: DynamoConfig.personaTable,
        Key: marshall({
          userID: userId,
          personaId: personaId
        })
      };

      await client.send(new DeleteItemCommand(deleteParams));
      
      if (config.debug) {
        console.log('Persona deleted successfully:', personaId);
      }
      return true;
    } catch (error) {
      if (config.debug) {
        console.error('Error deleting persona:', error);
      }
      throw error;
    }
  },

  // Get a specific persona by ID
  getPersonaById: async (userId, personaId, credentials) => {
    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    const params = {
      TableName: DynamoConfig.personaTable,
      Key: marshall({
        userID: userId,
        personaId: personaId
      })
    };

    try {
      const response = await client.send(new GetItemCommand(params));
      
      if (response.Item) {
        const unmarshalled = unmarshall(response.Item);
        return {
          id: unmarshalled.personaId,
          name: unmarshalled.name,
          description: unmarshalled.description,
          prompt: unmarshalled.prompt,
          documents: unmarshalled.documents || [],
          s3Prefix: unmarshalled.s3Prefix || `personas/${userId}/${personaId}/`,
          icon: unmarshalled.icon,
          isDefault: unmarshalled.isDefault,
          isSystem: unmarshalled.isSystem,
          createdAt: unmarshalled.createdAt,
          updatedAt: unmarshalled.updatedAt
        };
      }
      return null;
    } catch (error) {
      if (config.debug) {
        console.error('Error getting persona by ID:', error);
      }
      return null;
    }
  },

  // Get persona prompt by ID
  getPersonaPrompt: async (userId, personaId, credentials) => {
    const persona = await PersonaService.getPersonaById(userId, personaId, credentials);
    return persona ? persona.prompt : '';
  },

  // Reset user personas to defaults only (removes all custom personas)
  resetToDefaultPersonas: async (userId, credentials) => {
    if (config.debug) {
      console.log('Resetting personas to defaults for user:', userId);
    }

    const client = new DynamoDBClient({
      region: DynamoConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.dynamodb && { endpoint: vpceEndpoints.dynamodb })
    });

    try {
      // Get all existing personas
      const existingPersonas = await PersonaService.getUserPersonas(userId, credentials);
      
      // Delete all existing personas
      const deleteRequests = existingPersonas.map(persona => ({
        DeleteRequest: {
          Key: marshall({
            userID: userId,
            personaId: persona.id
          })
        }
      }));

      // Delete in batches
      const batchSize = 25;
      for (let i = 0; i < deleteRequests.length; i += batchSize) {
        const batch = deleteRequests.slice(i, i + batchSize);
        
        const params = {
          RequestItems: {
            [DynamoConfig.personaTable]: batch
          }
        };

        await client.send(new BatchWriteItemCommand(params));
      }

      if (config.debug) {
        console.log(`Deleted ${existingPersonas.length} existing persona records.`);
      }

      // Recreate default personas
      await PersonaService.batchCreatePersonas(userId, DEFAULT_PERSONAS, credentials);

      if (config.debug) {
        console.log('Default personas recreated successfully.');
      }

      return existingPersonas.length;
    } catch (error) {
      if (config.debug) {
        console.error('Error resetting to default personas:', error);
      }
      throw error;
    }
  }
};