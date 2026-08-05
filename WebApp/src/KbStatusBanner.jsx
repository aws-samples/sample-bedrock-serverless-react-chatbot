// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { CredentialsContext } from './SessionContext';
import { bedrockConfig, isManagedKnowledgeBase } from './aws-config';
import { sanitizeForLog } from './utils/sanitize';

export default function KbStatusBanner() {
  const [dismissed, setDismissed] = useState(false);
  // null means "not determined": the banner is only shown when a probe succeeds and
  // comes back with no results. Treating a failed probe as "empty" would show a
  // misleading message whenever the request itself was rejected.
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
          // A managed knowledge base rejects vectorSearchConfiguration and requires
          // managedSearchConfiguration instead.
          retrievalConfiguration: isManagedKnowledgeBase()
            ? { managedSearchConfiguration: { numberOfResults: 1 } }
            : { vectorSearchConfiguration: { numberOfResults: 1 } }
        });
        const response = await client.send(command);
        setHasDocuments((response.retrievalResults?.length ?? 0) > 0);
      } catch (error) {
        // Leave the state undetermined so the banner stays hidden rather than
        // claiming the knowledge base is empty when the check could not run.
        console.warn('Knowledge base status check failed:', sanitizeForLog(error?.message ?? 'unknown error'));
        setHasDocuments(null);
      } finally {
        setLoading(false);
      }
    };
    checkKbStatus();
  }, [credentials]);

  if (dismissed || loading || hasDocuments !== false) return null;

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
