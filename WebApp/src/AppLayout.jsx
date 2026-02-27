// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext, useRef } from 'react';
import { signOut, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { CredentialsContext } from './SessionContext';
import "@cloudscape-design/global-styles/index.css"
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import {
  AppLayout,
  Container,
  ContentLayout,
  Icon,
  Header,
  Link,
  SideNavigation,
  SpaceBetween,
  TopNavigation,
  Box,
  StatusIndicator,
  Button,
  Modal
} from '@cloudscape-design/components';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import messages from '@cloudscape-design/components/i18n/messages/all.en';
import ChatUI from './ChatUI';
import S3Upload from './S3Upload';
import WebsiteCrawler from './WebsiteCrawler';
import PersonaManager from './PersonaManager';

import './Layout.css';
import AWS_Logo from './images/AWS.png';
import { getBedrockModels, getBedrockAgentModel, setBedrockAgentModel, updateBedrockAgentModel } from './bedrockAgent';
import KbSync from './KbSync';
import AgentInstructions from './AgentInstructions';
import { bedrockConfig, config } from './aws-config';
import { convHistory } from './ConvHistory';
import pricingData from './bedrock_pricing.json';

applyMode(Mode.Dark);

function Layout() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [logo, setLogo] = useState(AWS_Logo);
  const [s3UploadVisible, setS3UploadVisible] = useState(false);
  const [kbSyncStatusVisible, setKbSyncStatusVisible] = useState(false);
  const [instructionsVisible, setInstructionsVisible] = useState(false);
  const [websiteCrawlerVisible, setWebsiteCrawlerVisible] = useState(false);
  const [personaManagerVisible, setPersonaManagerVisible] = useState(false);
  const [activeModalTitle, setActiveModalTitle] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(true);
  const credentials = useContext(CredentialsContext);
  const [topNavModels, setTopNavModels] = useState([]);
  const [foundationModels, setFoundationModels] = useState([]);
  const [chatTypes, setChatTypes] = useState([
    { id: 'RAG', text: 'Bedrock Knowledge Base Chat (RAG)' },
    { id: 'LLM', text: 'General Chat' }
  ]);
  const [chatType, setChatType] = useState(bedrockConfig.defaultChatType);
  const [modelId, setModelId] = useState(bedrockConfig.defaultModelId);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [mode, setMode] = useState("Dark");
  const [personaRefreshTrigger, setPersonaRefreshTrigger] = useState(0);

  const chatUIRef = useRef(null);
  const appLayoutRef = useRef(null);

  // Handle persona changes from PersonaManager
  const handlePersonaChange = () => {
    // Increment the refresh trigger to notify PersonaSelector to reload
    if (config.debug) console.log('PersonaManager triggered persona change, incrementing refresh trigger');
    setPersonaRefreshTrigger(prev => prev + 1);
  };


  const loadSessionHistory = async (sessionID, userID) => {
    try {
      if(config.debug) {
        console.log('Loading session history for:', sessionID, userID);
      }
      const sessionHistory = await convHistory.loadSessionHistory(userID, sessionID, credentials);
      if(config.debug) {
        console.log('Loaded session history:', sessionHistory);
      }

      // Extract model ID, chat type, and persona from history (if available)
      const historyModelId = sessionHistory.length > 0 ? sessionHistory[0].modelId : null;
      const historyChatType = sessionHistory.length > 0 ? sessionHistory[0].chatType : null;
      const historyPersonaId = sessionHistory.length > 0 ? sessionHistory[0].personaId : null;
  
      const formattedMessages = [];
      sessionHistory.forEach(msg => {
        formattedMessages.push({
          role: 'user',
          content: [{ text: msg.question }],
          timestamp: msg.timestamp
        });
  
        if (msg.response) {
          formattedMessages.push({
            role: 'assistant',
            content: [{ text: msg.response }],
            timestamp: msg.timestamp
          });
        }
      });
  
      if(config.debug) {
        console.log('Formatted messages with Q&A:', formattedMessages);
      }
  
      if (chatUIRef.current) {
        chatUIRef.current.updateState(formattedMessages, sessionID, historyModelId, historyChatType, historyPersonaId);
      }
    } catch (error) {
      console.error('Error loading session history:', error);
    }
  
  };

  const handleDeleteConversation = async (sessionID) => {
    try {
      // Call the delete function from convHistory.js
      await convHistory.deleteSessionHistory(email, sessionID, credentials);
      
      // Update the local state to remove the deleted conversation
      setConversationHistory(prevHistory => 
        prevHistory.filter(item => item.sessionID !== sessionID)
      );
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  useEffect(() => {
    async function fetchConversationHistory() {
      try {
        const user = await getCurrentUser();
        const attributes = await fetchUserAttributes();
        const userEmail = attributes.email;
  
        if(config.debug) {
          console.log('Fetching conversation history for user:', userEmail);
        }
        
        const history = await convHistory.loadUserHistory(userEmail, credentials);
        if(config.debug) {
          console.log('Fetched conversation history:', history);
        }
        
        if (Array.isArray(history) && history.length > 0) {
          if(config.debug) {
            console.log('Setting conversation history:', history);
          }
          setConversationHistory(history);
        } else {
          if(config.debug) {
            console.log('No conversation history found or empty history array');
          }
        }
      } catch (error) {
        console.error('Error fetching conversation history:', error);
      }
    }
  
    if (credentials) {
      fetchConversationHistory();
    }
  }, [credentials]);

  useEffect(() => {
    async function populateTopNavModels() {
      try {
        const models = await getBedrockModels(credentials);
        setFoundationModels(models.modelSummaries);
        const formattedModels = models.modelSummaries.map(model => ({
          id: model.modelId,
          text: `${model.providerName} ${model.modelName}: ${model.modelId}`
        }));
        
        // Add default model if not in the list
        const defaultModelExists = formattedModels.some(model => model.id === bedrockConfig.defaultModelId);
        if (!defaultModelExists) {
          formattedModels.push({
            id: bedrockConfig.defaultModelId,
            text: `${bedrockConfig.defaultModelProvider} ${bedrockConfig.defaultModelName}: ${bedrockConfig.defaultModelId}`
          });
        }
        
        formattedModels.sort((a, b) => a.text.localeCompare(b.text));
        setTopNavModels(formattedModels);
        if(config.debug) {
          console.log('Fetched models:', models.modelSummaries);
        }
      } catch (error) {
        console.error('Error:', error);
      }
    }
    populateTopNavModels();
  }, [credentials]);

  useEffect(() => {
    async function fetchUsername() {
      try {
        const user = await getCurrentUser();
        const attributes = await fetchUserAttributes();
        setEmail(attributes.email);
        setUsername(attributes.email);
      } catch (error) {
        console.error('Error fetching user:', error);
      }
    }
    fetchUsername();
  }, []);

  function toggleS3Uploader() {
    setS3UploadVisible(!s3UploadVisible);
    setActiveModalTitle(s3UploadVisible ? "" : "Upload Documents to S3");
  }

  function toggleKbSyncStatus() {
    setKbSyncStatusVisible(!kbSyncStatusVisible);
    setActiveModalTitle(kbSyncStatusVisible ? "" : "Sync Bedrock Knowledge Base");
  }

  function toggleInstructions() {
    setInstructionsVisible(!instructionsVisible);
    setActiveModalTitle(instructionsVisible ? "" : "Update Bedrock Agent Instructions");
  }
  
  function toggleWebsiteCrawler() {
    setWebsiteCrawlerVisible(!websiteCrawlerVisible);
    setActiveModalTitle(websiteCrawlerVisible ? "" : "Add Website to Knowledge Base");
  }

  function togglePersonaManager() {
    setPersonaManagerVisible(!personaManagerVisible);
    setActiveModalTitle(personaManagerVisible ? "" : "Manage AI Personas");
  }

  function processRequest(href) {
    // Close any open modals first
    setS3UploadVisible(false);
    setKbSyncStatusVisible(false);
    setInstructionsVisible(false);
    setWebsiteCrawlerVisible(false);
    setPersonaManagerVisible(false);
    
    if (typeof href === 'string') {
      href = href.toLowerCase();
      if (href.includes('upload')) {
        toggleS3Uploader();
      } else if (href.includes('sync')) {
        toggleKbSyncStatus();
      } else if (href.includes('instructions')) {
        toggleInstructions();
      } else if (href.includes('crawl')) {
        toggleWebsiteCrawler();
      } else if (href.includes('personas')) {
        togglePersonaManager();
      }
    }
  }

  function handleNavigationChange() {
    setNavigationOpen(!navigationOpen);
  }

  async function handleSignOut() {
    try {
      await signOut();
      window.location.href = '/';
    } catch (error) {
      console.error('error signing out: ', error);
    }
  }

  // Function to calculate total tokens and cost for a session
  const calculateSessionTokens = (sessionID) => {
    const sessionMessages = conversationHistory.filter(msg => msg.sessionID === sessionID);
    const totalInputTokens = sessionMessages.reduce((sum, msg) => sum + (msg.inputTokens || 0), 0);
    const totalOutputTokens = sessionMessages.reduce((sum, msg) => sum + (msg.outputTokens || 0), 0);
    
    // Get the model ID from the first message (assuming all messages in a session use the same model)
    const modelId = sessionMessages.length > 0 ? sessionMessages[0].modelId : null;
    
    if (config.debug) {
      console.log('Session ID:', sessionID);
      console.log('Session messages:', sessionMessages);
      console.log('Model ID from session:', modelId);
    }
    
    // Get pricing data to calculate cost based on total tokens
    let totalCost = 0;
    let currency = 'USD';
    
    if (modelId) {
      // Extract model family and name
      let modelFamily = null;
      let modelName = null;
      
      if (modelId.includes('anthropic')) {
        modelFamily = 'anthropic';
        
        if (modelId.includes('sonnet')) {
          modelName = 'claude-3-sonnet';
        } else if (modelId.includes('opus')) {
          modelName = 'claude-3-opus';
        } else if (modelId.includes('haiku')) {
          modelName = 'claude-3-haiku';
        }
      }
      
      // Get pricing if model is identified
      if (modelFamily && modelName) {
        try {
          const pricing = pricingData.models[modelFamily][modelName];
          if (pricing) {
            // Calculate cost based on total tokens
            const inputCost = (totalInputTokens / 1000) * pricing.input.price;
            const outputCost = (totalOutputTokens / 1000) * pricing.output.price;
            totalCost = inputCost + outputCost;
            currency = pricing.input.currency;
            
            if (config.debug) {
              console.log('Found pricing data:', pricing);
              console.log('Input cost:', inputCost);
              console.log('Output cost:', outputCost);
              console.log('Total cost:', totalCost);
            }
          }
        } catch (error) {
          console.error('Error calculating cost:', error);
        }
      }
    }
    
    if (config.debug) {
      console.log('Session messages count:', sessionMessages.length);
      console.log('Total input tokens:', totalInputTokens);
      console.log('Total output tokens:', totalOutputTokens);
      console.log('Calculated total cost:', totalCost);
    }
    
    // Always show a cost for demonstration purposes
    const displayCost = totalCost > 0 ? totalCost : 0.0025;
    
    return { 
      inputTokens: totalInputTokens, 
      outputTokens: totalOutputTokens,
      totalCost: displayCost,
      currency
    };
  };

  return (
    <div className="layout-wrapper">
      <div className="sticky-top-nav">
      <TopNavigation
        identity={{
          href: "#",
          title: "Amazon Bedrock Chatbot powered by AWS",
          logo: { src: logo, alt: "Amazon Web Services" }
        }}
        utilities={[
          {
            type: "button",
            text: "Amazon Bedrock",
            href: "https://aws.amazon.com/bedrock/",
            external: true,
            externalIconAriaLabel: " (opens in a new tab)"
          },
          {
            type: "button",
            text: mode === "Light" ? "Dark Mode" : "Light Mode",
            iconName: "darkmode",
            title: mode === "Light" ? "Dark Mode" : "Light Mode",
            ariaLabel: `Toggle ${mode === "Light" ? "Dark" : "Light"} Mode`,
            iconSvg: moonIcon(),
            disableUtilityCollapse: true,
            onClick: () => {
              if(mode === "Light") {
                setMode("Dark");
                applyMode(Mode.Dark);
              } else {
                setMode("Light")
                applyMode(Mode.Light);
              }
            }
          },
          {
            type: "menu-dropdown",
            text: email || "User",
               description: email,
            iconName: "user-profile",
            items: [
              { id: "signout", text: "Sign out"}
            ],
            onItemClick: ({ detail }) => {
              if(detail.id === "signout") {
                handleSignOut();
              }
            }
          }
        ]}
      />
      </div>
      <I18nProvider locale="en" messages={[messages]}>
        <AppLayout
          ref={appLayoutRef}
          navigationOpen={navigationOpen}
          navigationWidth={300}
          onNavigationChange={handleNavigationChange}
          disableContentPaddings={true}
          toolsHide={true}
          navigation={
            <SideNavigation
              // header={{
              //   href: '#',
              //   text: 'Knowledge Base Updates',
              // }}
              onFollow={event => {
                event.preventDefault();
                const href = event.detail.href;
                const id = event.detail.id;

                if (!event.detail.external) {
                  processRequest(href);
                  
                  if (id) {
                    const historyItem = conversationHistory.find(item => item.sessionID === id);
                    if (historyItem) {
                      loadSessionHistory(historyItem.sessionID, historyItem.userID);
                    }
                  }
                }
              }}
              items={[
                { 
                  type: 'section', 
                  text: 'Knowledge Base Updates', 
                  items: [
                    { type: 'link', text: `Upload documents to S3`, href: `upload` },
                    { type: 'link', text: `Add website to crawl`, href: `crawl` },
                    { type: 'link', text: `Sync Bedrock Knowledge Base`, href: `sync` },
                    { type: 'link', text: `Update Bedrock Agent Instructions`, href: `instructions` }
                  ]
                },
                { 
                  type: 'section', 
                  text: 'Personas', 
                  items: [
                    { type: 'link', text: `Manage AI Personas`, href: `personas` }
                  ]
                },
                // In the SideNavigation items array, update the conversation history section:
                { 
                  type: 'section', 
                  text: 'Conversation History',
                  items: (() => {
                    if (!conversationHistory) return [];

                    const sessionMap = new Map();
                    
                    try {
                      const sortedHistory = [...conversationHistory].sort((a, b) => 
                        (a.timestamp || 0) - (b.timestamp || 0)
                      );
                      
                      sortedHistory.forEach(message => {
                        if (message && message.sessionID) {
                          if (!sessionMap.has(message.sessionID)) {
                            sessionMap.set(message.sessionID, message);
                          }
                        }
                      });

                      const sortedSessions = Array.from(sessionMap.values())
                        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                      
                      // Add a dummy spacer item at the end
                      const result = sortedSessions.map(message => {
                          if (!message || !message.question || !message.timestamp) {
                            return null;
                          }

                          // Calculate token counts and cost for this session
                          const { inputTokens, outputTokens, totalCost, currency } = calculateSessionTokens(message.sessionID);
                          const totalTokens = inputTokens + outputTokens;

                          return {
                            type: 'link',
                            text: (
                              <div style={{
                                backgroundColor: mode === "Dark" ? '#232f3e' : '#f2f3f3',
                                border: '1px solid #414d5c',
                                borderRadius: '4px',
                                margin: '4px 0',
                              }}>
                                <Box padding="xs">
                                  <SpaceBetween size="xxs" direction="horizontal" alignItems="center">
                                    <div style={{ flex: 1 }}>
                                      <SpaceBetween size="xxs">
                                        <div style={{ 
                                          borderLeft: '3px solid #0972d3',
                                          paddingLeft: '8px',
                                          wordBreak: 'break-word',
                                          cursor: 'pointer',
                                          fontWeight: 'bold'
                                        }}>
                                          {message.question.length > 50 
                                            ? `${message.question.substring(0, 47)}...` 
                                            : message.question}
                                            <Button
                                              variant="icon"
                                              iconName="remove"
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleDeleteConversation(message.sessionID);
                                              }}
                                            />
                                        </div>
                                        
                                        <div style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          fontSize: '0.8rem',
                                          color: mode === "Dark" ? '#d1d5db' : '#5f6b7a',
                                        }}>
                                          <StatusIndicator type="info">
                                            {new Date(message.timestamp).toLocaleString()}
                                          </StatusIndicator>
                                          {/* Commented out total cost row as per model pricing is not currently dynamically retrievable and could cause confusion */}
                                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', width: '100%', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                              <span style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center' }}>Estimated Tokens:</span>
                                              <span title="Input tokens" style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center' }}>⬆️ {inputTokens}</span>
                                              <span title="Output tokens" style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center' }}>⬇️ {outputTokens}</span>
                                              {/* <span title="Total cost" style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', marginLeft: '8px' }}>💰 ${totalCost.toFixed(2)}</span> */}
                                            </div>
                                          </div>
                                        </div>
                                      </SpaceBetween>
                                    </div>
                                  </SpaceBetween>
                                </Box>
                              </div>
                            ),
                            href: `#session-${message.sessionID}`,
                            id: message.sessionID
                          };
                        })
                        .filter(Boolean);
                      
                      // Add a spacer item at the end
                      if (result.length > 0) {
                        result.push({
                          type: 'link',
                          text: <div style={{ height: '20px' }}></div>,
                          href: '#spacer',
                          id: 'spacer'
                        });
                      }
                      
                      return result;
                    } catch (error) {
                      console.error('Error processing conversation history:', error);
                      return [];
                    }
                  })()
                }
              ]}
            />

          }
          content={
            <ContentLayout
              disableContentPaddings={true}
              header={
                <SpaceBetween size="none">
                  {/* <Header variant="h1" actions={<img src={logo} alt="Logo" />}>
                    Generative AI Chatbot
                  </Header> */}
                </SpaceBetween>
              }
            >
              <SpaceBetween size="s">
                <Modal
                  visible={s3UploadVisible}
                  onDismiss={() => setS3UploadVisible(false)}
                  header={activeModalTitle}
                  size="large"
                >
                  <S3Upload />
                </Modal>

                <Modal
                  visible={kbSyncStatusVisible}
                  onDismiss={() => setKbSyncStatusVisible(false)}
                  header={activeModalTitle}
                  size="large"
                >
                  <KbSync />
                </Modal>

                <Modal
                  visible={instructionsVisible}
                  onDismiss={() => setInstructionsVisible(false)}
                  header={activeModalTitle}
                  size="large"
                >
                  <AgentInstructions />
                </Modal>

                <Modal
                  visible={websiteCrawlerVisible}
                  onDismiss={() => setWebsiteCrawlerVisible(false)}
                  header={activeModalTitle}
                  size="large"
                >
                  <WebsiteCrawler />
                </Modal>

                <Modal
                  visible={personaManagerVisible}
                  onDismiss={() => setPersonaManagerVisible(false)}
                  header={activeModalTitle}
                  size="max"
                >
                  <PersonaManager onPersonasChange={handlePersonaChange} />
                </Modal>
                <div className="chat-ui-wrapper" style={{ flex: 1, width: 'calc(100% - 30px)', margin: '0 15px', overflow: 'auto', maxHeight: 'calc(100vh - 50px)' }}>
                  <ChatUI
                    ref={chatUIRef}
                    chatType={chatType}
                    setChatType={setChatType}
                    chatTypes={chatTypes}
                    modelId={modelId}
                    setModelId={setModelId}
                    topNavModels={topNavModels}
                    foundationModels={foundationModels}
                    conversationHistory={conversationHistory}
                    setConversationHistory={setConversationHistory}
                    username={username}
                    navigationOpen={navigationOpen}
                    personaRefreshTrigger={personaRefreshTrigger}
                  />
                </div>
              </SpaceBetween>
            </ContentLayout>
          }
        />
      </I18nProvider>
    </div>
  );
}

function moonIcon() {
  return (
    <Icon
      svg={
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12.8166 9.79921C12.8417 9.75608 12.7942 9.70771 12.7497 9.73041C11.9008 10.164 10.9392 10.4085 9.92054 10.4085C6.48046 10.4085 3.69172 7.61979 3.69172 4.17971C3.69172 3.16099 3.93628 2.19938 4.36989 1.3504C4.39259 1.30596 4.34423 1.25842 4.3011 1.28351C2.44675 2.36242 1.2002 4.37123 1.2002 6.67119C1.2002 10.1113 3.98893 12.9 7.42901 12.9C9.72893 12.9 11.7377 11.6535 12.8166 9.79921Z"
            fill="white"
            stroke="white"
            strokeWidth="2"
            className="filled"
          />
        </svg>
      }
    />
  );
}

export default Layout;