// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeInlineAgentCommand,
  RetrieveAndGenerateStreamCommand,
  RetrieveCommand
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
  CreateDataSourceCommand,
  GetDataSourceCommand
} from "@aws-sdk/client-bedrock-agent";
import { BedrockClient, GetFoundationModelCommand, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockConfig, config, vpceEndpoints, isManagedKnowledgeBase } from './aws-config';
import { sanitizeForLog } from './utils/sanitize';
import { toCanonicalS3Uri } from './utils/s3Uri';

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
    // Never log raw credentials (accessKeyId/secretAccessKey/sessionToken).
    // Log only non-sensitive metadata to confirm credentials were resolved.
    console.log('Credentials resolved:', credentials
      ? { hasAccessKeyId: !!credentials.accessKeyId, expiration: credentials.expiration }
      : 'none');
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

// Maximum query characters accepted by a Retrieve request against a managed
// knowledge base, per the managed knowledge base service quotas.
const MANAGED_KB_MAX_QUERY_CHARS = 10000;

// Chunks requested per query. The service default is 5, which is too little context
// for good answers; a managed knowledge base reranks results before returning them,
// so a moderate number here gives better grounding without bloating the prompt.
const MANAGED_KB_NUMBER_OF_RESULTS = 20;

// Managed knowledge bases report S3 locations as percent-encoded HTTPS URLs, while
// customer-managed ones use s3://bucket/key. Normalizing here keeps citations in a
// single canonical shape for display, presigning, and persisted conversation history.
const normalizeRetrievedLocation = (location) => {
  const uri = location?.s3Location?.uri;
  if (!uri) return location;
  return { ...location, s3Location: { ...location.s3Location, uri: toCanonicalS3Uri(uri) } };
};

const referenceUri = (location) =>
  location?.s3Location?.uri ||
  location?.webLocation?.url ||
  location?.confluenceLocation?.url ||
  location?.sharePointLocation?.url ||
  location?.kendraDocumentLocation?.uri ||
  location?.customDocumentLocation?.id;

// Renders the app's knowledge base prompt template by substituting the retrieved
// context and the user's question. $output_format_instructions$ is a
// RetrieveAndGenerate-only placeholder, so it is stripped here (the repo's default
// template also contains it without the closing '$', so both forms are handled).
const renderKnowledgeBasePrompt = (template, searchResults, query) => {
  const hasResultsPlaceholder = template.includes('$search_results$');
  let rendered = template
    .split('$search_results$').join(searchResults)
    .split('$query$').join(query)
    .split('$output_format_instructions$').join('')
    .split('$output_format_instructions').join('')
    .trim();

  // If a custom template omits the placeholders, still supply the context.
  if (!hasResultsPlaceholder) {
    rendered = `${rendered}\n\nContext from the knowledge base:\n${searchResults}\n\nQuestion: ${query}`;
  }
  return rendered;
};

/**
 * RAG for an Amazon Bedrock Managed Knowledge Base.
 *
 * Managed knowledge bases do not support RetrieveAndGenerate or
 * RetrieveAndGenerateStream ("This operation is not supported for managed knowledge
 * bases"); the supported retrieval operations are Retrieve and AgenticRetrieveStream.
 * This performs the retrieve step against the knowledge base and then runs generation
 * client-side through ConverseStream, which keeps the app's model selection, persona
 * system prompt, conversation history, guardrail config, file attachments, streaming,
 * and token accounting working exactly as they do for the other vector stores.
 *
 * Citations are built from the retrieval results. Because generation happens here
 * rather than inside Bedrock, there is no span-level attribution, so the citation bar
 * lists source documents without inline highlight spans.
 */
const invokeManagedKbRetrieveAndGenerateStream = async (prompt, files, sessionId, credentials, modelId, conversationHistory, onChunk, systemPrompt) => {
  const agentRuntimeClient = new BedrockAgentRuntimeClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgentRuntime && { endpoint: vpceEndpoints.bedrockAgentRuntime })
  });

  let queryText = prompt;
  if (files && files.length > 0) {
    queryText = `${prompt}\n\nReference files: ${files.map(file => file.name).join(', ')}`;
  }
  const retrievalQueryText = queryText.slice(0, MANAGED_KB_MAX_QUERY_CHARS);

  if (config.debug) {
    console.log('=== MANAGED KB RETRIEVE ===');
    console.log('Knowledge base:', sanitizeForLog(bedrockConfig.knowledgeBaseId));
  }

  // Managed knowledge bases take managedSearchConfiguration; vectorSearchConfiguration
  // is rejected with "not supported for managed knowledge bases". Without an explicit
  // numberOfResults the service returns only 5 chunks, which is thin context for RAG.
  const retrieveResponse = await agentRuntimeClient.send(new RetrieveCommand({
    knowledgeBaseId: bedrockConfig.knowledgeBaseId,
    retrievalQuery: { text: retrievalQueryText },
    retrievalConfiguration: {
      managedSearchConfiguration: { numberOfResults: MANAGED_KB_NUMBER_OF_RESULTS }
    }
  }));

  const results = retrieveResponse.retrievalResults || [];

  if (config.debug) {
    console.log(`Retrieved ${results.length} result(s)`);
  }

  const searchResults = results.length
    ? results
        .map((result, index) => {
          const uri = referenceUri(result.location);
          let label = `Source ${index + 1}`;
          if (uri) {
            try {
              label = decodeURIComponent(uri).split('/').pop() || uri;
            } catch {
              label = uri.split('/').pop() || uri;
            }
          }
          return `[${index + 1}] ${label}\n${result.content?.text ?? ''}`;
        })
        .join('\n\n')
    : 'No relevant information was found in the knowledge base.';

  const basePromptTemplate = bedrockConfig.defaultPrompt || `You are a helpful assistant. Use the following context from the knowledge base to answer the question.

$search_results$

Question: $query$

Instructions:
- Answer the question based on the context provided above
- If the information needed to answer the question is not found in the context, respond with: "Sorry, I don't have information in my knowledge base to answer that question."
- Be accurate and provide as much supporting information as possible in your responses`;

  const generationPrompt = renderKnowledgeBasePrompt(basePromptTemplate, searchResults, queryText);

  // Generation reuses the existing ConverseStream path so guardrails, file handling,
  // usage metrics, and chunk streaming behave identically to general chat.
  const converseResult = await invokeBedrockConverseStreamCommand(
    generationPrompt,
    files,
    credentials,
    modelId,
    conversationHistory,
    onChunk,
    systemPrompt
  );

  const citations = results.length
    ? [{
        retrievedReferences: results.map(result => ({
          content: result.content,
          location: normalizeRetrievedLocation(result.location),
          metadata: result.metadata
        }))
      }]
    : [];

  return {
    body: converseResult.body,
    conversationHistory: converseResult.conversationHistory,
    citations,
    // Retrieve is stateless, so the caller's existing RAG session id is preserved.
    sessionId,
    usage: converseResult.usage,
    // Shaped so the caller's existing token-usage extraction keeps working.
    fullResponse: {
      metrics: {
        inputTokenCount: converseResult.usage?.inputTokens || 0,
        outputTokenCount: converseResult.usage?.outputTokens || 0
      }
    }
  };
};

export const invokeBedrockRetrieveAndGenerateStreamCommand = async (prompt, files, sessionId, credentials, modelId, conversationHistory = [], onChunk, systemPrompt = null) => {
  if (!credentials) {
    throw new Error('Credentials not provided');
  }

  if (config.debug) console.log('Model ID:', sanitizeForLog(modelId))

  // Managed knowledge bases reject RetrieveAndGenerateStream, so they take the
  // Retrieve + client-side generation path instead.
  if (isManagedKnowledgeBase()) {
    try {
      return await invokeManagedKbRetrieveAndGenerateStream(prompt, files, sessionId, credentials, modelId, conversationHistory, onChunk, systemPrompt);
    } catch (error) {
      console.error('Error invoking Bedrock:', error);
      throw error;
    }
  }
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
  // IMPORTANT: $output_format_instructions$ is REQUIRED for citations to work
  const basePromptTemplate = bedrockConfig.defaultPrompt || `You are a helpful assistant. Use the following context from the knowledge base to answer the question.

$search_results$

Question: $query$

Instructions:
- Answer the question based on the context provided above
- If the information needed to answer the question is not found in the context, respond with: "Sorry, I don't have information in my knowledge base to answer that question."
- Be accurate and provide as much supporting information as possible in your responses

$output_format_instructions`;

  // If a system prompt (persona) is provided, prepend it to the template
  const defaultPromptTemplate = systemPrompt
    ? `${systemPrompt}\n\n${basePromptTemplate}`
    : basePromptTemplate;

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
            textPromptTemplate: defaultPromptTemplate,
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
      console.log('=== RAG REQUEST START ===');
      console.log('Sending request to Bedrock:', JSON.stringify(input, null, 2));
    }

    const command = new RetrieveAndGenerateStreamCommand(input);
    const response = await bedrockClient.send(command);
    
    let responseText = '';
    let citations = [];
    let eventCount = 0;
    let outputEventCount = 0;
    let citationEventCount = 0;

    for await (const event of response.stream) {
      eventCount++;
      if(config.debug) {
        console.log(`Event #${eventCount}:`, JSON.stringify(event, null, 2));
      }
      if (event.output) {
        outputEventCount++;
        const chunkText = event.output.text;
        responseText += chunkText;
        
        if (onChunk) {
          onChunk(chunkText);
        }
      }
      if (event.citation) {
        citationEventCount++;
        if (config.debug) {
          console.log(`🔍 CITATION EVENT #${citationEventCount} FOUND:`, JSON.stringify(event.citation, null, 2));
        }
        // CitationEvent has retrievedReferences at both event.citation.citation
        // and event.citation level. Normalize into a consistent shape.
        const citationEvent = event.citation;
        const innerCitation = citationEvent.citation;
        citations.push({
          generatedResponsePart: innerCitation?.generatedResponsePart || citationEvent.generatedResponsePart,
          retrievedReferences: innerCitation?.retrievedReferences || citationEvent.retrievedReferences || [],
        });
        if (config.debug) {
          console.log(`✅ Citations array now has ${citations.length} items`);
        }
      }
    }

    if(config.debug) {
      console.log('=== RAG RESPONSE COMPLETE ===');
      console.log(`Total events: ${eventCount}`);
      console.log(`Output events: ${outputEventCount}`);
      console.log(`Citation events: ${citationEventCount}`);
      console.log('Response object:', response);
      console.log('FINAL CITATIONS COUNT:', citations.length);
      if (citations.length > 0) {
        console.log('FINAL CITATIONS:', JSON.stringify(citations, null, 2));
      } else {
        console.log('⚠️ NO CITATIONS WERE FOUND IN THE STREAM');
      }
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

export const invokeBedrockConverseStreamCommand = async (prompt, files, credentials, modelId, conversationHistory = [], onChunk, systemPrompt = null) => {
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
    const imageFormats = ['png', 'jpeg', 'jpg', 'gif', 'webp'];
    const documentFormats = ['txt', 'pdf', 'doc', 'docx', 'csv', 'md', 'html', 'xls', 'xlsx'];

    for (const file of files) {
      const fileContent = await file.arrayBuffer();
      const fileBytes = new Uint8Array(fileContent);
      let format = file.name.split('.').pop().toLowerCase();
      
      if (imageFormats.includes(format)) {
        // Normalize 'jpg' to 'jpeg' for the Bedrock API
        const imageFormat = format === 'jpg' ? 'jpeg' : format;
        content.push({
          image: {
            format: imageFormat,
            source: {
              bytes: fileBytes
            }
          }
        });
      } else if (documentFormats.includes(format)) {
        const sanitizedName = file.name
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9\s\-\(\)\[\]]/g, "-")
          .replace(/\s+/g, " ")
          .trim();

        content.push({
          document: {
            name: sanitizedName,
            format: format,
            source: {
              bytes: fileBytes
            }
          }
        });
      } else {
        throw new Error(`Unsupported file format: ${format}`);
      }
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

    const commandInput = {
      modelId,
      messages: messages.map(msg => ({
        role: msg.role,
        content: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }]
      })),
      ...(systemPrompt && {
        system: [{ text: systemPrompt }]
      }),
      guardrailConfig: bedrockConfig.useGuardrail ? { // GuardrailStreamConfiguration
        guardrailIdentifier: bedrockConfig.guardrailId, // from aws-config.js
        guardrailVersion: bedrockConfig.guardrailVersion, // from aws-config.js
        trace: "enabled",
        streamProcessingMode: "sync",
      } : undefined,
    };

    if (config.debug) {
      console.log('=== CONVERSE STREAM REQUEST ===');
      console.log('ConverseStreamCommand input:', JSON.stringify(commandInput, null, 2));
    }

    const command = new ConverseStreamCommand(commandInput);

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
      
// An Amazon Bedrock Managed Knowledge Base owns its vector store and uses the
// connector-based data source API (MANAGED_KNOWLEDGE_BASE_CONNECTOR) instead of the
// self-managed per-source shapes such as webConfiguration. The AWS documentation is
// currently inconsistent about the web connector's type discriminator: the "Connect a
// data source" page lists WEB_CRAWLER while the Web Crawler connector page says to use
// WEB. Both are attempted, in documented-for-this-connector order, so the feature keeps
// working whichever value the API accepts.
const MANAGED_WEB_CONNECTOR_TYPES = ["WEB", "WEB_CRAWLER"];

// Self-managed crawl scopes map onto the managed connector's syncScope values.
const MANAGED_SYNC_SCOPE_BY_SCOPE = {
  HOST_ONLY: "DOMAINS_ONLY",
  SUBDOMAINS: "SUB_DOMAINS"
};

const waitForDataSourceAvailable = async (client, dataSourceId, { attempts = 60, intervalMs = 5000 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { dataSource } = await client.send(new GetDataSourceCommand({
      knowledgeBaseId: bedrockConfig.knowledgeBaseId,
      dataSourceId
    }));

    if (dataSource?.status === "AVAILABLE") {
      return;
    }
    if (dataSource?.status === "CREATE_FAILED") {
      throw new Error(`Data source creation failed: ${dataSource.failureReasons?.join("; ") || "no reason provided"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Data source did not become available in time. The crawl can be started later from the knowledge base sync action.");
};

const buildSelfManagedWebConfiguration = (websiteUrl, inclusionFilters, exclusionFilters, scope, rateLimit, maxPages) => ({
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
});

const buildManagedWebConfiguration = (connectorType, websiteUrl, inclusionFilters, exclusionFilters, scope, rateLimit, maxPages) => {
  const crawlConfiguration = {
    syncScope: MANAGED_SYNC_SCOPE_BY_SCOPE[scope] || MANAGED_SYNC_SCOPE_BY_SCOPE.SUBDOMAINS
  };

  // The managed connector has no total-pages cap, so the closest equivalent to the
  // self-managed maxPages limit is the per-URL link limit (valid range 1-1000).
  if (maxPages) {
    crawlConfiguration.maxLinksPerUrl = Math.min(Math.max(Number(maxPages), 1), 1000);
  }
  // Managed rate limiting is expressed per minute (valid range 1-300).
  if (rateLimit) {
    crawlConfiguration.maxCrawledUrlsPerMinute = Math.min(Math.max(Number(rateLimit), 1), 300);
  }

  return {
    type: "MANAGED_KNOWLEDGE_BASE_CONNECTOR",
    managedKnowledgeBaseConnectorConfiguration: {
      connectorParameters: {
        type: connectorType,
        version: "1",
        connectionConfiguration: {
          seedUrls: [websiteUrl],
          authType: "NO_AUTH"
        },
        crawlConfiguration,
        filterConfiguration: {
          inclusionPatterns: inclusionFilters?.length ? inclusionFilters : [".*"],
          exclusionPatterns: exclusionFilters?.length ? exclusionFilters : [".*\\.pdf"]
        }
      }
    }
  };
};

export const addWebsiteToCrawl = async (websiteUrl, inclusionFilters, exclusionFilters, scope, rateLimit, maxPages, credentials) => {
  const client = new BedrockAgentClient({
    region: bedrockConfig.region,
    credentials: credentials,
    ...(vpceEndpoints.bedrockAgent && { endpoint: vpceEndpoints.bedrockAgent })
  });

  // Create a sanitized name from the website URL that matches the required pattern ([0-9a-zA-Z][_-]?){1,100}
  const sanitizedName = websiteUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 90);

  // A managed knowledge base needs the connector shape; every other vector store
  // (OpenSearch Serverless, S3 Vectors) uses the self-managed web configuration.
  const candidateConfigurations = isManagedKnowledgeBase()
    ? MANAGED_WEB_CONNECTOR_TYPES.map((connectorType) =>
        buildManagedWebConfiguration(connectorType, websiteUrl, inclusionFilters, exclusionFilters, scope, rateLimit, maxPages))
    : [buildSelfManagedWebConfiguration(websiteUrl, inclusionFilters, exclusionFilters, scope, rateLimit, maxPages)];

  let dataSource;
  let lastError;

  for (const dataSourceConfiguration of candidateConfigurations) {
    try {
      const createResponse = await client.send(new CreateDataSourceCommand({
        knowledgeBaseId: bedrockConfig.knowledgeBaseId,
        name: `Web${sanitizedName}`,
        dataSourceConfiguration
      }));
      dataSource = createResponse.dataSource;
      break;
    } catch (e) {
      lastError = e;
      // Only fall through to the next candidate connector type when the API rejected
      // the request as invalid. Anything else (access denied, throttling, conflict)
      // will not be fixed by changing the discriminator.
      if (e.name !== "ValidationException") {
        break;
      }
    }
  }

  if (!dataSource) {
    console.error("Error adding website to crawl:", sanitizeForLog(lastError?.message ?? "unknown error"));
    throw lastError;
  }

  try {
    // CreateDataSource is asynchronous for managed knowledge bases: the data source
    // reports CREATING for a while and StartIngestionJob is rejected until it reaches
    // AVAILABLE. Self-managed data sources are usable immediately.
    if (isManagedKnowledgeBase()) {
      await waitForDataSourceAvailable(client, dataSource.dataSourceId);
    }

    // Start an ingestion job to crawl the website
    const ingestionResponse = await client.send(new StartIngestionJobCommand({
      knowledgeBaseId: bedrockConfig.knowledgeBaseId,
      dataSourceId: dataSource.dataSourceId
    }));

    return {
      dataSourceId: dataSource.dataSourceId,
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
    
    // Filter out LEGACY models
    const activeFoundationModels = (foundationModelsResponse.modelSummaries || []).filter(
      model => model.modelLifecycle?.status !== 'LEGACY'
    );

    // Merge the lists
    const allModels = [
      ...activeFoundationModels,
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
      return {
        modelSummaries: (response.modelSummaries || []).filter(
          model => model.modelLifecycle?.status !== 'LEGACY'
        )
      };
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