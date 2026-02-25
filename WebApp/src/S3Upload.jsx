// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext } from 'react';
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { bedrockConfig, vpceEndpoints } from './aws-config';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CredentialsContext } from './SessionContext';
import { sanitizeForLog } from './utils/sanitize';

export default () => {
  const [value, setValue] = useState([]);
  const credentials = useContext(CredentialsContext);
  const [loading, setLoading] = useState(false);

  const uploadFilesToS3 = async (values) => {
    console.log('Starting upload process with', values.length, 'files');

    // Construct S3 endpoint with "bucket." prefix for VPC endpoint
    const getS3Endpoint = () => {
      if (vpceEndpoints.s3) {
        const vpceUrl = new URL(vpceEndpoints.s3);
        vpceUrl.hostname = `bucket.${vpceUrl.hostname}`;
        return vpceUrl.toString();
      }
      return undefined;
    };

    const client = new S3Client({
      region: bedrockConfig.region,
      credentials: credentials,
      ...(vpceEndpoints.s3 && { endpoint: getS3Endpoint() }),
      ...(vpceEndpoints.s3 && { forcePathStyle: true })
    });

    setLoading(true);
    try {
      await Promise.all(values.map(async (item) => {
        console.log('Processing file:', sanitizeForLog(item.name));
        
        // Convert file to array buffer
        let fileContent;
        try {
          if (item.data) {
            fileContent = await item.data.arrayBuffer();
          } else {
            const reader = new FileReader();
            fileContent = await new Promise((resolve, reject) => {
              reader.onload = (e) => resolve(e.target.result);
              reader.onerror = (e) => reject(e);
              reader.readAsArrayBuffer(item);
            });
          }
        } catch (fileError) {
          console.error('Error reading file:', sanitizeForLog(fileError.message));
          throw new Error(`Failed to read file ${sanitizeForLog(item.name)}: ${sanitizeForLog(fileError.message)}`);
        }

        const input = {
          Bucket: bedrockConfig.knowledgeBaseS3Bucket,
          Key: item.name,
          Body: fileContent,
          ContentType: item.type || 'application/octet-stream'
        };

        console.log('Uploading file:', sanitizeForLog(item.name), 'Size:', fileContent.byteLength);

        const command = new PutObjectCommand(input);
        const result = await client.send(command);
        
        console.log('Upload successful for file:', sanitizeForLog(item.name));
      }));

      console.log('All files uploaded successfully');
      setValue([]);
    } catch (error) {
      console.error('Upload error:', sanitizeForLog(error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = ({ detail }) => {
    console.log('File selection changed, count:', detail.value.length);
    setValue(detail.value);
  };

  return (
    <FormField
      label="S3 Upload"
      description="Upload documents to the S3 bucket used for your Bedrock Knowledge Base"
    >
      <SpaceBetween direction="vertical" size="xs">
        <FileUpload
          onChange={handleFileChange}
          value={value}
          i18nStrings={{
            uploadButtonText: e =>
              e ? "Choose files" : "Choose file",
            dropzoneText: e =>
              e
                ? "Drop files to upload"
                : "Drop file to upload",
            removeFileAriaLabel: e =>
              `Remove file ${e + 1}`,
            limitShowFewer: "Show fewer files",
            limitShowMore: "Show more files",
            errorIconAriaLabel: "Error",
            warningIconAriaLabel: "Warning"
          }}
          multiple
          showFileLastModified
          showFileSize
          showFileThumbnail
          tokenLimit={3}
          constraintText="File size up to 30MB"
        />
        {value.length > 0 && (
          <Button
            variant="primary"
            loading={loading}
            onClick={() => uploadFilesToS3(value)}
          >
            Upload
          </Button>
        )}
      </SpaceBetween>
    </FormField>
  );
};
