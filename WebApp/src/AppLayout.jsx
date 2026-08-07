// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { signOut, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { CredentialsContext } from './SessionContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Moon, Sun, Upload, Globe, RefreshCw, FileText, Users, PanelLeftClose, PanelLeft, ExternalLink, User, LogOut, Trash2, Clock, ArrowUpRight, ArrowDownLeft, Shield } from 'lucide-react';
import ChatUI from './ChatUI';
import S3Upload from './S3Upload';
import WebsiteCrawler from './WebsiteCrawler';
import PersonaManager from './PersonaManager';
import KbSync from './KbSync';
import AgentInstructions from './AgentInstructions';
import AdminSettings from './AdminSettings';
import { bedrockConfig, config } from './aws-config';
import { convHistory } from './ConvHistory';
import { getBedrockModels } from './bedrockAgent';
import { UserPreferencesService } from './UserPreferencesService';
import { AdminService } from './AdminService';
import AWS_Logo from './images/AWS.png';
import AWS_Logo_Light from './images/AWS_Light.png';
import './Layout.css';

function Layout() {
  const ragEnabled = bedrockConfig.ragEnabled !== "false";
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [activeModal, setActiveModal] = useState(null);
  const [navigationOpen, setNavigationOpen] = useState(window.innerWidth > 768);
  const credentials = useContext(CredentialsContext);
  const [topNavModels, setTopNavModels] = useState([]);
  const [foundationModels, setFoundationModels] = useState([]);
  const [chatTypes] = useState([{ id: 'RAG', text: 'Bedrock Knowledge Base Chat (RAG)' }, { id: 'LLM', text: 'General Chat' }]);
  const [chatType, setChatType] = useState(bedrockConfig.defaultChatType);
  const [modelId, setModelId] = useState(bedrockConfig.defaultModelId);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [mode, setMode] = useState('dark');
  const [personaRefreshTrigger, setPersonaRefreshTrigger] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPreferences, setUserPreferences] = useState(null);
  const chatUIRef = useRef(null);

  const filteredChatTypes = useMemo(() => ragEnabled ? chatTypes : chatTypes.filter(t => t.id !== 'RAG'), [chatTypes, ragEnabled]);
  useEffect(() => { if (!ragEnabled && chatType === 'RAG') setChatType('LLM'); }, [ragEnabled, chatType]);

  // Apply dark/light mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, [mode]);

  // Set dark mode on mount
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);

  const handlePersonaChange = () => setPersonaRefreshTrigger(prev => prev + 1);

  // Called when admin updates the system-wide default model
  const handleAdminModelChange = (newModelId) => {
    // If the current user has no personal override, update their active model to the new admin default
    if (!userPreferences?.defaultModelId) {
      setModelId(newModelId);
    }
  };

  // Called when user updates their personal default model
  const handleUserModelChange = (newModelId) => {
    if (newModelId) {
      setModelId(newModelId);
      setUserPreferences(prev => ({ ...prev, defaultModelId: newModelId }));
    } else {
      // User cleared their preference, fall back to admin/system default
      setModelId(bedrockConfig.defaultModelId);
      setUserPreferences(prev => ({ ...prev, defaultModelId: '' }));
    }
  };

  const loadSessionHistory = async (sessionID, userID) => {
    try {
      const sessionHistory = await convHistory.loadSessionHistory(userID, sessionID, credentials);
      const historyModelId = sessionHistory.length > 0 ? sessionHistory[0].modelId : null;
      const historyChatType = sessionHistory.length > 0 ? sessionHistory[0].chatType : null;
      const historyPersonaId = sessionHistory.length > 0 ? sessionHistory[0].personaId : null;
      const formattedMessages = [];
      sessionHistory.forEach(msg => {
        formattedMessages.push({ role: 'user', content: [{ text: msg.question }], timestamp: msg.timestamp });
        if (msg.response) formattedMessages.push({ role: 'assistant', content: [{ text: msg.response }], timestamp: msg.timestamp });
      });
      if (chatUIRef.current) chatUIRef.current.updateState(formattedMessages, sessionID, historyModelId, historyChatType, historyPersonaId);
    } catch (error) { console.error('Error loading session history:', error); }
  };

  const handleDeleteConversation = async (sessionID) => {
    try { await convHistory.deleteSessionHistory(email, sessionID, credentials); setConversationHistory(prev => prev.filter(item => item.sessionID !== sessionID)); }
    catch (error) { console.error('Error deleting conversation:', error); }
  };

  useEffect(() => {
    (async () => { try { const attrs = await fetchUserAttributes(); setEmail(attrs.email); setUsername(attrs.email); } catch {} })();
  }, []);

  useEffect(() => {
    if (!credentials) return;
    (async () => {
      try {
        const history = await convHistory.loadUserHistory(email || (await fetchUserAttributes()).email, credentials);
        if (Array.isArray(history) && history.length > 0) setConversationHistory(history);
      } catch {}
    })();
  }, [credentials]);

  // Load user preferences and resolve effective default model
  useEffect(() => {
    if (!credentials || !email) return;
    (async () => {
      try {
        // Check admin status from cached config
        setIsAdmin(AdminService.isAdmin());

        // Load user preferences from DynamoDB
        const prefs = await UserPreferencesService.getUserPreferences(email, credentials);
        setUserPreferences(prefs);

        // Resolve effective model: user preference > admin default (SSM/bedrockConfig) > deploy-time default
        if (prefs?.defaultModelId) {
          setModelId(prefs.defaultModelId);
        }
        // If no user preference, modelId already defaults to bedrockConfig.defaultModelId (set in useState)
      } catch (err) {
        if (config.debug) {
          console.error('Error loading user preferences:', err);
        }
      }
    })();
  }, [credentials, email]);

  useEffect(() => {
    (async () => {
      try {
        const models = await getBedrockModels(credentials);
        setFoundationModels(models.modelSummaries);
        const formatted = models.modelSummaries.map(m => {
          const name = m.modelName.startsWith(m.providerName) ? m.modelName : `${m.providerName} ${m.modelName}`;
          return { id: m.modelId, text: name, detail: m.modelId };
        });
        if (!formatted.some(m => m.id === bedrockConfig.defaultModelId)) {
          const defName = bedrockConfig.defaultModelName?.startsWith(bedrockConfig.defaultModelProvider) ? bedrockConfig.defaultModelName : `${bedrockConfig.defaultModelProvider} ${bedrockConfig.defaultModelName}`;
          formatted.push({ id: bedrockConfig.defaultModelId, text: defName, detail: bedrockConfig.defaultModelId });
        }
        formatted.sort((a, b) => a.text.localeCompare(b.text));
        setTopNavModels(formatted);
      } catch {}
    })();
  }, [credentials]);

  async function handleSignOut() { try { await signOut(); window.location.href = '/'; } catch {} }

  // Build conversation history sidebar items
  const sessionMap = new Map();
  const sortedHistory = [...conversationHistory].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  sortedHistory.forEach(msg => { if (msg?.sessionID && !sessionMap.has(msg.sessionID)) sessionMap.set(msg.sessionID, msg); });
  const sortedSessions = Array.from(sessionMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const calculateSessionTokens = (sessionID) => {
    const msgs = conversationHistory.filter(m => m.sessionID === sessionID);
    return { inputTokens: msgs.reduce((s, m) => s + (m.inputTokens || 0), 0), outputTokens: msgs.reduce((s, m) => s + (m.outputTokens || 0), 0) };
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 bg-card px-4 h-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setNavigationOpen(!navigationOpen)} aria-label="Toggle sidebar">
            {navigationOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>
          <img src={mode === 'dark' ? AWS_Logo : AWS_Logo_Light} alt="AWS" className="h-6" />
          <span className="font-semibold text-sm hidden sm:inline">Amazon Bedrock Chatbot powered by AWS</span>
        </div>
        <div className="flex items-center gap-2">
          <a href="https://aws.amazon.com/bedrock/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs px-3 h-8 rounded-md hover:bg-accent transition-colors">Bedrock<ExternalLink className="h-3 w-3" /></a>
          <Tooltip><TooltipTrigger asChild>
            <button className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent transition-colors" onClick={() => setMode(m => m === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </TooltipTrigger><TooltipContent>{mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</TooltipContent></Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent transition-colors"><User className="h-4 w-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{email || 'User'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}><LogOut className="h-4 w-4 mr-2" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {navigationOpen && (
          <aside className="w-[280px] bg-card flex flex-col shrink-0 overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-4">
                {isAdmin && ragEnabled && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Knowledge Base</p>
                    <div className="space-y-1">
                      <button onClick={() => setActiveModal('upload')} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"><Upload className="h-4 w-4" />Upload documents to S3</button>
                      <button onClick={() => setActiveModal('crawl')} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"><Globe className="h-4 w-4" />Add website to crawl</button>
                      <button onClick={() => setActiveModal('sync')} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"><RefreshCw className="h-4 w-4" />Sync Knowledge Base</button>
                    </div>
                  </div>
                )}
                {isAdmin && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Administration</p>
                    <div className="space-y-1">
                      <button onClick={() => setActiveModal('instructions')} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"><FileText className="h-4 w-4" />Update Agent Instructions</button>
                      <button onClick={() => setActiveModal('adminSettings')} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"><Shield className="h-4 w-4" />System Default Model</button>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Personas</p>
                  <button onClick={() => setActiveModal('personas')} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"><Users className="h-4 w-4" />Manage AI Personas</button>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Conversation History</p>
                  <div className="space-y-1">
                    {sortedSessions.map(msg => {
                      if (!msg?.question || !msg?.timestamp) return null;
                      const { inputTokens, outputTokens } = calculateSessionTokens(msg.sessionID);
                      return (
                        <div key={msg.sessionID} className="group rounded-lg border border-border dark:border-white/15 p-2 cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => loadSessionHistory(msg.sessionID, msg.userID)}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium border-l-2 border-primary pl-2 break-words leading-tight">{msg.question.length > 50 ? `${msg.question.substring(0, 47)}...` : msg.question}</p>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteConversation(msg.sessionID); }} className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500 transition-all shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />{new Date(msg.timestamp).toLocaleString()}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-0.5"><ArrowUpRight className="h-3 w-3" />{inputTokens}</span>
                            <span className="flex items-center gap-0.5"><ArrowDownLeft className="h-3 w-3" />{outputTokens}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-auto" style={{ maxHeight: 'calc(100vh - 48px)' }}>
          <div className="p-4 h-full">
            <ChatUI ref={chatUIRef} chatType={chatType} setChatType={setChatType} chatTypes={filteredChatTypes} modelId={modelId} setModelId={setModelId} topNavModels={topNavModels} foundationModels={foundationModels} conversationHistory={conversationHistory} setConversationHistory={setConversationHistory} username={username} navigationOpen={navigationOpen} personaRefreshTrigger={personaRefreshTrigger} userPreferences={userPreferences} userEmail={email} onSetDefaultModel={handleUserModelChange} />
          </div>
        </main>
      </div>

      {/* Modals */}
      <Dialog open={activeModal === 'upload'} onOpenChange={(open) => !open && setActiveModal(null)}><DialogContent><DialogHeader><DialogTitle>Upload Documents to S3</DialogTitle></DialogHeader><S3Upload /></DialogContent></Dialog>
      <Dialog open={activeModal === 'sync'} onOpenChange={(open) => !open && setActiveModal(null)}><DialogContent><DialogHeader><DialogTitle>Sync Bedrock Knowledge Base</DialogTitle></DialogHeader><KbSync /></DialogContent></Dialog>
      <Dialog open={activeModal === 'instructions'} onOpenChange={(open) => !open && setActiveModal(null)}><DialogContent><DialogHeader><DialogTitle>Update Bedrock Agent Instructions</DialogTitle></DialogHeader><AgentInstructions /></DialogContent></Dialog>
      <Dialog open={activeModal === 'crawl'} onOpenChange={(open) => !open && setActiveModal(null)}><DialogContent size="large"><DialogHeader><DialogTitle>Add Website to Knowledge Base</DialogTitle></DialogHeader><WebsiteCrawler /></DialogContent></Dialog>
      <Dialog open={activeModal === 'personas'} onOpenChange={(open) => !open && setActiveModal(null)}><DialogContent size="max"><DialogHeader><DialogTitle>Manage AI Personas</DialogTitle></DialogHeader><PersonaManager onPersonasChange={handlePersonaChange} /></DialogContent></Dialog>
      <Dialog open={activeModal === 'adminSettings'} onOpenChange={(open) => !open && setActiveModal(null)}><DialogContent><DialogHeader><DialogTitle>Admin: System Default Model</DialogTitle></DialogHeader><AdminSettings topNavModels={topNavModels} foundationModels={foundationModels} onModelChange={handleAdminModelChange} onClose={() => setActiveModal(null)} /></DialogContent></Dialog>
    </div>
  );
}

export default Layout;
