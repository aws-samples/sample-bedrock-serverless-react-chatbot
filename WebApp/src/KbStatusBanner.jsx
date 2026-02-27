// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import { Alert, Box } from '@cloudscape-design/components';
import { getDataSourceStats } from './bedrockAgent';
import { CredentialsContext } from './SessionContext';
import { sanitizeForLog } from './utils/sanitize';
import { useKbRefresh } from './KbRefreshContext';
import { config } from './aws-config';

export default function KbStatusBanner() {
  const [dataSourceInfo, setDataSourceInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const credentials = useContext(CredentialsContext);
  const { refreshTrigger } = useKbRefresh();

  useEffect(() => {
    const fetchDataSourceInfo = async () => {
      if (!credentials) return;
      
      try {
        setLoading(true);
        const stats = await getDataSourceStats(credentials);
        if (config.debug) {
          console.log('KB Stats fetched:', stats);
        }
        setDataSourceInfo(stats);
        setError(null);
      } catch (err) {
        console.error('Error fetching data source stats:', sanitizeForLog(err.message));
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDataSourceInfo();
  }, [credentials, refreshTrigger]); // Re-fetch when refreshTrigger changes

  // Don't show anything while loading
  if (loading) {
    return null;
  }

  // Don't show if there was an error
  if (error) {
    return null;
  }

  // Only show banner if KB is empty (no documents)
  if (config.debug) {
    console.log('Banner check - documentCount:', dataSourceInfo?.documentCount);
  }
  if (!dataSourceInfo || dataSourceInfo.documentCount > 0) {
    if (config.debug) {
      console.log('Banner hidden - has documents');
    }
    return null;
  }

  if (config.debug) {
    console.log('Banner showing - KB is empty');
  }

  return (
    <Alert
      type="info"
      header="Knowledge Base is Ready but Empty"
    >
      <Box>
        <div>
          <strong>Data Source:</strong> {dataSourceInfo?.name || 'Unknown'}
        </div>
        <div>
          <strong>Status:</strong> {dataSourceInfo?.status || 'Unknown'}
        </div>
        <div>
          <strong>Documents:</strong> {dataSourceInfo?.documentCount || 0}
        </div>
        <Box margin={{ top: 's' }}>
          <strong>To add documents to your knowledge base:</strong>
          <ol style={{ marginTop: '8px', marginBottom: '8px', paddingLeft: '20px' }}>
            <li>
              Use the <strong>Upload Documents</strong> option in the left navigation menu to upload files to S3 (supports PDF, TXT, DOC, DOCX, CSV, MD, HTML, XLS, XLSX)
            </li>
            <li>
              Use the <strong>Sync Knowledge Base</strong> option in the left navigation menu to index your documents
            </li>
          </ol>
        </Box>
      </Box>
    </Alert>
  );
}
