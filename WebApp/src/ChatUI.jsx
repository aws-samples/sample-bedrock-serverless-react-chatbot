// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { CredentialsContext } from './SessionContext';
import { fetchAuthSession, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { convHistory } from './ConvHistory';
import { bedrockConfig, config, vpceEndpoints } from './aws-config';

// Markdown processing
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

// Syntax highlighting
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { coldarkDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Cloudscape components
import {
  Button,
  Container,
  FileInput,
  Icon,
  SpaceBetween,
  Box,
  Popover,
  Header,
  ButtonGroup,
  StatusIndicator,
  Select
} from '@cloudscape-design/components';
import { useContainerQuery } from '@cloudscape-design/component-toolkit';
import FileDropzone, {
  useFilesDragging
} from "@cloudscape-design/components/file-dropzone";
import FileTokenGroup from "@cloudscape-design/components/file-token-group";
import PromptInput from "@cloudscape-design/components/prompt-input";
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import Avatar from "@cloudscape-design/chat-components/avatar";

// Custom components
import { 
  invokeBedrockAgent, 
  invokeBedrockConverseCommand,
  invokeBedrockConverseStreamCommand,
  invokeBedrockRetrieveAndGenerateStreamCommand
} from './bedrockAgent';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import PersonaSelector from './PersonaSelector';
import { PersonaService } from './PersonaService';
import { sanitizeForLog } from './utils/sanitize';
import DocumentViewer, { isViewableFile } from './DocumentViewer';
import KbStatusBanner from './KbStatusBanner';

// Styles
import '@cloudscape-design/global-styles/index.css';
import './ChatUI.css';

// CodeBlock Component
const CodeBlock = React.memo(({ inline, className, children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const isInline = !className && !String(children).includes('\n');
  
  if (isInline) {
    return <code className="inline-code">{children}</code>;
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(children));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', sanitizeForLog(err.message));
    }
  };

  return (
    <div className="code-block-wrapper">
      <SyntaxHighlighter
        language={language}
        style={coldarkDark}
        customStyle={{
          padding: '1em',
          borderRadius: '5px',
          fontSize: '14px',
          backgroundColor: '#1e1e1e',
          marginBottom: '0',
        }}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
      <div className="code-block-footer">
        <div style={{ flex: 1 }}>
          {language !== 'text' && (
            <div className="code-block-language">
              {language}
            </div>
          )}
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            padding: '6px 12px',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '4px',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Icon name={copied ? 'check' : 'copy'} />
        </button>
      </div>
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';
// MessageActions Component
const MessageActions = ({ text, timestamp, userEmail, credentials, sessionId }) => {
  const [copiedStates, setCopiedStates] = useState({});
  const [feedbackStates, setFeedbackStates] = useState({});

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [text]: true }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [text]: false }));
      }, 2000);
    } catch (err) {
      if (config.debug) console.error('Failed to copy text:', err);
    }
  };

  const handleFeedback = async (type) => {
    if (config.debug) {
      console.log('Feedback:', sanitizeForLog(type), 'for timestamp:', timestamp, 'sessionId:', sessionId);
    }

    // Save feedback to DynamoDB
    try {
      await convHistory.updateFeedback(userEmail, timestamp, type, credentials, sessionId);
      setFeedbackStates(prev => ({ ...prev, [timestamp]: type }));
      if (config.debug) {
        console.log('Feedback saved successfully');
      }
    } catch (error) {
      if (config.debug) {
        console.error('Error saving feedback:', error);
      }
    }
  };

  return (
    <ButtonGroup
      onItemClick={({ detail }) => {
        if (detail.id === 'copy') {
          handleCopy();
        } else if (detail.id === 'helpful' || detail.id === 'not-helpful') {
          handleFeedback(detail.id);
        }
      }}
      ariaLabel="Chat bubble actions"
      variant="icon"
      items={[
        {
          type: "group",
          text: "Feedback",
          items: [
            {
              type: "icon-toggle-button",
              id: "helpful",
              iconName: "thumbs-up",
              pressedIconName: "thumbs-up-filled",
              text: "Helpful",
              pressed: feedbackStates[timestamp] === 'helpful'
            },
            {
              type: "icon-toggle-button",
              id: "not-helpful",
              iconName: "thumbs-down",
              pressedIconName: "thumbs-down-filled",
              text: "Not helpful",
              pressed: feedbackStates[timestamp] === 'not-helpful'
            }
          ]
        },
        {
          type: "icon-button",
          id: "copy",
          iconName: copiedStates[text] ? "check" : "copy",
          text: "Copy",
          popoverFeedback: copiedStates[text] && (
            <StatusIndicator type="success">
              Message copied
            </StatusIndicator>
          )
        }
      ]}
    />
  );
};

// CitationBar Component
const CitationBar = ({ citations, credentials, citationChipRefs }) => {
  const [expandedRef, setExpandedRef] = useState(null);
  const [presignedUrl, setPresignedUrl] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [viewerState, setViewerState] = useState({ visible: false, fileName: '', fileUrl: null, fileUri: '', citationTexts: [] });

  if (config.debug) {
    console.log('📊 CitationBar component called');
    console.log('  - Citations prop:', citations);
    console.log('  - Citations type:', Array.isArray(citations) ? 'array' : typeof citations);
    console.log('  - Citations length:', citations?.length || 0);
  }

  if (!citations || citations.length === 0) {
    if (config.debug) {
      console.log('⚠️ CitationBar: No citations to display (returning null)');
    }
    return null;
  }

  // Deduplicate references across all citation groups
  const allRefs = [];
  const seenUris = new Set();
  citations.forEach(citation => {
    (citation.retrievedReferences || []).forEach(ref => {
      const loc = ref.location;
      const uri = loc?.s3Location?.uri
        || loc?.webLocation?.url
        || loc?.confluenceLocation?.url
        || loc?.sharePointLocation?.url
        || loc?.kendraDocumentLocation?.uri
        || loc?.customDocumentLocation?.id;
      if (uri && !seenUris.has(uri)) {
        seenUris.add(uri);
        allRefs.push({ uri, location: loc, content: ref.content, metadata: ref.metadata });
      }
    });
  });

  if (config.debug) {
    console.log('CitationBar: Deduplicated references count:', allRefs.length);
  }

  if (allRefs.length === 0) {
    if (config.debug) {
      console.log('CitationBar: No valid references found after deduplication');
    }
    return null;
  }

  const getFileName = (uri) => {
    try {
      const decoded = decodeURIComponent(uri);
      return decoded.split('/').pop() || uri;
    } catch {
      return uri.split('/').pop() || uri;
    }
  };

  const generatePresignedUrl = async (s3Uri) => {
    if (!credentials || !s3Uri) return null;
    try {
      const withoutProtocol = s3Uri.replace('s3://', '');
      const slashIndex = withoutProtocol.indexOf('/');
      const bucket = withoutProtocol.substring(0, slashIndex);
      const key = withoutProtocol.substring(slashIndex + 1);

      const s3Client = new S3Client({
        region: bedrockConfig.region,
        credentials,
        ...(vpceEndpoints.s3 && { endpoint: vpceEndpoints.s3, forcePathStyle: true }),
      });

      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return await getSignedUrl(s3Client, command, { expiresIn: 60 });
    } catch (err) {
      console.error('Error generating presigned URL:', sanitizeForLog(err.message));
      return null;
    }
  };

  // Collect all citation texts for a given URI
  const getCitationTextsForUri = (uri) => {
    const seen = new Set();
    const texts = [];
    citations.forEach(citation => {
      (citation.retrievedReferences || []).forEach(ref => {
        const loc = ref.location;
        const refUri = loc?.s3Location?.uri
          || loc?.webLocation?.url
          || loc?.confluenceLocation?.url
          || loc?.sharePointLocation?.url
          || loc?.kendraDocumentLocation?.uri
          || loc?.customDocumentLocation?.id;
        if (refUri === uri && ref.content?.text) {
          // Deduplicate by first 100 chars to catch near-identical chunks
          const key = ref.content.text.substring(0, 100);
          if (!seen.has(key)) {
            seen.add(key);
            texts.push(ref.content.text);
          }
        }
      });
    });
    return texts;
  };

  const handleChipClick = async (ref) => {
    const uri = ref.uri;
    const s3Uri = ref.location?.s3Location?.uri;

    if (s3Uri && isViewableFile(uri)) {
      // Open in document viewer
      setViewerState({
        visible: true,
        fileName: getFileName(uri),
        fileUrl: null,
        fileUri: uri,
        citationTexts: getCitationTextsForUri(uri)
      });
      const url = await generatePresignedUrl(s3Uri);
      if (url) {
        setViewerState(prev => ({ ...prev, fileUrl: url }));
      }
    } else if (s3Uri) {
      // Non-viewable S3 file - download
      const url = await generatePresignedUrl(s3Uri);
      if (url) window.open(url, '_blank');
    } else {
      // Web/other URL - open directly
      window.open(uri, '_blank');
    }
  };

  const handleDownload = async () => {
    const ref = allRefs.find(r => r.uri === viewerState.fileUri);
    if (ref?.location?.s3Location?.uri) {
      const url = viewerState.fileUrl || await generatePresignedUrl(ref.location.s3Location.uri);
      if (url) window.open(url, '_blank');
    }
  };

  const handleRefHover = async (index, ref) => {
    if (expandedRef === index) return;
    setExpandedRef(index);
    setPresignedUrl(null);
    if (ref.location?.s3Location?.uri) {
      setLoadingUrl(true);
      const url = await generatePresignedUrl(ref.location.s3Location.uri);
      setPresignedUrl(url);
      setLoadingUrl(false);
    }
  };

  const getContentPreview = (ref) => {
    const text = ref.content?.text;
    if (!text) return 'No preview available';
    return text.length > 200 ? text.substring(0, 200) + '...' : text;
  };

  return (
    <>
      <div className="citation-bar">
        <div className="citation-bar-label">
          <Icon name="file" size="small" />
          <span>Sources ({allRefs.length})</span>
        </div>
        <div className="citation-chips">
          {allRefs.map((ref, index) => (
            <Popover
              key={index}
              dismissButton={true}
              header={getFileName(ref.uri)}
              position="top"
              size="large"
              triggerType="custom"
              content={
                <SpaceBetween size="xs">
                  <Box variant="small" color="text-body-secondary">{ref.uri}</Box>
                  <Box variant="p" fontSize="body-s" color="text-body-secondary">
                    {getContentPreview(ref)}
                  </Box>
                  <SpaceBetween direction="horizontal" size="xs">
                    {ref.location?.s3Location?.uri && isViewableFile(ref.uri) && (
                      <Button
                        iconName="file"
                        variant="link"
                        onClick={() => handleChipClick(ref)}
                      >
                        View document
                      </Button>
                    )}
                    {ref.location?.s3Location?.uri && (
                      loadingUrl ? (
                        <StatusIndicator type="loading">Generating link...</StatusIndicator>
                      ) : presignedUrl ? (
                        <Button
                          iconName="download"
                          variant="link"
                          onClick={(e) => {
                            e.preventDefault();
                            window.open(presignedUrl, '_blank');
                          }}
                        >
                          Download
                        </Button>
                      ) : null
                    )}
                  </SpaceBetween>
                </SpaceBetween>
              }
            >
              <div
                className="citation-chip"
                ref={el => { if (citationChipRefs) citationChipRefs.current[index] = el; }}
                data-citation-index={index}
                onMouseEnter={() => handleRefHover(index, ref)}
                role="button"
                tabIndex={0}
                aria-label={`Citation ${index + 1}: ${getFileName(ref.uri)}. Click to see details.`}
              >
                <span className="citation-chip-number">{index + 1}</span>
                <Icon name={isViewableFile(ref.uri) ? 'file' : 'external'} size="small" />
                <span className="citation-chip-text">{getFileName(ref.uri)}</span>
              </div>
            </Popover>
          ))}
        </div>
      </div>
      <DocumentViewer
        visible={viewerState.visible}
        onDismiss={() => setViewerState(prev => ({ ...prev, visible: false }))}
        fileName={viewerState.fileName}
        fileUrl={viewerState.fileUrl}
        fileUri={viewerState.fileUri}
        citationTexts={viewerState.citationTexts}
        onDownload={handleDownload}
      />
    </>
  );
};

// ChatMessage Component
const ChatMessage = React.memo(({ message, username, userInitials, userEmail, credentials, sessionId, modelId }) => {
  const isUser = message.role === 'user';
  const messageText = message.content?.[0]?.text;
  const isStreaming = message.isStreaming;
  const citationChipRefs = useRef({});

  if (config.debug && !isUser) {
    console.log('🎨 ChatMessage rendering assistant message');
    console.log('  - Message has citations:', !!message.citations);
    console.log('  - Citations count:', message.citations?.length || 0);
    if (message.citations && message.citations.length > 0) {
      console.log('  - Citations data:', JSON.stringify(message.citations, null, 2));
    }
  }

  // Build deduplicated citation refs list (mirrors CitationBar logic)
  const allRefs = useMemo(() => {
    if (!message.citations || message.citations.length === 0) return [];
    const refs = [];
    const seenUris = new Set();
    message.citations.forEach(citation => {
      (citation.retrievedReferences || []).forEach(ref => {
        const loc = ref.location;
        const uri = loc?.s3Location?.uri
          || loc?.webLocation?.url
          || loc?.confluenceLocation?.url
          || loc?.sharePointLocation?.url
          || loc?.kendraDocumentLocation?.uri
          || loc?.customDocumentLocation?.id;
        if (uri && !seenUris.has(uri)) {
          seenUris.add(uri);
          refs.push({ uri, location: loc, content: ref.content, metadata: ref.metadata });
        }
      });
    });
    return refs;
  }, [message.citations]);

  // Build span-based citation markers and inject [N] into the text at span boundaries
  const { textWithCitations, citationDetails } = useMemo(() => {
    if (!message.citations || message.citations.length === 0 || !messageText) {
      return { textWithCitations: null, citationDetails: [] };
    }

    const markers = [];
    const details = [];

    message.citations.forEach((citation, citIdx) => {
      const span = citation.generatedResponsePart?.textResponsePart?.span;
      const spanText = citation.generatedResponsePart?.textResponsePart?.text;
      if (span && span.start !== undefined && span.end !== undefined) {
        const refs = citation.retrievedReferences || [];

        // Build list of unique source filenames for this citation
        const fileNames = [...new Set(refs.map(ref => {
          const refLoc = ref.location;
          const refUri = refLoc?.s3Location?.uri
            || refLoc?.webLocation?.url
            || refLoc?.confluenceLocation?.url
            || refLoc?.sharePointLocation?.url
            || refLoc?.kendraDocumentLocation?.uri
            || refLoc?.customDocumentLocation?.id;
          if (!refUri) return null;
          try { return decodeURIComponent(refUri).split('/').pop(); } catch { return refUri.split('/').pop(); }
        }).filter(Boolean))];

        const firstRef = refs[0];
        const loc = firstRef?.location;
        const uri = loc?.s3Location?.uri
          || loc?.webLocation?.url
          || loc?.confluenceLocation?.url
          || loc?.sharePointLocation?.url
          || loc?.kendraDocumentLocation?.uri
          || loc?.customDocumentLocation?.id;

        const citNum = markers.length + 1;
        markers.push({ end: span.end, citNum });
        details.push({
          citNum,
          uri,
          fileNames,
          spanText: spanText || null,
          refCount: refs.length,
        });
      }
    });

    if (markers.length === 0) return { textWithCitations: null, citationDetails: [] };

    // Sort by end position descending so insertions don't shift earlier positions
    markers.sort((a, b) => b.end - a.end);

    let result = messageText;
    markers.forEach(({ end, citNum }) => {
      if (end <= result.length) {
        result = result.slice(0, end) + ` [${citNum}]` + result.slice(end);
      }
    });

    return { textWithCitations: result, citationDetails: details };
  }, [message.citations, messageText]);

  // Custom text renderer that makes [1], [2] etc. clickable with popovers
  const renderTextWithCitations = (text) => {
    if (!allRefs.length && citationDetails.length === 0) return text;
    const parts = text.split(/(\[\d+\])/g);
    if (parts.length === 1) return text;
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const detail = citationDetails[num - 1];
        if (!detail) return part;

        const displayName = detail.fileNames.length > 0 ? detail.fileNames.join(', ') : 'Unknown source';

        return (
          <Popover
            key={i}
            dismissButton={false}
            position="top"
            size="large"
            triggerType="custom"
            renderWithPortal={true}
            content={
              <SpaceBetween size="xxs">
                <Box variant="small" fontWeight="bold">{displayName}</Box>
                {detail.spanText && (
                  <Box variant="small" color="text-body-secondary">
                    "{detail.spanText}"
                  </Box>
                )}
                <Box variant="small" color="text-body-secondary">
                  <i>{detail.refCount} source reference{detail.refCount !== 1 ? 's' : ''}</i>
                </Box>
              </SpaceBetween>
            }
          >
            <span
              className="inline-citation-link"
              role="button"
              tabIndex={0}
              aria-label={`Citation ${num}: ${displayName}`}
            >
              [{num}]
            </span>
          </Popover>
        );
      }
      return part;
    });
  };

  // Custom ReactMarkdown components with citation-aware text rendering
  const markdownComponents = useMemo(() => ({
    code: CodeBlock,
    p: ({ children }) => <p>{React.Children.map(children, child =>
      typeof child === 'string' ? renderTextWithCitations(child) : child
    )}</p>,
    li: ({ children, ...props }) => <li {...props}>{React.Children.map(children, child =>
      typeof child === 'string' ? renderTextWithCitations(child) : child
    )}</li>,
  }), [allRefs, citationDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!messageText) return null;

  const messageKey = `${message.timestamp}-${message.role}-${messageText.substring(0, 20)}`;

  return (
    <div key={messageKey} className="chat-message">
      <ChatBubble
        type={isUser ? undefined : "incoming"}
        ariaLabel={`${isUser ? 'User' : 'AI assistant'} at ${new Date(message.timestamp).toLocaleTimeString()}`}
        avatar={
          <Avatar
            ariaLabel={isUser ? `Avatar of ${username}` : 'AI assistant'}
            initials={isUser ? userInitials : undefined}
            color={isUser ? undefined : "gen-ai"}
            iconName={isUser ? undefined : "gen-ai"}
            tooltipText={isUser ? username : modelId || 'AI Assistant'}
          />
        }
        actions={!isUser && !isStreaming && <MessageActions text={messageText} timestamp={message.timestamp} userEmail={userEmail} credentials={credentials} sessionId={sessionId} />}
      >
        <Box>
          {isUser ? (
            <span>{messageText}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSanitize]}
              components={markdownComponents}
            >
              {textWithCitations || messageText}
            </ReactMarkdown>
          )}
          {isStreaming && (
            <span className="cursor-blink">▋</span>
          )}
        </Box>
        {!isUser && !isStreaming && message.citations && (
          <CitationBar citations={message.citations} credentials={credentials} citationChipRefs={citationChipRefs} />
        )}
      </ChatBubble>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.message.content[0]?.text === nextProps.message.content[0]?.text &&
    prevProps.message.timestamp === nextProps.message.timestamp &&
    prevProps.message.isStreaming === nextProps.message.isStreaming &&
    prevProps.message.citations === nextProps.message.citations &&
    prevProps.username === nextProps.username &&
    prevProps.userInitials === nextProps.userInitials &&
    prevProps.userEmail === nextProps.userEmail &&
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.modelId === nextProps.modelId
  );
});

ChatMessage.displayName = 'ChatMessage';
const ChatUI = React.forwardRef(({
  chatType,
  setChatType,
  chatTypes,
  modelId,
  setModelId,
  topNavModels,
  foundationModels,
  conversationHistory,
  setConversationHistory,
  username,
  navigationOpen,
  personaRefreshTrigger
}, ref) => {
  // State management
  const [messages, setMessages] = useState([]);
  const [currentSessionMessages, setCurrentSessionMessages] = useState([]);
  const [localMessages, setLocalMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(() => 
    Array(4).fill(0).map(() => Math.random().toString(36).substring(2)).join('')
  );
  const [ragSessionId, setRagSessionId] = useState('');
  const [files, setFiles] = useState([]);
  const [streamResult, setStreamResult] = useState(false);
  const [userInitials, setUserInitials] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [selectedPersonaId, setSelectedPersonaId] = useState('default');
  const [personas, setPersonas] = useState([]);
  const [userEmail, setUserEmail] = useState('');

  // Refs and Context
  const chatContainerRef = useRef(null);
  const credentials = useContext(CredentialsContext);

  // Transform model and chat type options to Select component format
  const modelOptions = useMemo(() => {
    return topNavModels.map(model => ({
      label: model.text,
      value: model.id
    }));
  }, [topNavModels]);

  const chatTypeOptions = useMemo(() => {
    return chatTypes.map(type => ({
      label: type.text,
      value: type.id
    }));
  }, [chatTypes]);

  // Handle window resize to detect mobile devices
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getModelItem = (foundationModels, modelId, item) => {
    if (config.debug) console.log('Model ID:', sanitizeForLog(modelId));
    const model = foundationModels.find(model => model.modelId === modelId);
    if (config.debug) console.log('Model:', sanitizeForLog(model));
    
    if (!model) {
      return { found: false, message: "Model not found" };
    }
    
    return model[item];
  }

  // Initialize user details and personas
  useEffect(() => {
    const initializeUser = async () => {
      try {
        if (!username) {
          const user = await getCurrentUser();
          const attributes = await fetchUserAttributes();
          const email = attributes.email;
          setUserEmail(email);
          setUserInitials(email.charAt(0).toUpperCase());
          
          // Initialize personas
          if (credentials) {
            await PersonaService.initializeDefaultPersonas(email, credentials);
            const userPersonas = await PersonaService.getUserPersonas(email, credentials);
            setPersonas(userPersonas);
          }
        }
      } catch (error) {
        if (config.debug) console.error('Error fetching user:', error);
      }
    };
    initializeUser();
  }, [username, credentials]);

  // Handle persona refresh trigger
  useEffect(() => {
    const refreshPersonas = async () => {
      if (personaRefreshTrigger > 0 && userEmail && credentials) {
        try {
          if (config.debug) console.log('Refreshing personas due to trigger:', personaRefreshTrigger);
          const userPersonas = await PersonaService.getUserPersonas(userEmail, credentials);
          setPersonas(userPersonas);
        } catch (error) {
          if (config.debug) console.error('Error refreshing personas:', error);
        }
      }
    };
    refreshPersonas();
  }, [personaRefreshTrigger, userEmail, credentials]);

  // Track whether we're loading history to suppress reset effects
  const skipResetRef = useRef(0);

  // Reset session and clear messages when model changes
  // This prevents the new model from seeing the old model's responses in conversation history
  useEffect(() => {
    if (skipResetRef.current > 0) {
      skipResetRef.current--;
      return;
    }
    if (config.debug) {
      console.log('Model changed to:', modelId, '- Resetting session and clearing messages');
    }
    setRagSessionId('');
    setCurrentSessionMessages([]);
    setChatSessionId(Array(4).fill(0).map(() => Math.random().toString(36).substring(2)).join(''));
  }, [modelId]);

  // Reset session when chat type changes (RAG vs LLM vs Agentic)
  useEffect(() => {
    if (skipResetRef.current > 0) {
      skipResetRef.current--;
      return;
    }
    if (config.debug) {
      console.log('Chat type changed to:', chatType, '- Resetting session');
    }
    setRagSessionId('');
    setCurrentSessionMessages([]);
    setChatSessionId(Array(4).fill(0).map(() => Math.random().toString(36).substring(2)).join(''));
  }, [chatType]);

  // Scroll to bottom effect
  useEffect(() => {
    const scrollToBottom = () => {
      const chatContainer = chatContainerRef.current;
      if (chatContainer) {
        // Add a small delay to ensure content is fully rendered
        setTimeout(() => {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 50);
      }
    };
    scrollToBottom();
  }, [currentSessionMessages]);

  // Debug effects
  useEffect(() => {
    if (config.debug) {
      console.log('LocalMessages state changed:', localMessages);
    }
  }, [localMessages]);

  useEffect(() => {
    if (config.debug) {
      console.log('ConversationHistory state changed:', conversationHistory);
    }
  }, [conversationHistory]);

  // Handle conversation history changes
  useEffect(() => {
    if (conversationHistory.length > 0) {
      if (config.debug) {
        console.log('Converting conversation history:', conversationHistory);
      }
      const formattedMessages = [];
      
      const sessionMessages = conversationHistory.filter(msg => msg.sessionID === chatSessionId).reverse();
      
      sessionMessages.forEach(msg => {
        formattedMessages.push({
          role: 'user',
          content: [{ text: msg.question }],
          timestamp: msg.timestamp,
          documentContext: msg.documentContext
        });
        
        if (msg.response) {
          formattedMessages.push({
            role: 'assistant',
            content: [{ text: msg.response }],
            timestamp: msg.timestamp + 1,
            ...(msg.citations && (() => {
              try { const c = JSON.parse(msg.citations); return c.length > 0 ? { citations: c } : {}; }
              catch { return {}; }
            })())
          });
        }
      });
      
      setCurrentSessionMessages(formattedMessages);
    }
  }, [conversationHistory, chatSessionId]);

  // External state update handler
  React.useImperativeHandle(ref, () => ({
    updateState: (messages, newChatSessionId, historyModelId, historyChatType, historyPersonaId) => {
      if (config.debug) {
        console.log('Updating ChatUI state with messages:', messages);
      }

      // Count how many effects will fire so we can suppress them
      let skipsNeeded = 0;
      if (historyModelId && historyModelId !== modelId) skipsNeeded++;
      if (historyChatType && historyChatType !== chatType) skipsNeeded++;
      skipResetRef.current += skipsNeeded;

      const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
      const pairedMessages = [];
      
      for (let i = 0; i < sortedMessages.length; i += 2) {
        if (i + 1 < sortedMessages.length) {
          pairedMessages.push(sortedMessages[i]);
          pairedMessages.push(sortedMessages[i + 1]);
        } else {
          pairedMessages.push(sortedMessages[i]);
        }
      }

      // Restore model, chat type, and persona from history if available
      if (historyModelId) setModelId(historyModelId);
      if (historyChatType) setChatType(historyChatType);
      const restoredPersona = historyPersonaId && personas.some(p => p.id === historyPersonaId)
        ? historyPersonaId
        : 'default';
      setSelectedPersonaId(restoredPersona);

      setCurrentSessionMessages(pairedMessages);
      setChatSessionId(newChatSessionId);

      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 100);
    }
  }));
  // Handle submit function
  const handleSubmit = async () => {
    if (!input.trim()) return;
  
    if (config.debug) {
      console.log('Current session messages before new message:', currentSessionMessages);
    }

    // Get the selected persona and its documents
    const selectedPersona = personas.find(p => p.id === selectedPersonaId);
    const personaPrompt = await PersonaService.getPersonaPrompt(userEmail, selectedPersonaId, credentials);
    const enhancedInput = personaPrompt ? `${personaPrompt}\n\nUser: ${input}` : input;
    
    // Convert persona documents to File objects
    const personaFiles = [];
    if (selectedPersona?.documents?.length > 0) {
      // Construct S3 endpoint with "bucket." prefix for VPC endpoint
      const getS3Endpoint = () => {
        if (vpceEndpoints.s3) {
          const vpceUrl = new URL(vpceEndpoints.s3);
          vpceUrl.hostname = `bucket.${vpceUrl.hostname}`;
          return vpceUrl.toString();
        }
        return undefined;
      };

      const s3Client = new S3Client({
        region: bedrockConfig.region,
        credentials,
        ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
        ...(vpceEndpoints.s3 && { forcePathStyle: true })
      });
      
      for (const doc of selectedPersona.documents) {
        try {
          const getObjectCommand = new GetObjectCommand({
            Bucket: bedrockConfig.personaS3Bucket,
            Key: doc.key
          });
          
          const response = await s3Client.send(getObjectCommand);
          const arrayBuffer = await response.Body.transformToByteArray();
          
          // Create File-like object
          const file = new File([arrayBuffer], doc.name, {
            type: doc.type || 'application/octet-stream'
          });
          
          personaFiles.push(file);
        } catch (error) {
          console.error(`Error fetching persona document ${sanitizeForLog(doc.name)}:`, sanitizeForLog(error.message));
        }
      }
    }
    
    // Combine uploaded files with persona files
    const allFiles = [...files, ...personaFiles];
  
    const userMessage = {
      role: 'user',
      content: [{ text: input }], // Store original user input for display
      timestamp: Date.now()
    };
  
    if (config.debug) {
      console.log('New user message:', userMessage);
      console.log('Enhanced input with persona:', enhancedInput);
      console.log('Selected persona:', selectedPersona);
      console.log('Persona files created:', personaFiles.length);
      console.log('All files (uploaded + persona):', allFiles.length);
    }
  
    setCurrentSessionMessages(prevMessages => [...prevMessages, userMessage]);
    setInput('');
    setIsLoading(true);
  
    try {
      if (!modelId) {
        throw new Error('Model ID is required');
      }
  
      if (config.debug) {
        console.log('Current session messages before formatting:', currentSessionMessages);
      }
  
      // Build formatted history from current messages (not including the new user message yet)
      const formattedHistory = currentSessionMessages.map(msg => ({
        role: msg.role,
        content: [{ text: msg.content[0].text }]
      }));
  
      if (config.debug) {
        console.log('Formatted conversation history for Bedrock:', JSON.stringify(formattedHistory, null, 2));
        console.log('Supports streaming: ', getModelItem(foundationModels, modelId, 'responseStreamingSupported'));
      }
  
      let streamedResponse = '';
      let result;
      let citations = [];
      let usageData = null;
  
      const handleStreamChunk = (chunk) => {
        setIsLoading(false);
        streamedResponse += chunk;
        setCurrentSessionMessages(prevMessages => {
          const lastMessage = prevMessages[prevMessages.length - 1];
          if (lastMessage && lastMessage.role === 'assistant') {
            return prevMessages.map((msg, index) => 
              index === prevMessages.length - 1
                ? { ...msg, content: [{ text: streamedResponse }] }
                : msg
            );
          } else {
            return [...prevMessages, {
              role: 'assistant',
              content: [{ text: streamedResponse }],
              timestamp: Date.now()
            }];
          }
        });
      };
  
      if (chatType === 'RAG') {
        const supportsStreaming = (modelId === bedrockConfig.defaultModelId && bedrockConfig.defaultModelStream) || 
                                getModelItem(foundationModels, modelId, 'responseStreamingSupported');
        
        if (supportsStreaming) {
          result = await invokeBedrockRetrieveAndGenerateStreamCommand(
            enhancedInput,
            allFiles,
            ragSessionId,
            credentials,
            modelId,
            formattedHistory,
            handleStreamChunk
          );
  
          if (config.debug) {
            console.log('Final streamed response:', result);
          }
          
          // Check if the result contains usage data
          if (result.fullResponse && result.fullResponse.metrics) {
            usageData = {
              inputTokens: result.fullResponse.metrics.inputTokenCount || 0,
              outputTokens: result.fullResponse.metrics.outputTokenCount || 0
            };
          }
        } else {
          result = await invokeBedrockAgent(enhancedInput, chatSessionId, credentials, []);
        }
  
        setRagSessionId(result.sessionId);
        citations = result.citations || [];

        if (config.debug) {
          console.log('=== RAG RESULT RECEIVED ===');
          console.log('Citations received from bedrockAgent:', citations);
          console.log('Citations array length:', citations.length);
          console.log('Citations array type:', Array.isArray(citations) ? 'array' : typeof citations);
          if (citations.length > 0) {
            console.log('First citation structure:', JSON.stringify(citations[0], null, 2));
          }
        }

        // Attach citations to the assistant message
        if (citations.length > 0) {
          if (config.debug) {
            console.log('✅ Attaching', citations.length, 'citations to assistant message');
          }
          setCurrentSessionMessages(prevMessages => {
            const lastMessage = prevMessages[prevMessages.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              const updated = prevMessages.map((msg, index) => 
                index === prevMessages.length - 1
                  ? { ...msg, citations }
                  : msg
              );
              if (config.debug) {
                console.log('✅ Updated last message with citations');
                console.log('Last message now has citations:', updated[updated.length - 1].citations);
              }
              return updated;
            } else {
              if (config.debug) {
                console.log('⚠️ Last message is not an assistant message, cannot attach citations');
              }
            }
            return prevMessages;
          });
        } else {
          if (config.debug) {
            console.log('⚠️ No citations to attach - citations array is empty');
          }
        }
  
      } else if (chatType === 'LLM') {
        const response = await invokeBedrockConverseStreamCommand(
          enhancedInput,
          allFiles,
          credentials,
          modelId,
          formattedHistory,
          handleStreamChunk
        );
  
        if (config.debug) {
          console.log('Final streamed response:', streamedResponse);
        }
        
        // Check if the response contains usage data
        if (response && response.usage) {
          usageData = {
            inputTokens: response.usage.inputTokens || 0,
            outputTokens: response.usage.outputTokens || 0
          };
        }
      } else if (chatType === 'Agentic') {
        const currentDate = new Date().toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
        const agenticInput = `Current date: ${currentDate}\n\n${enhancedInput}`;
        result = await invokeBedrockAgent(agenticInput, chatSessionId, credentials, handleStreamChunk);
        // streamedResponse is already built up by handleStreamChunk
      }
  
      // Save conversation to history for both chat types
      try {
        const attributes = await fetchUserAttributes();
        
        // Get token counts from the API response if available, otherwise estimate
        let inputTokens, outputTokens;

        if (usageData) {
          // Use the token counts from the API response
          inputTokens = usageData.inputTokens;
          outputTokens = usageData.outputTokens;

          if (config.debug) {
            console.log('Using token counts from API response:', { inputTokens, outputTokens });
          }
        } else {
          // Fall back to estimation
          inputTokens = Math.ceil(input.length / 4);
          outputTokens = Math.ceil((chatType === 'RAG' ? result.body : streamedResponse).length / 4);

          if (config.debug) {
            console.log('Using estimated token counts:', { inputTokens, outputTokens });
          }
        }

        // Create timestamp once to use for both DynamoDB and message state
        const savedTimestamp = Date.now();

        const dynPayload = {
          sessionID: chatSessionId,
          userID: attributes.email,
          question: input,
          response: chatType === 'RAG' ? result.body : streamedResponse,
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          modelId: modelId,
          chatType: chatType,
          ...(selectedPersonaId && selectedPersonaId !== 'default' && { personaId: selectedPersonaId }),
          ...(chatType === 'RAG' && { citations: JSON.stringify(citations) }),
          timestamp: savedTimestamp
        };

        await convHistory.saveConversation(dynPayload, credentials);

        // Update the assistant message with the actual saved timestamp
        setCurrentSessionMessages(prevMessages => {
          return prevMessages.map((msg, index) => {
            // Update the last assistant message with the saved timestamp
            if (index === prevMessages.length - 1 && msg.role === 'assistant') {
              return { ...msg, timestamp: savedTimestamp };
            }
            return msg;
          });
        });

        const historyResponse = await convHistory.loadUserHistory(attributes.email, credentials);
        setConversationHistory(historyResponse);
      } catch (error) {
        if (config.debug) {
          console.error('DynamoDB Error:', sanitizeForLog(error.message));
        }
      }
    } catch (error) {
      setIsLoading(false);
      if (config.debug) {
        console.error('Error:', sanitizeForLog(error.message));
      }
      setCurrentSessionMessages(prevMessages => [
        ...prevMessages,
        {
          role: 'assistant',
          content: [{ text: `Sorry, an error occurred: ${sanitizeForLog(error.message)}` }],
          timestamp: Date.now()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Loading bubble component
  const LoadingBubble = () => (
    <ChatBubble
      ariaLabel="Generative AI assistant"
      type="incoming"
      avatar={
        <Avatar
          loading={true}
          color="gen-ai"
          iconName="gen-ai"
          ariaLabel="Generative AI assistant"
          tooltipText="Generative AI assistant"
        />
      }
    >
      <Box color="text-status-inactive">
        Generating response
      </Box>
    </ChatBubble>
  );
  
  // File handling setup
  const areFilesDragging = useFilesDragging().areFilesDragging;

  const secondaryActions = useMemo(() => (
    <Box padding={{ left: "xxs", top: "xs" }}>
      <ButtonGroup
        ariaLabel="Chat actions"
        items={[
          {
            type: "icon-button",
            id: "upload",
            iconName: "upload",
            text: "Upload up to 20 total files with a max file size of 4.5MB per file.\n\nSupported file types: .txt, .pdf, .doc, .docx, .csv, .md, .html, .xls, .xlsx",
          },
          {
            type: "icon-button",
            id: "expand",
            iconName: "expand",
            text: "Toggle fullscreen",
          }
        ]}
        variant="icon"
        onItemClick={({ detail }) => {
          if (detail.id === "upload") {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.multiple = true;
            fileInput.accept = ".txt,.pdf,.doc,.docx,.csv,.md,.html,.xls,.xlsx";
            fileInput.onchange = (e) => {
              setFiles(Array.from(e.target.files));
            };
            fileInput.click();
          } else if (detail.id === "expand") {
            const element = document.documentElement;
            if (!document.fullscreenElement) {
              element.requestFullscreen().catch(err => {
                if (config.debug) console.error('Error attempting to enable fullscreen:', sanitizeForLog(err.message));
              });
            } else {
              document.exitFullscreen();
            }
          }
        }}
      />
    </Box>
  ), [files]);
  
  const secondaryContent = useMemo(() => (
    areFilesDragging ? (
      <FileDropzone
        onChange={({ detail }) => setFiles(prev => [...prev, ...detail.value])}
        accept=".txt,.pdf,.doc,.docx,.csv,.md,.html,.xls,.xlsx"
      >
        <SpaceBetween size="xs" alignItems="center">
          <Icon name="upload" />
          <Box>Drop files here</Box>
        </SpaceBetween>
      </FileDropzone>
    ) : (
      files.length > 0 && (
        <FileTokenGroup
          items={files.map(file => ({ file }))}
          onDismiss={({ detail }) =>
            setFiles(files =>
              files.filter((_, index) => index !== detail.fileIndex)
            )
          }
          alignment="horizontal"
          showFileSize={true}
          showFileLastModified={true}
          showFileThumbnail={true}
          i18nStrings={{
            removeFileAriaLabel: () => "Remove file",
            limitShowFewer: "Show fewer files",
            limitShowMore: "Show more files",
            errorIconAriaLabel: "Error",
            warningIconAriaLabel: "Warning"
          }}
        />
      )
    )
  ), [areFilesDragging, files]);
  
  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
      position: 'relative'
    }}>
      <Container>
        <div className="chat-ui-content-wrapper">
          <SpaceBetween size="xs">
            <Header
              variant="h1"
              description={chatType === 'RAG' 
                ? 'Ask me questions about your document knowledge base.' 
                : chatType === 'Agentic'
                ? 'Ask me anything and I also have the ability to send emails and search the web.'
                : 'Ask me anything.'}
              actions={
                <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center', flexWrap: 'nowrap' }}>
                  {isMobile ? (
                    <>
                      <Popover
                        dismissButton={false}
                        triggerType="custom"
                        content={
                          <div style={{ minWidth: '250px' }}>
                            <Select
                              selectedOption={chatTypeOptions.find(type => type.value === chatType) || null}
                              onChange={({ detail }) => {
                                if(config.debug) {
                                  console.log('Chat type changed to:', detail.selectedOption.value);
                                }
                                setChatType(detail.selectedOption.value);
                              }}
                              options={chatTypeOptions}
                              placeholder="Select assistant type"
                              expandToViewport
                            />
                          </div>
                        }
                      >
                        <div style={{ position: 'relative' }}>
                          <Button
                            iconName="settings"
                            variant="icon"
                            ariaLabel={`Chat type: ${chatTypeOptions.find(type => type.value === chatType)?.label || 'Select'}`}
                          />
                        </div>
                      </Popover>
                      <Popover
                        dismissButton={false}
                        triggerType="custom"
                        content={
                          <div style={{ minWidth: '250px' }}>
                            <Select
                              selectedOption={modelOptions.find(model => model.value === modelId) || null}
                              onChange={({ detail }) => {
                                setModelId(detail.selectedOption.value);
                                if(config.debug) {
                                  console.log('Model successfully changed to:', detail.selectedOption.value);
                                }
                              }}
                              options={modelOptions}
                              placeholder="Select a model"
                              expandToViewport
                              filteringType="auto"
                            />
                          </div>
                        }
                      >
                        <div style={{ position: 'relative' }}>
                          <Button
                            iconName="gen-ai"
                            variant="icon"
                            ariaLabel={`Model: ${modelOptions.find(model => model.value === modelId)?.label || 'Select'}`}
                          />
                        </div>
                      </Popover>
                      <Popover
                        dismissButton={false}
                        triggerType="custom"
                        content={
                          <div style={{ minWidth: '250px' }}>
                            <PersonaSelector
                              selectedPersonaId={selectedPersonaId}
                              onPersonaChange={setSelectedPersonaId}
                              personas={personas}
                            />
                          </div>
                        }
                      >
                        <div style={{ position: 'relative' }}>
                          <Button
                            iconName="user-profile"
                            variant="icon"
                            ariaLabel={`Persona: ${personas.find(p => p.id === selectedPersonaId)?.name || 'Select'}`}
                          />
                          {selectedPersonaId !== 'default' && (
                            <div style={{
                              position: 'absolute',
                              top: '-2px',
                              right: '-2px',
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: '#00875a',
                              border: '2px solid white'
                            }} />
                          )}
                        </div>
                      </Popover>
                    </>
                  ) : (
                    <>
                      <div style={{ width: '200px', minWidth: '200px', maxWidth: '200px' }}>
                        <Select
                          selectedOption={chatTypeOptions.find(type => type.value === chatType) || null}
                          onChange={({ detail }) => {
                            if(config.debug) {
                              console.log('Chat type changed to:', detail.selectedOption.value);
                            }
                            setChatType(detail.selectedOption.value);
                          }}
                          options={chatTypeOptions}
                          placeholder="Select assistant type"
                          expandToViewport
                        />
                      </div>
                      <div style={{ width: '200px', minWidth: '200px', maxWidth: '200px' }}>
                        <Select
                          selectedOption={modelOptions.find(model => model.value === modelId) || null}
                          onChange={({ detail }) => {
                            setModelId(detail.selectedOption.value);
                            if(config.debug) {
                              console.log('Model successfully changed to:', detail.selectedOption.value);
                            }
                          }}
                          options={modelOptions}
                          placeholder="Select a model"
                          expandToViewport
                          filteringType="auto"
                        />
                      </div>
                      <div style={{ width: '200px', minWidth: '200px', maxWidth: '200px' }}>
                        <PersonaSelector
                          selectedPersonaId={selectedPersonaId}
                          onPersonaChange={setSelectedPersonaId}
                          personas={personas}
                        />
                      </div>
                    </>
                  )}
                  <Button
                    onClick={() => {
                      setCurrentSessionMessages([]);
                      setChatSessionId(Array(4).fill(0).map(() => Math.random().toString(36).substring(2)).join(''));
                      setInput('');
                      setFiles([]);
                      setSelectedPersonaId('default');
                    }}
                    iconName="refresh"
                    variant={isMobile ? "icon" : undefined}
                    ariaLabel={isMobile ? "New Session" : undefined}
                  >
                    {isMobile ? "" : "New Session"}
                  </Button>
                </div>
              }
            >
              Chat UI
            </Header>
            {chatType === 'RAG' && <KbStatusBanner />}
            <div className="chat-ui-scroll-container" ref={chatContainerRef}>
              <div className="chat-container">
                <div className="chat-messages-wrapper">
                  {currentSessionMessages.map((message, index) => (
                    <ChatMessage
                      key={`${index}-${message.timestamp}`}
                      message={message}
                      username={username}
                      userInitials={userInitials}
                      userEmail={userEmail}
                      credentials={credentials}
                      sessionId={chatSessionId}
                      modelId={modelId}
                    />
                  ))}
                  {isLoading && <LoadingBubble />}
                </div>
              </div>
              
            </div>
            
            {/* Prompt positioned outside the scroll container */}
            <div className="prompt-container" style={{
              left: `calc(50% + ${navigationOpen && !isMobile ? 150 : 0}px)`,
            }}>
              <div className="prompt-wrapper">
                <PromptInput
                  onChange={({ detail }) => setInput(detail.value)}
                  value={input}
                  actionButtonAriaLabel="Send message"
                  actionButtonIconName="send"
                  onAction={handleSubmit}
                  disableSecondaryActionsPaddings
                  placeholder="Ask a question"
                  secondaryActions={secondaryActions}
                  secondaryContent={secondaryContent}
                  ariaLabel="Chat input"
                  expandToViewport={isMobile} // Expand to viewport on mobile
                  expandableGroups={isMobile} // Make groups expandable on mobile
                  size={isMobile ? "large" : "normal"} // Larger prompt on mobile
                />
              </div>
            </div>
          </SpaceBetween>
        </div>
      </Container>
    </div>
  );
});
  
ChatUI.displayName = 'ChatUI';

export default ChatUI;