// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import { Alert, Box } from '@cloudscape-design/components';
import { CredentialsContext } from './SessionContext';
import { bedrockConfig } from './aws-config';

export default function KbStatusBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [hasDocuments, setHasDocuments] = useState(null);
  const [loading, setLoading] = useState(true);
  const credentials = useContext(CredentialsContext);

  useEffect(() => {
    const checkKbStatus = async () => {
      if (!credentials) return;
      
      try {
        setLoading(true);
        
        // Simple check: try to retrieve from KB
        const { BedrockAgentRuntimeClient, RetrieveCommand } = await import("@aws-sdk/client-bedrock-agent-runtime");
        const { vpceEndpoints } = await import('./aws-config');
        
        const client = new BedrockAgentRuntimeClient({
          region: bedrockConfig.region,
          credentials: credentials,
          ...(vpceEndpoints.bedrockAgentRuntime && { endpoint: vpceEndpoints.bedrockAgentRuntime })
        });
        
        const command = new RetrieveCommand({
          knowledgeBaseId: bedrockConfig.knowledgeBaseId,
          retrievalQuery: { text: "test" },
          retrievalConfiguration: {
            vectorSearchConfiguration: { numberOfResults: 1 }
          }
        });
        
        const response = await client.send(command);
        setHasDocuments(response.retrievalResults && response.retrievalResults.length > 0);
      } catch (error) {
        // If retrieve fails, assume KB might be empty
        setHasDocuments(false);
      } finally {
        setLoading(false);
      }
    };

    checkKbStatus();
  }, [credentials]);

  // Don't show if dismissed, loading, or has documents
  if (dismissed || loading || hasDocuments) {
    return null;
  }

  return (
    <Alert
      type="info"
      dismissible
      onDismiss={() => setDismissed(true)}
      header="Knowledge Base is Empty"
    >
      <Box>
        Your knowledge base doesn't have any documents yet. To add documents:
        <ol style={{ marginTop: '8px', marginBottom: '0', paddingLeft: '20px' }}>
          <li>Use <strong>Upload Documents</strong> in the left menu to upload files to S3</li>
          <li>Use <strong>Sync Knowledge Base</strong> in the left menu to index your documents</li>
        </ol>
      </Box>
    </Alert>
  );
}
