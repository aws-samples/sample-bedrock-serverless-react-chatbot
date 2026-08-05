// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FileIcon, ExternalLink, Download } from 'lucide-react';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bedrockConfig, vpceEndpoints } from './aws-config';
import DocumentViewer, { isViewableFile } from './DocumentViewer';
import { parseS3Uri } from './utils/s3Uri';

const CitationBar = ({ citations, credentials, citationChipRefs }) => {
  const [viewerState, setViewerState] = useState({ visible: false, fileName: '', fileUrl: null, fileUri: '', citationTexts: [] });
  if (!citations || citations.length === 0) return null;
  const allRefs = []; const seenUris = new Set();
  citations.forEach(citation => {
    (citation.retrievedReferences || []).forEach(ref => {
      const loc = ref.location;
      const uri = loc?.s3Location?.uri || loc?.webLocation?.url || loc?.confluenceLocation?.url || loc?.sharePointLocation?.url || loc?.kendraDocumentLocation?.uri || loc?.customDocumentLocation?.id;
      if (uri && !seenUris.has(uri)) { seenUris.add(uri); allRefs.push({ uri, location: loc, content: ref.content, metadata: ref.metadata }); }
    });
  });
  if (allRefs.length === 0) return null;
  const getFileName = (uri) => { try { return decodeURIComponent(uri).split('/').pop() || uri; } catch { return uri.split('/').pop() || uri; } };
  const generatePresignedUrl = async (s3Uri) => {
    if (!credentials || !s3Uri) return null;
    // Handles both the canonical s3://bucket/key form and the percent-encoded HTTPS
    // form that Bedrock Managed Knowledge Bases return.
    const location = parseS3Uri(s3Uri);
    if (!location) return null;
    try { const s3Client = new S3Client({ region: bedrockConfig.region, credentials, ...(vpceEndpoints.s3 && { endpoint: vpceEndpoints.s3, forcePathStyle: true }) }); return await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: location.bucket, Key: location.key }), { expiresIn: 60 }); }
    catch { return null; }
  };
  const getCitationTextsForUri = (uri) => {
    const seen = new Set(); const texts = [];
    citations.forEach(c => { (c.retrievedReferences || []).forEach(ref => { const loc = ref.location; const refUri = loc?.s3Location?.uri || loc?.webLocation?.url || loc?.confluenceLocation?.url || loc?.sharePointLocation?.url || loc?.kendraDocumentLocation?.uri || loc?.customDocumentLocation?.id; if (refUri === uri && ref.content?.text) { const key = ref.content.text.substring(0, 100); if (!seen.has(key)) { seen.add(key); texts.push(ref.content.text); } } }); });
    return texts;
  };
  const handleChipClick = async (ref) => {
    const s3Uri = ref.location?.s3Location?.uri;
    if (s3Uri && isViewableFile(ref.uri)) { setViewerState({ visible: true, fileName: getFileName(ref.uri), fileUrl: null, fileUri: ref.uri, citationTexts: getCitationTextsForUri(ref.uri) }); const url = await generatePresignedUrl(s3Uri); if (url) setViewerState(prev => ({ ...prev, fileUrl: url })); }
    else if (s3Uri) { const url = await generatePresignedUrl(s3Uri); if (url) window.open(url, '_blank'); }
    else { window.open(ref.uri, '_blank'); }
  };
  const handleDownload = async () => { const ref = allRefs.find(r => r.uri === viewerState.fileUri); if (ref?.location?.s3Location?.uri) { const url = viewerState.fileUrl || await generatePresignedUrl(ref.location.s3Location.uri); if (url) window.open(url, '_blank'); } };
  return (
    <>
      <div className="citation-bar">
        <div className="citation-bar-label"><FileIcon className="h-3.5 w-3.5" /><span>Sources ({allRefs.length})</span></div>
        <div className="citation-chips">{allRefs.map((ref, index) => (
          <Popover key={index}>
            <PopoverTrigger asChild>
              <button className="citation-chip" ref={el => { if (citationChipRefs) citationChipRefs.current[index] = el; }} aria-label={`Citation ${index + 1}: ${getFileName(ref.uri)}`}>
                <span className="citation-chip-number">{index + 1}</span>
                {isViewableFile(ref.uri) ? <FileIcon className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
                <span className="citation-chip-text">{getFileName(ref.uri)}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-2">
                <p className="font-semibold text-sm">{getFileName(ref.uri)}</p>
                <p className="text-xs text-muted-foreground break-all">{ref.uri}</p>
                <p className="text-xs text-muted-foreground">{ref.content?.text ? (ref.content.text.length > 200 ? ref.content.text.substring(0, 200) + '...' : ref.content.text) : 'No preview'}</p>
                <div className="flex gap-2">
                  {ref.location?.s3Location?.uri && isViewableFile(ref.uri) && <Button variant="link" size="sm" onClick={() => handleChipClick(ref)} className="p-0 h-auto"><FileIcon className="h-3 w-3 mr-1" />View</Button>}
                  {ref.location?.s3Location?.uri && <Button variant="link" size="sm" onClick={async () => { const url = await generatePresignedUrl(ref.location.s3Location.uri); if (url) window.open(url, '_blank'); }} className="p-0 h-auto"><Download className="h-3 w-3 mr-1" />Download</Button>}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ))}</div>
      </div>
      <DocumentViewer visible={viewerState.visible} onDismiss={() => setViewerState(prev => ({ ...prev, visible: false }))} fileName={viewerState.fileName} fileUrl={viewerState.fileUrl} fileUri={viewerState.fileUri} citationTexts={viewerState.citationTexts} onDownload={handleDownload} />
    </>
  );
};

export default CitationBar;
