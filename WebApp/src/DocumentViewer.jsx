// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import mammoth from 'mammoth';
import DOMPurify from 'dompurify';

// Safe HTML renderer — uses a ref + DOMPurify instead of dangerouslySetInnerHTML
const SafeHtml = ({ html, className }) => {
  const containerRef = useRef(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = DOMPurify.sanitize(html, {
        ADD_TAGS: ['mark'],
        ADD_ATTR: ['data-citation']
      });
    }
  }, [html]);
  return <div className={className} ref={containerRef} />;
};
import {
  Modal,
  Box,
  SpaceBetween,
  Button,
  Spinner,
  StatusIndicator,
  Icon
} from '@cloudscape-design/components';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './DocumentViewer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Supported file types
const VIEWABLE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md', '.html', '.htm', '.csv'];

const getFileExtension = (uri) => {
  try {
    const decoded = decodeURIComponent(uri);
    const fileName = decoded.split('/').pop().split('?')[0];
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex >= 0 ? fileName.substring(dotIndex).toLowerCase() : '';
  } catch {
    return '';
  }
};

export const isViewableFile = (uri) => {
  const ext = getFileExtension(uri);
  return VIEWABLE_EXTENSIONS.includes(ext);
};

// Collapse whitespace while tracking original positions
const collapseWhitespace = (text) => {
  const collapsed = [];
  const posMap = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace && collapsed.length > 0) {
        collapsed.push(' ');
        posMap.push(i);
        inSpace = true;
      }
    } else {
      collapsed.push(ch);
      posMap.push(i);
      inSpace = false;
    }
  }
  return { text: collapsed.join(''), posMap };
};

// Find citation text in document text, returning positions in the ORIGINAL text.
// Collapses whitespace, does case-insensitive substring search, maps back to original.
// Falls back to word-overlap matching with high threshold.
const findCitationInText = (docText, citationText) => {
  if (!docText || !citationText || citationText.length < 10) return null;

  const doc = collapseWhitespace(docText);
  const cit = collapseWhitespace(citationText);
  const docLower = doc.text.toLowerCase();
  const citLower = cit.text.toLowerCase();

  // 1. Full substring match
  let idx = docLower.indexOf(citLower);
  if (idx !== -1) {
    return {
      start: doc.posMap[idx],
      end: doc.posMap[Math.min(idx + citLower.length - 1, doc.posMap.length - 1)] + 1
    };
  }

  // 2. First 120 chars match
  const shortLen = Math.min(120, citLower.length);
  const shortCit = citLower.substring(0, shortLen);
  idx = docLower.indexOf(shortCit);
  if (idx !== -1) {
    const endIdx = Math.min(idx + citLower.length, doc.text.length);
    return {
      start: doc.posMap[idx],
      end: doc.posMap[Math.min(endIdx - 1, doc.posMap.length - 1)] + 1
    };
  }

  // 3. Last 120 chars match
  if (citLower.length > 120) {
    const tailCit = citLower.substring(citLower.length - 120);
    idx = docLower.indexOf(tailCit);
    if (idx !== -1) {
      const startIdx = Math.max(0, idx - (citLower.length - 120));
      return {
        start: doc.posMap[startIdx],
        end: doc.posMap[Math.min(idx + 120 - 1, doc.posMap.length - 1)] + 1
      };
    }
  }

  // 4. Word-overlap sliding window (80% threshold)
  const docWords = docLower.split(/\s+/).filter(Boolean);
  const citWords = citLower.split(/\s+/).filter(Boolean);
  if (citWords.length < 3) return null;

  const significantCitWords = citWords.filter(w => w.length > 2);
  if (significantCitWords.length < 3) return null;

  const winSize = Math.min(citWords.length * 2, docWords.length);
  let bestScore = 0;
  let bestWinStart = -1;

  for (let i = 0; i <= docWords.length - winSize; i++) {
    const windowWords = new Set(docWords.slice(i, i + winSize));
    const matchCount = significantCitWords.filter(w => windowWords.has(w)).length;
    const score = matchCount / significantCitWords.length;
    if (score > bestScore) {
      bestScore = score;
      bestWinStart = i;
    }
  }

  if (bestScore < 0.8 || bestWinStart < 0) return null;

  let charPos = 0;
  let startCharPos = 0;
  let endCharPos = doc.text.length;
  for (let w = 0; w < docWords.length; w++) {
    const wordIdx = docLower.indexOf(docWords[w], charPos);
    if (wordIdx === -1) { charPos += docWords[w].length + 1; continue; }
    if (w === bestWinStart) startCharPos = wordIdx;
    if (w === bestWinStart + winSize - 1) { endCharPos = wordIdx + docWords[w].length; break; }
    charPos = wordIdx + docWords[w].length;
  }

  return {
    start: doc.posMap[Math.min(startCharPos, doc.posMap.length - 1)],
    end: doc.posMap[Math.min(endCharPos - 1, doc.posMap.length - 1)] + 1
  };
};

// Highlight text content with citation matches
const HighlightedText = ({ text, citationTexts }) => {
  const highlights = useMemo(() => {
    const allMatches = [];
    citationTexts.forEach((citation, idx) => {
      const match = findCitationInText(text, citation);
      if (match) allMatches.push({ ...match, citationIdx: idx });
    });
    allMatches.sort((a, b) => a.start - b.start);
    const deduped = [];
    for (const m of allMatches) {
      if (deduped.length === 0 || m.start >= deduped[deduped.length - 1].end) {
        deduped.push(m);
      }
    }
    return deduped;
  }, [text, citationTexts]);

  if (highlights.length === 0) {
    return <pre className="doc-viewer-text-content">{text}</pre>;
  }

  const segments = [];
  let lastEnd = 0;
  highlights.forEach((h, i) => {
    if (h.start > lastEnd) {
      segments.push({ text: text.substring(lastEnd, h.start), highlight: false });
    }
    segments.push({
      text: text.substring(h.start, h.end),
      highlight: true,
      citationIdx: h.citationIdx,
      id: `highlight-${i}`
    });
    lastEnd = h.end;
  });
  if (lastEnd < text.length) {
    segments.push({ text: text.substring(lastEnd), highlight: false });
  }

  return (
    <pre className="doc-viewer-text-content">
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark key={i} id={seg.id} className="doc-viewer-highlight" title={`Citation ${seg.citationIdx + 1}`}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </pre>
  );
};

// PDF Viewer with text layer highlighting
const PdfViewer = ({ url, citationTexts, activeCitation }) => {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loadError, setLoadError] = useState(null);
  const [citationPageMap, setCitationPageMap] = useState({}); // { citationIdx: pageNum }
  const pdfDocRef = useRef(null);

  // After PDF loads, scan all pages to build a citation→page map
  const buildCitationPageMap = useCallback(async (pdf) => {
    if (!citationTexts.length || !pdf) return;
    const map = {};
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        citationTexts.forEach((citation, idx) => {
          if (map[idx] !== undefined) return; // already found
          if (findCitationInText(pageText, citation)) {
            map[idx] = pageNum;
          }
        });
      } catch { /* skip */ }
      // Early exit if all found
      if (Object.keys(map).length === citationTexts.length) break;
    }
    setCitationPageMap(map);
    // Navigate to first citation's page
    if (map[0] !== undefined) {
      setCurrentPage(map[0]);
    }
  }, [citationTexts]);

  const onDocumentLoadSuccess = (pdf) => {
    setNumPages(pdf.numPages);
    setLoadError(null);
    pdfDocRef.current = pdf;
    buildCitationPageMap(pdf);
  };

  const onDocumentLoadError = (error) => {
    console.error('PDF load error:', error);
    setLoadError('Failed to load PDF document');
  };

  const scrollToActivePdfHighlight = useCallback((citIdx) => {
    setTimeout(() => {
      const allHighlighted = document.querySelectorAll('.doc-viewer-pdf-highlight');
      allHighlighted.forEach(el => el.classList.remove('doc-viewer-pdf-highlight-active'));
      const targets = document.querySelectorAll(`.doc-viewer-pdf-highlight[data-citation="${citIdx}"]`);
      if (targets.length > 0) {
        targets.forEach(el => el.classList.add('doc-viewer-pdf-highlight-active'));
        targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, []);

  const activeCitationRef = useRef(activeCitation);
  activeCitationRef.current = activeCitation;

  const highlightTextLayer = useCallback((pageNum) => {
    setTimeout(() => {
      const textLayer = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageNum}"] .react-pdf__Page__textContent`
      );
      if (!textLayer) return;

      // Clear any existing highlights first to prevent double-highlighting
      textLayer.querySelectorAll('.doc-viewer-pdf-highlight').forEach(el => {
        el.classList.remove('doc-viewer-pdf-highlight', 'doc-viewer-pdf-highlight-active');
        el.removeAttribute('data-citation');
      });

      const spans = textLayer.querySelectorAll('span');
      const pageText = Array.from(spans).map(s => s.textContent).join(' ');

      citationTexts.forEach((citation, citIdx) => {
        const match = findCitationInText(pageText, citation);
        if (!match) return;
        let charPos = 0;
        spans.forEach(span => {
          const spanStart = charPos;
          const spanEnd = charPos + span.textContent.length;
          charPos = spanEnd + 1;
          if (spanStart < match.end && spanEnd > match.start) {
            span.classList.add('doc-viewer-pdf-highlight');
            span.setAttribute('data-citation', String(citIdx));
          }
        });
      });

      // After highlighting, scroll to active citation if it's on this page
      const current = activeCitationRef.current;
      if (current !== undefined && current !== null) {
        scrollToActivePdfHighlight(current);
      }
    }, 300);
  }, [citationTexts, scrollToActivePdfHighlight]);

  // When activeCitation changes, navigate to its page and scroll after render
  useEffect(() => {
    if (activeCitation === undefined || activeCitation === null) return;
    const targetPage = citationPageMap[activeCitation];
    if (targetPage === undefined) return;

    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
      // highlightTextLayer will fire after page renders and call onCitationLocated
    } else {
      // Same page — just scroll to the right highlight
      scrollToActivePdfHighlight(activeCitation);
    }
  }, [activeCitation, citationPageMap]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <Box textAlign="center" padding="xl">
        <StatusIndicator type="error">{loadError}</StatusIndicator>
      </Box>
    );
  }

  return (
    <div className="doc-viewer-pdf-container">
      <div className="doc-viewer-pdf-toolbar">
        <button className="doc-viewer-toolbar-btn" disabled={currentPage <= 1}
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))} aria-label="Previous page">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="#545b64" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="doc-viewer-toolbar-text">Page {currentPage} of {numPages || '...'}</span>
        <button className="doc-viewer-toolbar-btn" disabled={currentPage >= numPages}
          onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} aria-label="Next page">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#545b64" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="doc-viewer-toolbar-divider">|</span>
        <button className="doc-viewer-toolbar-btn" disabled={scale <= 0.5}
          onClick={() => setScale(s => Math.max(0.5, s - 0.2))} aria-label="Zoom out">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#545b64" strokeWidth="1.5"/><path d="M11 11l3 3M5 7h4" stroke="#545b64" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        <span className="doc-viewer-toolbar-text">{Math.round(scale * 100)}%</span>
        <button className="doc-viewer-toolbar-btn" disabled={scale >= 3}
          onClick={() => setScale(s => Math.min(3, s + 0.2))} aria-label="Zoom in">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="#545b64" strokeWidth="1.5"/><path d="M11 11l3 3M5 7h4M7 5v4" stroke="#545b64" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
      <div className="doc-viewer-pdf-scroll" onClick={(e) => {
        // Clicking the page area clears active highlight (unless clicking a highlighted span itself)
        if (!e.target.classList.contains('doc-viewer-pdf-highlight')) {
          document.querySelectorAll('.doc-viewer-pdf-highlight-active')
            .forEach(el => el.classList.remove('doc-viewer-pdf-highlight-active'));
        }
      }}>
        <Document file={url} onLoadSuccess={onDocumentLoadSuccess} onLoadError={onDocumentLoadError}
          loading={<Box textAlign="center" padding="xl"><Spinner size="large" /><Box variant="p" color="text-body-secondary">Loading PDF...</Box></Box>}>
          <Page pageNumber={currentPage} scale={scale} renderTextLayer={true} renderAnnotationLayer={true}
            onRenderTextLayerSuccess={() => highlightTextLayer(currentPage)}
            loading={<Box textAlign="center" padding="l"><Spinner /></Box>} />
        </Document>
      </div>
    </div>
  );
};

// DOCX Viewer
const DocxViewer = ({ url, citationTexts }) => {
  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadDocx = async () => {
      try {
        setLoading(true);
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        let html = result.value;

        // Highlight citations by finding them in plain text then locating in HTML
        const plainText = html.replace(/<[^>]+>/g, '');
        citationTexts.forEach((citation, idx) => {
          if (!citation || citation.length < 10) return;
          const match = findCitationInText(plainText, citation);
          if (!match) return;
          const snippet = plainText.substring(match.start, Math.min(match.start + 80, match.end));
          const pattern = snippet.split('').map(ch => {
            if (/[.*+?^${}()|[\]\\]/.test(ch)) return '\\' + ch;
            if (/\s/.test(ch)) return '[\\s\\S]*?';
            return ch;
          }).join('');
          try {
            const regex = new RegExp(pattern, 'i');
            html = html.replace(regex, (m) =>
              '<mark class="doc-viewer-highlight" data-citation="' + idx + '" title="Citation ' + (idx + 1) + '">' + m + '</mark>'
            );
          } catch { /* skip */ }
        });

        setHtmlContent(html);
        setError(null);
      } catch (err) {
        console.error('DOCX load error:', err);
        setError('Failed to load document');
      } finally {
        setLoading(false);
      }
    };
    loadDocx();
  }, [url, citationTexts]);

  if (loading) {
    return (<Box textAlign="center" padding="xl"><Spinner size="large" /><Box variant="p" color="text-body-secondary">Converting document...</Box></Box>);
  }
  if (error) {
    return (<Box textAlign="center" padding="xl"><StatusIndicator type="error">{error}</StatusIndicator></Box>);
  }
  return (<SafeHtml className="doc-viewer-docx-content" html={htmlContent} />);
};

// Plain text / Markdown / CSV viewer
const TextViewer = ({ url, citationTexts, extension }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadText = async () => {
      try {
        setLoading(true);
        const response = await fetch(url);
        const text = await response.text();
        setContent(text);
        setError(null);
      } catch (err) {
        console.error('Text load error:', err);
        setError('Failed to load file');
      } finally {
        setLoading(false);
      }
    };
    loadText();
  }, [url]);

  if (loading) {
    return (<Box textAlign="center" padding="xl"><Spinner size="large" /><Box variant="p" color="text-body-secondary">Loading file...</Box></Box>);
  }
  if (error) {
    return (<Box textAlign="center" padding="xl"><StatusIndicator type="error">{error}</StatusIndicator></Box>);
  }

  // HTML files render directly
  if (extension === '.html' || extension === '.htm') {
    let html = content;
    const plainText = html.replace(/<[^>]+>/g, '');
    citationTexts.forEach((citation, idx) => {
      if (!citation || citation.length < 10) return;
      const match = findCitationInText(plainText, citation);
      if (!match) return;
      const snippet = plainText.substring(match.start, Math.min(match.start + 80, match.end));
      const pattern = snippet.split('').map(ch => {
        if (/[.*+?^${}()|[\]\\]/.test(ch)) return '\\' + ch;
        if (/\s/.test(ch)) return '[\\s\\S]*?';
        return ch;
      }).join('');
      try {
        const regex = new RegExp(pattern, 'i');
        html = html.replace(regex, (m) =>
          '<mark class="doc-viewer-highlight" data-citation="' + idx + '" title="Citation ' + (idx + 1) + '">' + m + '</mark>'
        );
      } catch { /* skip */ }
    });
    return (<SafeHtml className="doc-viewer-html-content" html={html} />);
  }

  // CSV renders as a table
  if (extension === '.csv') {
    const rows = content.split('\n').filter(r => r.trim());
    return (
      <div className="doc-viewer-csv-container">
        <table className="doc-viewer-csv-table">
          <thead>
            {rows.length > 0 && (
              <tr>{rows[0].split(',').map((cell, i) => (<th key={i}>{cell.trim().replace(/^"|"$/g, '')}</th>))}</tr>
            )}
          </thead>
          <tbody>
            {rows.slice(1).map((row, i) => (
              <tr key={i}>{row.split(',').map((cell, j) => (<td key={j}>{cell.trim().replace(/^"|"$/g, '')}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <HighlightedText text={content} citationTexts={citationTexts} />;
};

// Citation navigation bar
const CitationNavigator = ({ count, currentIndex, onNavigate }) => {
  if (count === 0) return null;
  const displayIndex = currentIndex !== null && currentIndex !== undefined ? currentIndex : -1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
      <Box variant="small" color="text-status-info">
        {displayIndex >= 0 ? `Citation ${displayIndex + 1} of ${count}` : `${count} citation${count !== 1 ? 's' : ''} found`}
      </Box>
      <SpaceBetween direction="horizontal" size="xxs">
        <Button iconName="angle-up" variant="icon" disabled={displayIndex <= 0}
          onClick={() => onNavigate(displayIndex <= 0 ? 0 : displayIndex - 1)} ariaLabel="Previous citation" />
        <Button iconName="angle-down" variant="icon" disabled={displayIndex >= count - 1}
          onClick={() => onNavigate(displayIndex < 0 ? 0 : displayIndex + 1)} ariaLabel="Next citation" />
      </SpaceBetween>
    </div>
  );
}

// Main DocumentViewer Modal
const DocumentViewer = ({ visible, onDismiss, fileName, fileUrl, fileUri, citationTexts = [], onDownload }) => {
  const extension = getFileExtension(fileUri || fileName || '');
  const [activeCitation, setActiveCitation] = useState(null);
  const viewerBodyRef = useRef(null);

  const scrollToHighlight = useCallback((index) => {
    if (index === null || index === undefined) return;
    setTimeout(() => {
      const container = viewerBodyRef.current;
      if (!container) return;

      // For non-PDF viewers: look for .doc-viewer-highlight marks
      const marks = container.querySelectorAll('.doc-viewer-highlight');
      if (marks.length > 0) {
        marks.forEach(m => m.classList.remove('doc-viewer-highlight-active'));
        const target = marks[Math.min(index, marks.length - 1)];
        if (target) {
          target.classList.add('doc-viewer-highlight-active');
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }

      // For PDF: handled by PdfViewer internally via activeCitation prop
    }, 100);
  }, []);

  const handleCitationNavigate = useCallback((index) => {
    setActiveCitation(index);
    scrollToHighlight(index);
  }, [scrollToHighlight]);

  useEffect(() => {
    if (visible) {
      setActiveCitation(null);
    }
  }, [visible, citationTexts]);

  const renderViewer = () => {
    if (!fileUrl) {
      return (<Box textAlign="center" padding="xl"><Spinner size="medium" /><Box variant="p" color="text-body-secondary">Loading document...</Box></Box>);
    }
    switch (extension) {
      case '.pdf': return <PdfViewer url={fileUrl} citationTexts={citationTexts} activeCitation={activeCitation} />;
      case '.docx': case '.doc': return <DocxViewer url={fileUrl} citationTexts={citationTexts} />;
      case '.txt': case '.md': case '.csv': case '.html': case '.htm':
        return <TextViewer url={fileUrl} citationTexts={citationTexts} extension={extension} />;
      default:
        return (
          <Box textAlign="center" padding="xl">
            <SpaceBetween size="m">
              <Icon name="file" size="big" />
              <Box variant="p">This file type cannot be previewed.</Box>
              {onDownload && <Button iconName="download" onClick={onDownload}>Download file</Button>}
            </SpaceBetween>
          </Box>
        );
    }
  };

  return (
    <Modal visible={visible} onDismiss={onDismiss} size="large"
      header={<SpaceBetween direction="horizontal" size="xs" alignItems="center"><Icon name="file" /><span>{fileName || 'Document Viewer'}</span></SpaceBetween>}
      footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">
        {onDownload && <Button iconName="download" onClick={onDownload}>Download</Button>}
        <Button variant="primary" onClick={onDismiss}>Close</Button>
      </SpaceBetween></Box>}
    >
      <div className="doc-viewer-modal-body" ref={viewerBodyRef} onClick={(e) => {
        // Click anywhere in the viewer body to dismiss active citation highlight
        if (!e.target.classList.contains('doc-viewer-highlight') && !e.target.classList.contains('doc-viewer-pdf-highlight')) {
          const container = viewerBodyRef.current;
          if (container) {
            container.querySelectorAll('.doc-viewer-highlight-active')
              .forEach(el => el.classList.remove('doc-viewer-highlight-active'));
          }
        }
      }}>
        {citationTexts.length > 0 && (
          <CitationNavigator count={citationTexts.length} currentIndex={activeCitation} onNavigate={handleCitationNavigate} />
        )}
        {renderViewer()}
      </div>
    </Modal>
  );
};

export default DocumentViewer;
