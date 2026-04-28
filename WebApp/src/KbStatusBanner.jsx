// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
          retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 1 } }
        });
        const response = await client.send(command);
        setHasDocuments(response.retrievalResults && response.retrievalResults.length > 0);
      } catch (error) {
        setHasDocuments(false);
      } finally {
        setLoading(false);
      }
    };
    checkKbStatus();
  }, [credentials]);

  if (dismissed || loading || hasDocuments) return null;

  return (
    <Alert variant="info" dismissible onDismiss={() => setDismissed(true)}>
      <AlertTitle>Knowledge Base is Empty</AlertTitle>
      <AlertDescription>
        Your knowledge base doesn't have any documents yet. To add documents:
        <ol className="mt-2 mb-0 pl-5 list-decimal">
          <li>Use <strong>Upload Documents</strong> in the left menu to upload files to S3</li>
          <li>Use <strong>Sync Knowledge Base</strong> in the left menu to index your documents</li>
        </ol>
      </AlertDescription>
    </Alert>
  );
}
