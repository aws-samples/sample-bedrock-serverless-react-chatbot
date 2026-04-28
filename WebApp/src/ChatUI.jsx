// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { CredentialsContext } from './SessionContext';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { convHistory } from './ConvHistory';
import { bedrockConfig, vpceEndpoints } from './aws-config';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, FileIcon, X, RefreshCw, Settings, Search, Check } from 'lucide-react';
import { invokeBedrockAgent, invokeBedrockConverseStreamCommand, invokeBedrockRetrieveAndGenerateStreamCommand } from './bedrockAgent';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import PersonaSelector from './PersonaSelector';
import { PersonaService } from './PersonaService';
import { sanitizeForLog } from './utils/sanitize';
import ChatMessage from './ChatMessage';
import KbStatusBanner from './KbStatusBanner';
import './ChatUI.css';

const ChatUI = React.forwardRef(({ chatType, setChatType, chatTypes, modelId, setModelId, topNavModels, foundationModels, conversationHistory, setConversationHistory, username, navigationOpen, personaRefreshTrigger }, ref) => {
  const [currentSessionMessages, setCurrentSessionMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState(() => Array(4).fill(0).map(() => Math.random().toString(36).substring(2)).join(''));
  const [ragSessionId, setRagSessionId] = useState('');
  const [files, setFiles] = useState([]);
  const [userInitials, setUserInitials] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [selectedPersonaId, setSelectedPersonaId] = useState('default');
  const [personas, setPersonas] = useState([]);
  const [userEmail, setUserEmail] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const chatContainerRef = useRef(null);
  const credentials = useContext(CredentialsContext);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const ragEnabled = bedrockConfig.ragEnabled !== "false";
  const modelOptions = useMemo(() => topNavModels.map(m => ({ label: m.text, value: m.id, detail: m.detail })), [topNavModels]);
  const filteredModelOptions = useMemo(() => {
    if (!modelSearch.trim()) return modelOptions;
    const q = modelSearch.toLowerCase();
    return modelOptions.filter(m => m.label.toLowerCase().includes(q) || m.detail?.toLowerCase().includes(q));
  }, [modelOptions, modelSearch]);
  const chatTypeOptions = useMemo(() => (ragEnabled ? chatTypes : chatTypes.filter(t => t.id !== 'RAG')).map(t => ({ label: t.text, value: t.id })), [chatTypes, ragEnabled]);
  useEffect(() => { const h = () => setIsMobile(window.innerWidth <= 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  useEffect(() => { if (!ragEnabled && chatType === 'RAG') setChatType('LLM'); }, [ragEnabled, chatType, setChatType]);
  const getModelItem = (fms, mid, item) => { const m = fms.find(m => m.modelId === mid); return m ? m[item] : { found: false }; };
  useEffect(() => { (async () => { try { if (!username) { const attrs = await fetchUserAttributes(); setUserEmail(attrs.email); setUserInitials(attrs.email.charAt(0).toUpperCase()); if (credentials) { await PersonaService.initializeDefaultPersonas(attrs.email, credentials); setPersonas(await PersonaService.getUserPersonas(attrs.email, credentials)); } } } catch {} })(); }, [username, credentials]);
  useEffect(() => { if (personaRefreshTrigger > 0 && userEmail && credentials) PersonaService.getUserPersonas(userEmail, credentials).then(setPersonas).catch(() => {}); }, [personaRefreshTrigger, userEmail, credentials]);
  const skipResetRef = useRef(0);
  const newSessionId = () => Array(4).fill(0).map(() => Math.random().toString(36).substring(2)).join('');
  useEffect(() => { if (skipResetRef.current > 0) { skipResetRef.current--; return; } setRagSessionId(''); setCurrentSessionMessages([]); setChatSessionId(newSessionId()); }, [modelId]);
  useEffect(() => { if (skipResetRef.current > 0) { skipResetRef.current--; return; } setRagSessionId(''); setCurrentSessionMessages([]); setChatSessionId(newSessionId()); }, [chatType]);
  useEffect(() => { if (chatContainerRef.current) setTimeout(() => { chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight; }, 50); }, [currentSessionMessages]);
  useEffect(() => {
    if (conversationHistory.length > 0) {
      const fmts = []; conversationHistory.filter(msg => msg.sessionID === chatSessionId).reverse().forEach(msg => {
        fmts.push({ role: 'user', content: [{ text: msg.question }], timestamp: msg.timestamp });
        if (msg.response) fmts.push({ role: 'assistant', content: [{ text: msg.response }], timestamp: msg.timestamp + 1, ...(msg.citations && (() => { try { const c = JSON.parse(msg.citations); return c.length > 0 ? { citations: c } : {}; } catch { return {}; } })()) });
      });
      setCurrentSessionMessages(fmts);
    }
  }, [conversationHistory, chatSessionId]);
  React.useImperativeHandle(ref, () => ({
    updateState: (messages, newId, hModelId, hChatType, hPersonaId) => {
      let skips = 0; if (hModelId && hModelId !== modelId) skips++; if (hChatType && hChatType !== chatType) skips++; skipResetRef.current += skips;
      const paired = [...messages].sort((a, b) => a.timestamp - b.timestamp);
      if (hModelId) setModelId(hModelId); if (hChatType) setChatType(hChatType);
      setSelectedPersonaId(hPersonaId && personas.some(p => p.id === hPersonaId) ? hPersonaId : 'default');
      setCurrentSessionMessages(paired); setChatSessionId(newId);
      setTimeout(() => { if (chatContainerRef.current) chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight; }, 100);
    }
  }));
  const handleSubmit = async () => {
    if (!input.trim()) return;
    const selectedPersona = personas.find(p => p.id === selectedPersonaId);
    const personaPrompt = await PersonaService.getPersonaPrompt(userEmail, selectedPersonaId, credentials);
    const enhancedInput = personaPrompt ? personaPrompt + '\n\nUser: ' + input : input;
    const personaFiles = [];
    if (selectedPersona?.documents?.length > 0) {
      const getS3Ep = () => { if (vpceEndpoints.s3) { const u = new URL(vpceEndpoints.s3); u.hostname = 'bucket.' + u.hostname; return u.toString(); } return undefined; };
      const s3 = new S3Client({ region: bedrockConfig.region, credentials, ...(vpceEndpoints.s3 && { endpoint: getS3Ep() }), ...(vpceEndpoints.s3 && { forcePathStyle: true }) });
      for (const doc of selectedPersona.documents) { try { const r = await s3.send(new GetObjectCommand({ Bucket: bedrockConfig.personaS3Bucket, Key: doc.key })); personaFiles.push(new File([await r.Body.transformToByteArray()], doc.name, { type: doc.type || 'application/octet-stream' })); } catch {} }
    }
    const allFiles = [...files, ...personaFiles];
    setCurrentSessionMessages(prev => [...prev, { role: 'user', content: [{ text: input }], timestamp: Date.now() }]);
    const savedInput = input; setInput(''); setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      if (!modelId) throw new Error('Model ID is required');
      const formattedHistory = currentSessionMessages.map(msg => ({ role: msg.role, content: [{ text: msg.content[0].text }] }));
      let streamedResponse = '', result, citations = [], usageData = null;
      const onChunk = (chunk) => { setIsLoading(false); streamedResponse += chunk; setCurrentSessionMessages(prev => { const last = prev[prev.length - 1]; if (last?.role === 'assistant') return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: [{ text: streamedResponse }] } : m); return [...prev, { role: 'assistant', content: [{ text: streamedResponse }], timestamp: Date.now() }]; }); };
      if (chatType === 'RAG') {
        const supportsStreaming = (modelId === bedrockConfig.defaultModelId && bedrockConfig.defaultModelStream) || getModelItem(foundationModels, modelId, 'responseStreamingSupported');
        if (supportsStreaming) { result = await invokeBedrockRetrieveAndGenerateStreamCommand(enhancedInput, allFiles, ragSessionId, credentials, modelId, formattedHistory, onChunk); if (result.fullResponse?.metrics) usageData = { inputTokens: result.fullResponse.metrics.inputTokenCount || 0, outputTokens: result.fullResponse.metrics.outputTokenCount || 0 }; }
        else { result = await invokeBedrockAgent(enhancedInput, chatSessionId, credentials, []); }
        setRagSessionId(result.sessionId); citations = result.citations || [];
        if (citations.length > 0) setCurrentSessionMessages(prev => { const last = prev[prev.length - 1]; if (last?.role === 'assistant') return prev.map((m, i) => i === prev.length - 1 ? { ...m, citations } : m); return prev; });
      } else if (chatType === 'LLM') {
        const response = await invokeBedrockConverseStreamCommand(enhancedInput, allFiles, credentials, modelId, formattedHistory, onChunk);
        if (response?.usage) usageData = { inputTokens: response.usage.inputTokens || 0, outputTokens: response.usage.outputTokens || 0 };
      } else if (chatType === 'Agentic') {
        const d = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        result = await invokeBedrockAgent('Current date: ' + d + '\n\n' + enhancedInput, chatSessionId, credentials, onChunk);
      }
      try {
        const attrs = await fetchUserAttributes();
        const inTok = usageData ? usageData.inputTokens : Math.ceil(savedInput.length / 4);
        const outTok = usageData ? usageData.outputTokens : Math.ceil((chatType === 'RAG' ? result.body : streamedResponse).length / 4);
        const ts = Date.now();
        await convHistory.saveConversation({ sessionID: chatSessionId, userID: attrs.email, question: savedInput, response: chatType === 'RAG' ? result.body : streamedResponse, inputTokens: inTok, outputTokens: outTok, modelId, chatType, ...(selectedPersonaId !== 'default' && { personaId: selectedPersonaId }), ...(chatType === 'RAG' && { citations: JSON.stringify(citations) }), timestamp: ts }, credentials);
        setCurrentSessionMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.role === 'assistant' ? { ...m, timestamp: ts } : m));
        setConversationHistory(await convHistory.loadUserHistory(attrs.email, credentials));
      } catch {}
    } catch (error) { setIsLoading(false); setCurrentSessionMessages(prev => [...prev, { role: 'assistant', content: [{ text: 'Sorry, an error occurred: ' + sanitizeForLog(error.message) }], timestamp: Date.now() }]); }
    finally { setIsLoading(false); }
  };
  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } };
  const newSession = () => { setCurrentSessionMessages([]); setChatSessionId(newSessionId()); setInput(''); setFiles([]); setSelectedPersonaId('default'); };
  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden relative">
      <div className="max-w-3xl mx-auto w-full p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Chat UI</h1>
            <p className="text-sm text-muted-foreground">{chatType === 'RAG' ? 'Ask about your knowledge base.' : chatType === 'Agentic' ? 'Ask anything - I can send emails and search the web.' : 'Ask me anything.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMobile ? (
              <Popover>
                <PopoverTrigger className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent transition-colors"><Settings className="h-4 w-4" /></PopoverTrigger>
                <PopoverContent className="w-64 space-y-3">
                  <Select value={chatType} onValueChange={setChatType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{chatTypeOptions.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
                  <PersonaSelector selectedPersonaId={selectedPersonaId} onPersonaChange={setSelectedPersonaId} personas={personas} />
                </PopoverContent>
              </Popover>
            ) : (
              <>
                <div className="w-[180px]"><Select value={chatType} onValueChange={setChatType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{chatTypeOptions.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="w-[180px]"><PersonaSelector selectedPersonaId={selectedPersonaId} onPersonaChange={setSelectedPersonaId} personas={personas} /></div>
              </>
            )}
            <button onClick={newSession} className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"><RefreshCw className="h-4 w-4" />{!isMobile && "New Session"}</button>
          </div>
        </div>
      </div>
      {ragEnabled && chatType === 'RAG' && <div className="max-w-4xl mx-auto w-full px-4"><KbStatusBanner /></div>}
      <div className="flex-1 overflow-y-auto scrollbar-hidden" ref={chatContainerRef} style={{ maxHeight: 'calc(100vh - 295px)' }}>
        <div className="flex flex-col gap-4 p-4 max-w-4xl mx-auto w-full">
              {currentSessionMessages.map((message, index) => (
                <ChatMessage key={index + '-' + message.timestamp} message={message} username={username} userInitials={userInitials} userEmail={userEmail} credentials={credentials} sessionId={chatSessionId} modelId={modelId} />
              ))}
              {isLoading && (
                <div className="rounded-lg px-4 py-3"><span className="text-sm text-muted-foreground">Generating response <span className="bouncing-dots"><span></span><span></span><span></span></span></span></div>
              )}
            </div>
          </div>
      <div className="prompt-container" style={{ left: 'calc(50% + ' + (navigationOpen && !isMobile ? 150 : 0) + 'px)' }}>
            {files.length > 0 && (
              <div className="prompt-file-chips">
                {files.map((file, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 text-xs">
                    <FileIcon className="h-3 w-3" />{file.name}
                    <button onClick={() => setFiles(f => f.filter((_, idx) => idx !== i))} className="ml-1 hover:text-red-500"><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
                {files.length > 1 && (
                  <button onClick={() => setFiles([])} className="text-xs text-muted-foreground hover:text-red-500 transition-colors px-1">Clear all</button>
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask, Search or Chat..."
              className="prompt-textarea"
              rows={1}
              onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
            />
            <div className="prompt-toolbar">
              <div className="prompt-toolbar-left">
                <button type="button" className="prompt-icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach files">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
                <input ref={fileInputRef} type="file" multiple accept=".txt,.pdf,.doc,.docx,.csv,.md,.html,.xls,.xlsx,.png,.jpeg,.jpg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => { setFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = ''; }} />
              </div>
              <div className="prompt-toolbar-right">
                <Popover open={modelPopoverOpen} onOpenChange={(open) => { setModelPopoverOpen(open); if (!open) setModelSearch(''); }}>
                  <PopoverTrigger asChild>
                    <button className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 rounded-md">
                      {modelOptions.find(m => m.value === modelId)?.label || 'Select model'} <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 4L5 6.5L7.5 4" /></svg>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[600px] p-0" align="end">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models..."
                        className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                      {filteredModelOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No models found</div>
                      ) : filteredModelOptions.map(m => (
                        <button
                          key={m.value}
                          onClick={() => { setModelId(m.value); setModelPopoverOpen(false); setModelSearch(''); }}
                          className={`w-full text-left px-3 py-1.5 text-sm rounded-sm flex items-center gap-2 transition-colors ${m.value === modelId ? 'bg-accent' : 'hover:bg-accent/50'}`}
                        >
                          <span className="flex-1">{m.label}</span>
                          {m.detail && <span className="text-xs text-muted-foreground truncate max-w-[140px]">{m.detail}</span>}
                          {m.value === modelId && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <button type="button" className="prompt-send-btn" onClick={handleSubmit} disabled={!input.trim() && files.length === 0} aria-label="Send message">
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
    </div>
  );
});
ChatUI.displayName = 'ChatUI';
export default ChatUI;
