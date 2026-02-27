// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeInlineAgentCommand,
  RetrieveAndGenerateStreamCommand
} from "@aws-sdk/client-bedrock-agent-runtime";
import { 
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  UpdateAgentCommand,
  GetAgentCommand,
  GetAgentAliasCommand,
  PrepareAgentCommand,
  CreateAgentAliasCommand,
  UpdateDataSourceCommand,
  CreateDataSourceCommand
} from "@aws-sdk/client-bedrock-agent";
import { BedrockClient, GetFoundationModelCommand, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockConfig, config, vpceEndpoints } from './aws-config';
import { sanitizeForLog } from './utils/sanitize';

/**
 * @typedef {Object} ResponseBody
 * @property {string} completion
 */

/**
 * Invokes a Bedrock agent to run an inference using the input
 * provided in the request body.
 *
 * @param {string} prompt - The prompt that you want the Agent to complete.
 * @param {string} sessionId - An arbitrary identifier for the session.
 */

export const parameters = { 
  modelId: null, instruction: null, modelupdated: false, instructionUpdated: false
};

export const setModel = (modelId) => {
  parameters.modelId = modelId;
  parameters.modelupdated = true;
}

export const setInstruction = (instruction) => {
  parameters.instruction = instruction;
  parameters.instructionUpdated = true;
}

export const getModel = (credentials) => {
  if(!parameters.modelupdated) {
    return getBedrockAgentModel(credentials);
  }
  return parameters.modelId;
}

export const getInstruction = async (credentials) => {
  if(!parameters.instructionUpdated) {
    const instruction = await getBedrockAgentInstructions(credentials);
    return instruction;
  }
  return parameters.instruction;
}

export const getBedrockKBStream = async (prompt, sessionId, modelArn) => {
  const client = new BedrockAgentRuntimeClient({
    region: bedrockConfig.region,
    ...(vpceEndpoints.bedrockAgentRuntime && { endpoint: vpceEndpoints.bedrockAgentRuntime })
  });
  const input = { // RetrieveAndGenerateStreamRequest
    sessionId: sessionId,
    input: { // RetrieveAndGenerateInput
      text: prompt, // required
    },
    retrieveAndGenerateConfiguration: { // RetrieveAndGenerateConfiguration
      type: "KNOWLEDGE_BASE", // required
      knowledgeBaseConfiguration: { // KnowledgeBaseRetrieveAndGenerateConfiguration
        knowledgeBaseId: bedrockConfig.knowledgeBaseId, // required
        modelArn: modelArn, // required
      },
    },
    // sessionConfiguration: { // RetrieveAndGenerateSessionConfiguration
    //   kmsKeyArn: "STRING_VALUE", // required
    // },
  };
  const command = new RetrieveAndGenerateStreamCommand(input);
  const response = await client.send(command);
  return response;
}

export const getAgentCommand = (prompt, sessionId, supportsStreaming) => {
  const agentId = bedrockConfig.agentId;
  const agentAliasId = bedrockConfig.agentAliasId;

  if(parameters.modelUpdated || parameters.instructionUpdated) {
    const command = new InvokeInlineAgentCommand({
      instruction: parameters.instruction,
      foundationModel: parameters.modelId,
      sessionId,
      inputText: prompt,
      knowledgeBases: [
        {
          knowledgeBaseId: bedrockConfig.knowledgeBaseId,
          description: "My Knowledge Base",
          vectorSearchConfiguration: {
            numberOfResults: 3,
            semanticThreshold: 0.8
          }
        },
      ]
    });
    return command;
  } else {
    const command = new InvokeAgentCommand({
      agentId: agentId,
      agentAliasId: agentAliasId,
      sessionId: sessionId,
      inputText: prompt,
      streamingConfigurations: {
        streamFinalResponse: true
      }
    });
    return command;
  }
}

export const doesModelSupportStreaming = async (modelId, credentials) => {
  const client = new BedrockClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrock && { endpoint: vpceEndpoints.bedrock })
  });
  const input = { // GetFoundationModelRequest
    modelIdentifier: modelId, // required
  };
  const command = new GetFoundationModelCommand(input);
  try {
    const response = await client.send(command);
    if (response.responseStreamSupported) {
      if (config.debug) {
        console.log('Model supports streaming');
      }
      return true;
    }
    } catch (error) {
    console.error(error);
    return false;
  }
}

export const invokeBedrockAgent = async (prompt, sessionId, credentials, onChunk = null) => {
  const command = getAgentCommand(prompt, sessionId);
  const client = new BedrockAgentRuntimeClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgentRuntime && { endpoint: vpceEndpoints.bedrockAgentRuntime })
  });

  if (config.debug) {
    console.log(credentials);
  }

  try {
    let completion = "";
    let citations = [];
    const response = await client.send(command);

    if (response.completion === undefined) {
      throw new Error("Completion is undefined");
    }

    if (config.debug) {
      console.log("Response:", response);
      console.log("Response Completion:", response.completion);
    }
    for await (let chunkEvent of response.completion) {
      const chunk = chunkEvent.chunk;
      if (config.debug) {
        console.log(chunk);
      }
      const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
      
      completion += decodedResponse;
      
      // Call the streaming callback if provided
      if (onChunk) {
        onChunk(decodedResponse);
      }
      
      if (chunk && chunk.attribution && chunk.attribution.citations) {
        chunk.attribution.citations.forEach(item => {
          if (item && item.retrievedReferences) {
            item.retrievedReferences.forEach(ref => {
              if (ref && ref.location && ref.location.s3Location && ref.location.s3Location.uri) {
                const uri = ref.location.s3Location.uri;
                if (!citations.includes(uri)) {
                  citations.push(uri);
                }
              }
            });
          }
        });
      }
    }

    if (citations.length > 0) {
      completion += '  \n  \nCitations:  \n';
      for (let i = 0; i < citations.length; i++) {
        completion += citations[i] + '  \n';
      }
    }  
    return { sessionId: sessionId, completion };
  } catch (err) {
    console.error('Invoke Bedrock agent error:', sanitizeForLog(err.message));
  }
};

export const invokeBedrockRetrieveAndGenerateStreamCommand = async (prompt, files, sessionId, credentials, modelId, conversationHistory = [], onChunk) => {
  if (!credentials) {
    throw new Error('Credentials not provided');
  }

  if (config.debug) console.log('Model ID:', sanitizeForLog(modelId))
  const bedrockClient = new BedrockAgentRuntimeClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgentRuntime && { endpoint: vpceEndpoints.bedrockAgentRuntime })
  });


  // Validate and format conversation history
  const formattedHistory = conversationHistory
    .filter(msg => msg && msg.role && msg.content)
    .map(msg => ({ role: msg.role, content: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }] }));

  // Create new messages array starting with validated history
  const messages = [...formattedHistory];

  // Prepare the input text
  let inputText = prompt;

  if (files && files.length > 0) {
    // Append file information to the prompt if files are present
    const fileNames = files.map(file => file.name).join(', ');
    inputText = `${prompt}\n\nReference files: ${fileNames}`;
  }

  // Default prompt template with instruction to acknowledge when information is not found
  const defaultPromptTemplate = `You are a helpful assistant. Use the following context from the knowledge base to answer the question.

$search_results$

Question: $query$

Instructions:
- Answer the question based on the context provided above
- If the information needed to answer the question is not found in the context, respond with: "Sorry, I don't have information in my knowledge base to answer that question."
- Be concise and accurate in your responses

Answer:`;

  const input = {
    ...(sessionId && { sessionId }),
    input: {
      text: inputText,
    },
    retrieveAndGenerateConfiguration: {
      type: "KNOWLEDGE_BASE",
      knowledgeBaseConfiguration: {
        knowledgeBaseId: bedrockConfig.knowledgeBaseId,
        modelArn: modelId,
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 100,
          },
        },
        generationConfiguration: {
          promptTemplate: {
            textPromptTemplate: bedrockConfig.defaultPrompt || defaultPromptTemplate,
          },
          guardrailConfiguration: bedrockConfig.useGuardrail ? {
            guardrailId: bedrockConfig.guardrailId,
            guardrailVersion: bedrockConfig.guardrailVersion,
          } : undefined,
        },
      },
    },
  };  

  try {
    if (config.debug) {
      console.log('Sending request to Bedrock:', JSON.stringify(input, null, 2));
    }

    const command = new RetrieveAndGenerateStreamCommand(input);
    const response = await bedrockClient.send(command);
    
    let responseText = '';
    let citations = [];

    for await (const event of response.stream) {
      if(config.debug) {
        console.log('Event:', JSON.stringify(event, null, 2));
      }
      if (event.output) {
        const chunkText = event.output.text;
        responseText += chunkText;
        
        if (onChunk) {
          onChunk(chunkText);
        }
      }
      if (event.citation) {
        // CitationEvent has retrievedReferences at both event.citation.citation
        // and event.citation level. Normalize into a consistent shape.
        const citationEvent = event.citation;
        const innerCitation = citationEvent.citation;
        citations.push({
          generatedResponsePart: innerCitation?.generatedResponsePart || citationEvent.generatedResponsePart,
          retrievedReferences: innerCitation?.retrievedReferences || citationEvent.retrievedReferences || [],
        });
      }
    }

    if(config.debug) {
      console.log(response);
    }

    // Add the response to the conversation history
    const newMessage = {
      role: "assistant",
      content: [{ text: responseText }]
    };
    const updatedHistory = [...conversationHistory, newMessage];

    return { 
      body: responseText,
      conversationHistory: updatedHistory,
      citations: citations,
      sessionId: response.sessionId,
      fullResponse: response
    };
  } catch (error) {
    console.error('Error invoking Bedrock:', error);
    throw error;
  }
};

export const invokeBedrockConverseCommand = async (prompt, files, credentials, modelId, conversationHistory = []) => {
  if (!credentials) {
    throw new Error('Credentials not provided');
  }

  const bedrockClient = new BedrockRuntimeClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockRuntime && { endpoint: vpceEndpoints.bedrockRuntime })
  });

  // Validate and format conversation history
  const formattedHistory = conversationHistory
    .filter(msg => msg && msg.role && msg.content)
    .map(msg => ({ role: msg.role, content: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }] }));

  // Create new messages array starting with validated history
  const messages = [...formattedHistory];

  // Add the new message with files or just text
  if (files && files.length > 0) {
    const content = [];
    for (const file of files) {
      const fileContent = await file.arrayBuffer();
      const fileBytes = new Uint8Array(fileContent);
      const format = file.name.split('.').pop().toLowerCase();
      const sanitizedName = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9\s\-\(\)\[\]]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
      if (!['txt', 'pdf', 'doc', 'docx', 'csv', 'md', 'html', 'xls', 'xlsx'].includes(format)) {
        throw new Error(`Unsupported file format: ${format}`);
      }
      content.push({ document: { name: sanitizedName, format: format, source: { bytes: fileBytes } } });
    }
    content.push({ text: prompt });
    messages.push({ role: 'user', content: content });
  } else {
    messages.push({ role: 'user', content: [{ text: prompt }] });
  }

  if (parameters.modelUpdated) {
    modelId = parameters.modelId;
  }

  try {
    // Log messages for debugging
    if (config.debug) {
      console.log('Sending messages to Bedrock:', JSON.stringify(messages, null, 2));
    }

    const command = new ConverseCommand({ modelId, messages });
    const response = await bedrockClient.send(command);

    // Extract the response data
    const { output, stopReason, usage, metrics, additionalModelResponseFields, trace } = response;

    // Process the response
    let responseText = '';
    if (output && output.message) {
      for (const content of output.message.content) {
        if (content.text) {
          responseText += content.text;
        }
      }
    }

    // Add the complete messages to the conversation history
    const validCompleteMessages = [
      ...formattedHistory,
      { role: 'user', content: messages.find(m => m.role === 'user').content },
      { role: 'assistant', content: [{ text: responseText }] },
    ];

    return {
      body: responseText,
      conversationHistory: validCompleteMessages,
      stopReason,
      usage,
      metrics,
      additionalModelResponseFields,
      trace,
    };
  } catch (error) {
    console.error('Error invoking Bedrock:', error);
    throw error;
  }
};

export const invokeBedrockConverseStreamCommand = async (prompt, files, credentials, modelId, conversationHistory = [], onChunk) => {
  if (!credentials) {
    throw new Error('Credentials not provided');
  }
  if (config.debug) {
    console.log('Model ID:', sanitizeForLog(modelId))
  }
  
  const bedrockClient = new BedrockRuntimeClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockRuntime && { endpoint: vpceEndpoints.bedrockRuntime })
  });

  // Validate and format conversation history
  const formattedHistory = conversationHistory
    .filter(msg => msg && msg.role && msg.content) // Filter out invalid messages
    .map(msg => ({
      role: msg.role,
      content: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }]
    }));

  // Create new messages array starting with validated history
  const messages = [...formattedHistory];

  // Add the new message with files or just text
  if (files && files.length > 0) {
    const content = [];

    for (const file of files) {
      const fileContent = await file.arrayBuffer();
      const fileBytes = new Uint8Array(fileContent);
      const format = file.name.split('.').pop().toLowerCase();
      
      const sanitizedName = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9\s\-\(\)\[\]]/g, "-")
        .replace(/\s+/g, " ")
        .trim();

      if (!['txt', 'pdf', 'doc', 'docx', 'csv', 'md', 'html', 'xls', 'xlsx'].includes(format)) {
        throw new Error(`Unsupported file format: ${format}`);
      }

      content.push({
        document: {
          name: sanitizedName,
          format: format,
          source: {
            bytes: fileBytes
          }
        }
      });
    }

    content.push({
      text: prompt
    });

    messages.push({
      role: "user",
      content: content
    });
  } else {
    messages.push({
      role: "user",
      content: [{
        text: prompt
      }]
    });
  }

  if(parameters.modelUpdated) {
    modelId = parameters.modelId;
  }

  try {
    // Log messages for debugging
    if (config.debug) {
      console.log('Sending messages to Bedrock:', JSON.stringify(messages, null, 2));
    }

    const command = new ConverseStreamCommand({
      modelId,
      messages: messages.map(msg => ({
        role: msg.role,
        content: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }]
      })),
      guardrailConfig: bedrockConfig.useGuardrail ? { // GuardrailStreamConfiguration
        guardrailIdentifier: bedrockConfig.guardrailId, // from aws-config.js
        guardrailVersion: bedrockConfig.guardrailVersion, // from aws-config.js
        trace: "enabled",
        streamProcessingMode: "sync",
      } : undefined,
    });

    const response = await bedrockClient.send(command);
    let responseText = '';
    let completeMessages = [];
    let currentMessage = null;
    let usageInfo = null;  // Add this line

    for await (const event of response.stream) {
      // Handle message start
      if (event.messageStart) {
        currentMessage = {
          role: event.messageStart.role,
          content: []
        };
      }
      
      //console.log("event: ")
      //console.log(event)
      // Handle content block delta (actual content)
      if (event.contentBlockDelta && event.contentBlockDelta.delta.text) {
        const chunkText = event.contentBlockDelta.delta.text;
        responseText += chunkText;
        
        if (onChunk) {
          onChunk(chunkText);
        }
      }

      // Extract usage information if available
      if (event.metadata && event.metadata.usage) {
        usageInfo = event.metadata.usage;
        //console.log("UsageInfo from metadata:", usageInfo);
      } else if (event.metrics && event.metrics.inputTokenCount) {
        usageInfo = {
          inputTokens: event.metrics.inputTokenCount || 0,
          outputTokens: event.metrics.outputTokenCount || 0
        };
        //console.log("UsageInfo from metrics:", usageInfo);
      }



      // Handle message stop
      if (event.messageStop) {
        if (currentMessage) {
          currentMessage.content = [{ text: responseText }];
          completeMessages.push(currentMessage);
        }
      }
    }

    // Add the complete messages to the conversation history
    const validCompleteMessages = completeMessages.filter(msg => msg && msg.role && msg.content);
    messages.push(...validCompleteMessages);


    return { 
      body: responseText,
      conversationHistory: messages,
      usage: usageInfo
    };
  } catch (error) {
    console.error('Error invoking Bedrock:', error);
    throw error;
  }
};  
  
export const invokeBedrock = async (prompt, sessionId, credentials, modelId) => {
  if (!credentials) {
    throw new Error('Credentials not provided');
  }

  const bedrockClient = new BedrockRuntimeClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockRuntime && { endpoint: vpceEndpoints.bedrockRuntime })
  });

  try {
    let requestBody;
    const modelId = parameters.modelId || "anthropic.claude-v2";

    // Format request body based on model
    if (modelId.includes('claude-3')) {
      requestBody = {
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: bedrockConfig.maxTokens,
        temperature: 0.7,
        top_p: 1,
        anthropic_version: "bedrock-2023-05-31"
      };
    } else if (modelId.includes('claude')) {
      requestBody = {
        prompt: "\n\nHuman: " + prompt + "\n\nAssistant:",
        max_tokens_to_sample: bedrockConfig.maxTokens,
        temperature: 0.7,
        top_p: 1,
        stop_sequences: ["\n\nHuman:"]
      };
    } else if (modelId.includes('titan')) {
      requestBody = {
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: bedrockConfig.maxTokens,
          temperature: 0.7,
          topP: 1,
          stopSequences: []
        }
      };
    } else if (modelId.includes('ai21')) {
      requestBody = {
        prompt: prompt,
        maxTokens: bedrockConfig.maxTokens,
        temperature: 0.7,
        topP: 1,
        stopSequences: []
      };
    }

    const input = {
      body: new TextEncoder().encode(JSON.stringify(requestBody)),
      contentType: "application/json",
      accept: "application/json",
      modelId: modelId,
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    if (config.debug) {
      console.log('Raw Bedrock Response:', JSON.stringify(responseBody, null, 2));
    }
    
    // Handle different response formats
    let completion;
    if (modelId.includes('claude-3')) {
      completion = responseBody.messages?.[0]?.content?.[0]?.text || 
        responseBody.content?.[0]?.text ||
        responseBody;
    } else if (responseBody.completion) {
      completion = responseBody.completion;
    } else if (responseBody.generations) {
      completion = responseBody.generations[0].text;
    } else if (responseBody.outputText) {
      completion = responseBody.outputText;
    } else {
      completion = responseBody;
    }
    
    // If completion is a string, wrap it in an object
    if (typeof completion === 'string') {
      return { body: completion };
    }
    
    // If we already have an object, return it as is
    return completion;
    
  } catch (error) {
    console.error("Error invoking Bedrock:", sanitizeForLog(error.message));
    throw error;
  }
};
      
export const addWebsiteToCrawl = async (websiteUrl, inclusionFilters, exclusionFilters, scope, rateLimit, maxPages, credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  
  // Create a data source configuration for web crawling
  const dataSourceConfiguration = {
    type: "WEB",
    webConfiguration: {
      sourceConfiguration: {
        urlConfiguration: {
          seedUrls: [
            { url: websiteUrl }
          ]
        }
      },
      crawlerConfiguration: {
        crawlerLimits: {
          rateLimit: rateLimit || undefined,
          maxPages: maxPages || 100
        },
        inclusionFilters: inclusionFilters || [".*"],
        exclusionFilters: exclusionFilters || [".*\\.pdf"], // Default exclusion filter
        scope: scope || "SUBDOMAINS"
      }
    }
  };
  
  // Create a sanitized name from the website URL that matches the required pattern ([0-9a-zA-Z][_-]?){1,100}
  const sanitizedName = websiteUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 90);
    
  // Create a new data source with the website configuration
  const input = {
    knowledgeBaseId: bedrockConfig.knowledgeBaseId,
    name: `Web${sanitizedName}`,
    dataSourceConfiguration: dataSourceConfiguration
  };
  
  try {
    // Create the data source
    const createCommand = new CreateDataSourceCommand(input);
    const createResponse = await client.send(createCommand);
    
    // Start an ingestion job to crawl the website
    const ingestionInput = {
      knowledgeBaseId: bedrockConfig.knowledgeBaseId,
      dataSourceId: createResponse.dataSource.dataSourceId
    };
    const ingestionCommand = new StartIngestionJobCommand(ingestionInput);
    const ingestionResponse = await client.send(ingestionCommand);
    
    return {
      dataSourceId: createResponse.dataSource.dataSourceId,
      ingestionJobId: ingestionResponse.ingestionJob.ingestionJobId,
      status: "Website added to crawl queue and ingestion started"
    };
  } catch(e) {
    console.error("Error adding website to crawl:", sanitizeForLog(e.message));
    throw e;
  }
};

export const syncKnowledgeBase = async (credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  
  const input = {
    knowledgeBaseId: bedrockConfig.knowledgeBaseId,
    dataSourceId: bedrockConfig.dataSourceId
  };
  try {
    const command = new StartIngestionJobCommand(input);
    const response = await client.send(command);
    return response;
  } catch(e) {
    console.error('Sync knowledge base error:', sanitizeForLog(e.message));
  }
};

export const getSyncStatus = async (ingestionJobId, credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  
  const input = {
    knowledgeBaseId: bedrockConfig.knowledgeBaseId,
    dataSourceId: bedrockConfig.dataSourceId,
    ingestionJobId: ingestionJobId
  };
  try {
    const command = new GetIngestionJobCommand(input);
    const response = await client.send(command);
    return response.ingestionJob.status;
  } catch(e) {
    console.error('Get sync status error:', sanitizeForLog(e.message));
  }
};

export const getBedrockModels = async (credentials) => {
  const client = new BedrockClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrock && { endpoint: vpceEndpoints.bedrock })
  });
  
  try {
    // Get foundation models
    const foundationModelsInput = {
      byOutputModality: "TEXT",
      byInferenceType: "ON_DEMAND",
    };
    const foundationModelsCommand = new ListFoundationModelsCommand(foundationModelsInput);
    const foundationModelsResponse = await client.send(foundationModelsCommand);
    
    // Get inference profiles
    const inferenceProfilesCommand = new ListInferenceProfilesCommand({});
    const inferenceProfilesResponse = await client.send(inferenceProfilesCommand);

    if(config.debug) console.log("Inference Profiles:", inferenceProfilesResponse);
    
    // Normalize inference profiles to match foundation model structure
    const normalizedInferenceProfiles = (inferenceProfilesResponse.inferenceProfileSummaries || []).map(profile => ({
      modelId: profile.inferenceProfileId,
      modelName: profile.inferenceProfileName,
      providerName: profile.inferenceProfileName.split(' ')[1] || 'Unknown', // Extract provider from name
      inputModalities: ['TEXT'],
      outputModalities: ['TEXT'],
      responseStreamingSupported: true, // Assume true for inference profiles
      customizationsSupported: [],
      inferenceTypesSupported: ['ON_DEMAND']
    }));
    
    // Merge the lists
    const allModels = [
      ...(foundationModelsResponse.modelSummaries || []),
      ...normalizedInferenceProfiles
    ];
    
    return {
      modelSummaries: allModels
    };
  } catch(e) {
    console.error('Get Bedrock models error:', sanitizeForLog(e.message));
    // Fallback to just foundation models if inference profiles fail
    try {
      const foundationModelsInput = {
        byOutputModality: "TEXT",
        byInferenceType: "ON_DEMAND",
      };
      const foundationModelsCommand = new ListFoundationModelsCommand(foundationModelsInput);
      const response = await client.send(foundationModelsCommand);
      return response;
    } catch(fallbackError) {
      console.error('Fallback error:', sanitizeForLog(fallbackError.message));
      throw fallbackError;
    }
  }
}

export const getBedrockAgent = async (credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  const input = { // UpdateAgentRequest
    agentId: bedrockConfig.agentId
  };
  const command = new GetAgentCommand(input);
  try {
    const response = await client.send(command);
    return response;
  } catch(e) {
    console.error('Get Bedrock agent error:', sanitizeForLog(e.message));
  }
}

export const setBedrockAgentModel = async (credentials, modelId) => {
  setModel(modelId);
  if(!parameters.instructionUpdated) {
    const instruction = await getBedrockAgentInstructions(credentials);
    setInstruction(instruction);
  }
}

export const getBedrockAgentModel = async (credentials) => {
  try {
    const response = await getBedrockAgent(credentials);
    return response.agent.foundationModel;
  } catch (error) {
    console.error("Error getting Bedrock agent model:", sanitizeForLog(error.message));
    throw error;
  }
}

export const updateBedrockAgentModel = async (credentials, modelId) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  const input = { // UpdateAgentRequest
    agentId: bedrockConfig.agentId, // required
    agentName: bedrockConfig.agentName, // required
    foundationModel: modelId, // required
    agentResourceRoleArn: bedrockConfig.agentResourceRoleArn, // required
  };
  const command = new UpdateAgentCommand(input);
  try {
    const response = await client.send(command);
  } catch(e) {
    console.error('Update Bedrock agent model error:', sanitizeForLog(e.message));
  }
}

export const getBedrockAgentInstructions = async (credentials) => {
  try {
    const response = await getBedrockAgent(credentials);
    return response.agent.instruction;
  } catch (error) {
    console.error("Error getting Bedrock agent instructions:", sanitizeForLog(error.message));
    throw error;
  }
}

export const setBedrockAgentInstruction = async (credentials, instruction) => {
  setInstruction(instruction);
  if(!parameters.modelupdated) {
    const model = await getBedrockAgentModel(credentials);
    setModel(model);
  }
}

export const updateBedrockAgentInstructions = async (credentials, instructions) => {
  try {
    const client = new BedrockAgentClient({
      region: bedrockConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
    });

    const modelId = bedrockConfig.defaultModelId;

    const input = {
      agentId: bedrockConfig.agentId,
      agentName: bedrockConfig.agentName,
      instruction: instructions,
      agentResourceRoleArn: bedrockConfig.agentResourceRoleArn,
      foundationModel: modelId,
    };

    const command = new UpdateAgentCommand(input);
    const response = await client.send(command);
    prepareBedrockAgent(credentials);
    return response;
  } catch (error) {
    console.error("Error updating Bedrock agent instructions:", sanitizeForLog(error.message));
    throw error;
  }
}

export const prepareBedrockAgent = async (credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  const input = { // PrepareAgentRequest
    agentId: bedrockConfig.agentId, // required
  };
  try {
    const command = new PrepareAgentCommand(input);
    const response = await client.send(command);
  } catch(e) {
    console.error('Prepare Bedrock agent error:', sanitizeForLog(e.message));
  }
}

export const createBedrockAgentAlias = async (credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  const input = { // CreateAgentAliasRequest
    agentId: bedrockConfig.agentId, // required
    agentAliasName: "USER_UPDATE_WILL_BE_DELETED", // required
  };
  try {
    const command = new CreateAgentAliasCommand(input);
    const response = await client.send(command);
    return response;
  } catch(e) {
    console.error('Create Bedrock agent alias error:', sanitizeForLog(e.message));
  }
}

export const getBedrockAgentAliasStatus = async (credentials, aliasId) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });
  const input = { // GetAgentAliasRequest
    agentId: bedrockConfig.agentId, // required
    agentAliasId: aliasId, // required
  };
  try {
    const command = new GetAgentAliasCommand(input);
    const response = await client.send(command);
  } catch(e) {
    console.error('Get Bedrock agent alias status error:', sanitizeForLog(e.message));
  }
}  