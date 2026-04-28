// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { coldarkDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Check, ThumbsUp, ThumbsDown, Download } from 'lucide-react';
import { convHistory } from './ConvHistory';
import CitationBar from './CitationBar';
import ExportModal from './ExportModal';

const CodeBlock = React.memo(({ inline, className, children }) => {
  const [copied, setCopied] = useState(false);
  const isInline = !className && !String(children).includes('\n');
  if (isInline) return <code className="inline-code">{children}</code>;
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const handleCopy = async () => { try { await navigator.clipboard.writeText(String(children)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  return (
    <div className="code-block-wrapper">
      <SyntaxHighlighter language={language} style={coldarkDark} customStyle={{ padding: '1em', borderRadius: '5px', fontSize: '14px', backgroundColor: '#1e1e1e', marginBottom: '0' }}>{String(children).replace(/\n$/, '')}</SyntaxHighlighter>
      <div className="code-block-footer">
        <div style={{ flex: 1 }}>{language !== 'text' && <div className="code-block-language">{language}</div>}</div>
        <button onClick={handleCopy} className="p-1.5 rounded text-white hover:bg-white/10 transition-colors">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
      </div>
    </div>
  );
});
CodeBlock.displayName = 'CodeBlock';

const MessageActions = ({ text, timestamp, userEmail, credentials, sessionId }) => {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [exportVisible, setExportVisible] = useState(false);
  const handleCopy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  const handleFeedback = async (type) => { try { await convHistory.updateFeedback(userEmail, timestamp, type, credentials, sessionId); setFeedback(type); } catch {} };
  return (
    <>
      <div className="flex items-center gap-1 mt-1">
        <Tooltip><TooltipTrigger asChild><button onClick={() => handleFeedback('helpful')} className={`p-1 rounded hover:bg-accent ${feedback === 'helpful' ? 'text-green-500' : 'text-muted-foreground'}`}><ThumbsUp className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Helpful</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={() => handleFeedback('not-helpful')} className={`p-1 rounded hover:bg-accent ${feedback === 'not-helpful' ? 'text-red-500' : 'text-muted-foreground'}`}><ThumbsDown className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Not helpful</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={handleCopy} className="p-1 rounded hover:bg-accent text-muted-foreground">{copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}</button></TooltipTrigger><TooltipContent>{copied ? 'Copied!' : 'Copy'}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={() => setExportVisible(true)} className="p-1 rounded hover:bg-accent text-muted-foreground"><Download className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>Export as PDF</TooltipContent></Tooltip>
      </div>
      <ExportModal visible={exportVisible} onDismiss={() => setExportVisible(false)} markdownContent={text} />
    </>
  );
};

const ChatMessage = React.memo(({ message, username, userInitials, userEmail, credentials, sessionId, modelId }) => {
  const isUser = message.role === 'user';
  const messageText = message.content?.[0]?.text;
  const isStreaming = message.isStreaming;
  const citationChipRefs = useRef({});
  const allRefs = useMemo(() => {
    if (!message.citations || message.citations.length === 0) return [];
    const refs = []; const seenUris = new Set();
    message.citations.forEach(citation => { (citation.retrievedReferences || []).forEach(ref => { const loc = ref.location; const uri = loc?.s3Location?.uri || loc?.webLocation?.url || loc?.confluenceLocation?.url || loc?.sharePointLocation?.url || loc?.kendraDocumentLocation?.uri || loc?.customDocumentLocation?.id; if (uri && !seenUris.has(uri)) { seenUris.add(uri); refs.push({ uri, location: loc, content: ref.content, metadata: ref.metadata }); } }); });
    return refs;
  }, [message.citations]);
  const { textWithCitations, citationDetails } = useMemo(() => {
    if (!message.citations || message.citations.length === 0 || !messageText) return { textWithCitations: null, citationDetails: [] };
    const markers = []; const details = [];
    message.citations.forEach((citation) => {
      const span = citation.generatedResponsePart?.textResponsePart?.span;
      const spanText = citation.generatedResponsePart?.textResponsePart?.text;
      if (span && span.start !== undefined && span.end !== undefined) {
        const refs = citation.retrievedReferences || [];
        const fileNames = [...new Set(refs.map(ref => { const rl = ref.location; const ru = rl?.s3Location?.uri || rl?.webLocation?.url || rl?.confluenceLocation?.url || rl?.sharePointLocation?.url || rl?.kendraDocumentLocation?.uri || rl?.customDocumentLocation?.id; if (!ru) return null; try { return decodeURIComponent(ru).split('/').pop(); } catch { return ru.split('/').pop(); } }).filter(Boolean))];
        const fl = refs[0]?.location; const uri = fl?.s3Location?.uri || fl?.webLocation?.url || fl?.confluenceLocation?.url || fl?.sharePointLocation?.url || fl?.kendraDocumentLocation?.uri || fl?.customDocumentLocation?.id;
        markers.push({ end: span.end, citNum: markers.length + 1 });
        details.push({ citNum: markers.length, uri, fileNames, spanText: spanText || null, refCount: refs.length });
      }
    });
    if (markers.length === 0) return { textWithCitations: null, citationDetails: [] };
    markers.sort((a, b) => b.end - a.end);
    let result = messageText;
    markers.forEach(({ end, citNum }) => { if (end <= result.length) result = result.slice(0, end) + ` [${citNum}]` + result.slice(end); });
    return { textWithCitations: result, citationDetails: details };
  }, [message.citations, messageText]);
  const renderTextWithCitations = (text) => {
    if (!allRefs.length && citationDetails.length === 0) return text;
    const parts = text.split(/(\[\d+\])/g); if (parts.length === 1) return text;
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const num = parseInt(match[1], 10); const detail = citationDetails[num - 1]; if (!detail) return part;
        const displayName = detail.fileNames.length > 0 ? detail.fileNames.join(', ') : 'Unknown source';
        return (<Popover key={i}><PopoverTrigger asChild><span className="inline-citation-link" role="button" tabIndex={0}>[{num}]</span></PopoverTrigger><PopoverContent className="w-64"><div className="space-y-1"><p className="text-sm font-semibold">{displayName}</p>{detail.spanText && <p className="text-xs text-muted-foreground">"{detail.spanText}"</p>}<p className="text-xs text-muted-foreground italic">{detail.refCount} source ref{detail.refCount !== 1 ? 's' : ''}</p></div></PopoverContent></Popover>);
      }
      return part;
    });
  };
  const markdownComponents = useMemo(() => ({
    code: CodeBlock,
    p: ({ children }) => <p>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithCitations(child) : child)}</p>,
    li: ({ children, ...props }) => <li {...props}>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithCitations(child) : child)}</li>,
  }), [allRefs, citationDetails]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!messageText) return null;
  return (
    <div className={`${isUser ? 'flex justify-end' : ''}`}>
      <div className={`rounded-lg px-4 py-3 ${isUser ? 'bg-secondary text-foreground max-w-[85%]' : 'w-full'}`}>
        {isUser ? <span className="text-sm">{messageText}</span> : <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={markdownComponents}>{textWithCitations || messageText}</ReactMarkdown></div>}
        {isStreaming && <span className="bouncing-dots"><span></span><span></span><span></span></span>}
        {!isUser && !isStreaming && message.citations && <CitationBar citations={message.citations} credentials={credentials} citationChipRefs={citationChipRefs} />}
        {!isUser && !isStreaming && <MessageActions text={messageText} timestamp={message.timestamp} userEmail={userEmail} credentials={credentials} sessionId={sessionId} />}
      </div>
    </div>
  );
}, (prev, next) => prev.message.content[0]?.text === next.message.content[0]?.text && prev.message.timestamp === next.message.timestamp && prev.message.isStreaming === next.message.isStreaming && prev.message.citations === next.message.citations && prev.username === next.username && prev.sessionId === next.sessionId && prev.modelId === next.modelId);
ChatMessage.displayName = 'ChatMessage';
export default ChatMessage;
