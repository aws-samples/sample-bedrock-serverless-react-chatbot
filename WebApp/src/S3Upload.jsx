// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, X, FileIcon } from 'lucide-react';
import { bedrockConfig, config, vpceEndpoints } from './aws-config';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CredentialsContext } from './SessionContext';
import { sanitizeForLog } from './utils/sanitize';

export default () => {
  const [value, setValue] = useState([]);
  const credentials = useContext(CredentialsContext);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const getS3Endpoint = () => {
    if (vpceEndpoints.s3) {
      const vpceUrl = new URL(vpceEndpoints.s3);
      vpceUrl.hostname = `bucket.${vpceUrl.hostname}`;
      return vpceUrl.toString();
    }
    return undefined;
  };

  const uploadFilesToS3 = async (values) => {
    if (config.debug) console.log('Starting upload process with', values.length, 'files');
    const client = new S3Client({
      region: bedrockConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
      ...(vpceEndpoints.s3 && { forcePathStyle: true })
    });

    setLoading(true);
    try {
      await Promise.all(values.map(async (item) => {
        if (config.debug) console.log('Processing file:', sanitizeForLog(item.name));
        const fileContent = await item.arrayBuffer();
        const input = {
          Bucket: bedrockConfig.knowledgeBaseS3Bucket,
          Key: item.name,
          Body: fileContent,
          ContentType: item.type || 'application/octet-stream'
        };
        const command = new PutObjectCommand(input);
        await client.send(command);
        if (config.debug) console.log('Upload successful for file:', sanitizeForLog(item.name));
      }));
      setValue([]);
    } catch (error) {
      if (config.debug) console.error('Upload error:', sanitizeForLog(error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setValue(prev => [...prev, ...files]);
  };

  const removeFile = (index) => {
    setValue(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">S3 Upload</Label>
        <p className="text-sm text-muted-foreground mt-1">
          Upload documents to the S3 bucket used for your Bedrock Knowledge Base
        </p>
      </div>
      <div
        className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = Array.from(e.dataTransfer.files);
          setValue(prev => [...prev, ...files]);
        }}
      >
        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Click to choose files or drag and drop</p>
        <p className="text-xs text-muted-foreground mt-1">File size up to 30MB</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((file, index) => (
            <div key={index} className="flex items-center justify-between p-2 rounded-md border bg-muted/50">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <button onClick={() => removeFile(index)} className="p-1 hover:bg-accent rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button onClick={() => uploadFilesToS3(value)} loading={loading}>Upload</Button>
        </div>
      )}
    </div>
  );
};
