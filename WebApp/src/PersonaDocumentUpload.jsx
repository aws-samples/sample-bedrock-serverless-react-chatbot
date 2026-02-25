// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext, useEffect } from 'react';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CredentialsContext } from './SessionContext';
import { bedrockConfig, config, vpceEndpoints } from './aws-config';
import {
  FileUpload,
  FormField,
  Button,
  SpaceBetween,
  Box,
  StatusIndicator,
  Table,
  Header,
  Alert
} from "@cloudscape-design/components";

const PersonaDocumentUpload = ({ persona, onDocumentsChange }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState(persona.documents || []);
  const [uploadError, setUploadError] = useState(null);
  const credentials = useContext(CredentialsContext);

  // Helper function to construct S3 endpoint with "bucket." prefix for VPC endpoint
  const getS3Endpoint = () => {
    if (vpceEndpoints.s3) {
      const vpceUrl = new URL(vpceEndpoints.s3);
      vpceUrl.hostname = `bucket.${vpceUrl.hostname}`;
      return vpceUrl.toString();
    }
    return undefined;
  };

  // Update documents when persona changes
  useEffect(() => {
    if (config.debug) {
      console.log('PersonaDocumentUpload: persona changed', persona);
      console.log('PersonaDocumentUpload: persona.documents', persona.documents);
    }
    setDocuments(persona.documents || []);
  }, [persona.documents]);

  const uploadFiles = async () => {
    if (!files.length) return;

    setUploadError(null);

    // Validate file count and size limits
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
      region: bedrockConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
      ...(vpceEndpoints.s3 && { forcePathStyle: true })
    });

    setUploading(true);
    try {
      const uploadedDocs = [];
      
      await Promise.all(files.map(async (file) => {
        const fileContent = await file.arrayBuffer();
        const key = `${persona.s3Prefix}${file.name}`;
        
        const command = new PutObjectCommand({
          Bucket: bedrockConfig.personaS3Bucket,
          Key: key,
          Body: fileContent,
          ContentType: file.type || 'application/octet-stream'
        });

        await client.send(command);
        
        uploadedDocs.push({
          name: file.name,
          key: key,
          size: file.size,
          type: file.type,
          uploadedAt: Date.now()
        });
      }));

      const updatedDocuments = [...documents, ...uploadedDocs];
      setDocuments(updatedDocuments);
      setFiles([]);
      
      if (onDocumentsChange) {
        onDocumentsChange(updatedDocuments);
      }
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (doc) => {
    const client = new S3Client({
      region: bedrockConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
      ...(vpceEndpoints.s3 && { forcePathStyle: true })
    });

    try {
      const command = new DeleteObjectCommand({
        Bucket: bedrockConfig.personaS3Bucket,
        Key: doc.key
      });

      await client.send(command);
      
      const updatedDocuments = documents.filter(d => d.key !== doc.key);
      setDocuments(updatedDocuments);
      
      if (onDocumentsChange) {
        onDocumentsChange(updatedDocuments);
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  return (
    <SpaceBetween size="l">
      {/* Debug info */}
      <Box variant="small" color="text-body-secondary">
        Debug: {documents.length} documents loaded
      </Box>
      
      <FormField
        label="Upload Documents"
        description="Upload documents that will be included with this persona's conversations"
      >
        <SpaceBetween size="s">
          {uploadError && (
            <Alert type="error" dismissible onDismiss={() => setUploadError(null)}>
              {uploadError}
            </Alert>
          )}
          <FileUpload
            onChange={({ detail }) => setFiles(detail.value)}
            value={files}
            multiple
            accept=".pdf,.txt,.doc,.docx,.md,.json,.csv,.xml,.html"
            i18nStrings={{
              uploadButtonText: e => e ? "Choose files" : "Choose file",
              dropzoneText: e => e ? "Drop files to upload" : "Drop file to upload",
              removeFileAriaLabel: e => `Remove file ${e + 1}`,
              limitShowFewer: "Show fewer files",
              limitShowMore: "Show more files",
              errorIconAriaLabel: "Error"
            }}
            showFileLastModified
            showFileSize
            constraintText="Maximum 5 documents, 4.5 MB per file. Supported: PDF, TXT, DOC, DOCX, MD, JSON, CSV, XML, HTML"
          />
          {files.length > 0 && documents.length + files.length <= 5 && (
            <Button
              variant="primary"
              loading={uploading}
              onClick={uploadFiles}
            >
              Upload Documents
            </Button>
          )}
          {documents.length >= 5 && (
            <Box color="text-status-warning">
              Maximum of 5 documents reached. Delete existing documents to upload new ones.
            </Box>
          )}
        </SpaceBetween>
      </FormField>

      {documents.length > 0 ? (
        <Table
          columnDefinitions={[
            {
              id: 'name',
              header: 'Document Name',
              cell: item => item.name
            },
            {
              id: 'size',
              header: 'Size',
              cell: item => `${(item.size / 1024).toFixed(1)} KB`
            },
            {
              id: 'type',
              header: 'Type',
              cell: item => item.type || 'Unknown'
            },
            {
              id: 'actions',
              header: 'Actions',
              cell: item => (
                <Button
                  variant="inline-link"
                  iconName="remove"
                  onClick={() => deleteDocument(item)}
                >
                  Delete
                </Button>
              )
            }
          ]}
          items={documents}
          header={
            <Header variant="h3">
              Uploaded Documents ({documents.length}/5)
            </Header>
          }
          empty={
            <Box textAlign="center">
              <StatusIndicator type="info">No documents uploaded</StatusIndicator>
            </Box>
          }
        />
      ) : (
        <Box textAlign="center">
          <StatusIndicator type="info">No documents found for this persona</StatusIndicator>
        </Box>
      )}
    </SpaceBetween>
  );
};

export default PersonaDocumentUpload;