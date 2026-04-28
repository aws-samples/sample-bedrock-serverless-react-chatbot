// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext, useEffect, useRef } from 'react';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { CredentialsContext } from './SessionContext';
import { bedrockConfig, config, vpceEndpoints } from './aws-config';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, X, FileIcon, Trash2, Info } from 'lucide-react';

const PersonaDocumentUpload = ({ persona, onDocumentsChange }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState(persona.documents || []);
  const [uploadError, setUploadError] = useState(null);
  const credentials = useContext(CredentialsContext);
  const fileInputRef = useRef(null);

  const getS3Endpoint = () => {
    if (vpceEndpoints.s3) {
      const vpceUrl = new URL(vpceEndpoints.s3);
      vpceUrl.hostname = `bucket.${vpceUrl.hostname}`;
      return vpceUrl.toString();
    }
    return undefined;
  };

  useEffect(() => {
    setDocuments(persona.documents || []);
  }, [persona.documents]);

  const uploadFiles = async () => {
    if (!files.length) return;
    setUploadError(null);
    const totalDocuments = documents.length + files.length;
    if (totalDocuments > 5) {
      setUploadError(`Cannot upload ${files.length} files. Maximum 5 documents allowed per persona (currently have ${documents.length}).`);
      return;
    }
    const oversizedFiles = files.filter(file => file.size > 4.5 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      setUploadError(`Files too large: ${oversizedFiles.map(f => f.name).join(', ')}. Maximum file size is 4.5 MB.`);
      return;
    }
    const client = new S3Client({
      region: bedrockConfig.region, credentials,
      ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
      ...(vpceEndpoints.s3 && { forcePathStyle: true })
    });
    setUploading(true);
    try {
      const uploadedDocs = [];
      await Promise.all(files.map(async (file) => {
        const fileContent = await file.arrayBuffer();
        const key = `${persona.s3Prefix}${file.name}`;
        await client.send(new PutObjectCommand({ Bucket: bedrockConfig.personaS3Bucket, Key: key, Body: fileContent, ContentType: file.type || 'application/octet-stream' }));
        uploadedDocs.push({ name: file.name, key, size: file.size, type: file.type, uploadedAt: Date.now() });
      }));
      const updatedDocuments = [...documents, ...uploadedDocs];
      setDocuments(updatedDocuments);
      setFiles([]);
      if (onDocumentsChange) onDocumentsChange(updatedDocuments);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (doc) => {
    const client = new S3Client({
      region: bedrockConfig.region, credentials,
      ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
      ...(vpceEndpoints.s3 && { forcePathStyle: true })
    });
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bedrockConfig.personaS3Bucket, Key: doc.key }));
      const updatedDocuments = documents.filter(d => d.key !== doc.key);
      setDocuments(updatedDocuments);
      if (onDocumentsChange) onDocumentsChange(updatedDocuments);
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-semibold">Upload Documents</Label>
        <p className="text-xs text-muted-foreground mt-1">Upload documents included with this persona's conversations</p>
      </div>
      {uploadError && (
        <Alert variant="destructive" dismissible onDismiss={() => setUploadError(null)}>
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      )}
      <div
        className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
        <p className="text-xs text-muted-foreground">Click to choose files</p>
        <p className="text-xs text-muted-foreground">Max 5 documents, 4.5 MB per file</p>
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.doc,.docx,.md,.json,.csv,.xml,.html" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files))} />
      </div>
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded border bg-muted/50">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon className="h-4 w-4 shrink-0" />
                <span className="text-sm truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
              <button onClick={() => setFiles(f => f.filter((_, idx) => idx !== i))} className="p-1 hover:bg-accent rounded"><X className="h-3 w-3" /></button>
            </div>
          ))}
          {documents.length + files.length <= 5 && (
            <Button onClick={uploadFiles} loading={uploading} size="sm">Upload Documents</Button>
          )}
        </div>
      )}
      {documents.length >= 5 && <p className="text-sm text-warning">Maximum of 5 documents reached.</p>}
      {documents.length > 0 ? (
        <div>
          <p className="text-sm font-semibold mb-2">Uploaded Documents ({documents.length}/5)</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc, i) => (
                <TableRow key={i}>
                  <TableCell>{doc.name}</TableCell>
                  <TableCell>{(doc.size / 1024).toFixed(1)} KB</TableCell>
                  <TableCell>{doc.type || 'Unknown'}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => deleteDocument(doc)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-4">
          <Badge variant="info" className="gap-1"><Info className="h-3 w-3" />No documents found for this persona</Badge>
        </div>
      )}
    </div>
  );
};

export default PersonaDocumentUpload;
