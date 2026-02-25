// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { syncKnowledgeBase, getSyncStatus } from './bedrockAgent';
import { CredentialsContext } from './SessionContext';

export default function KnowledgeBaseSync() {
  const [jobId, setJobId] = useState(null);
  const credentials = useContext(CredentialsContext);
  const [indicator, setIndicator] = useState(null);
  const [loading, setLoading] = useState(false);

  // Sleep helper function
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getKbSyncStatus = async (ingestionJobId) => {
    while (true) {
      const status = await getSyncStatus(ingestionJobId, credentials);
      if (status === "STARTING" || status === "IN_PROGRESS") {
        setIndicator(<StatusIndicator type="in-progress">In progress</StatusIndicator>);
      } else if (status === "COMPLETE") {
        setIndicator(<StatusIndicator type="success">Success</StatusIndicator>);
        break;
      } else if (status === "FAILED") {
        setIndicator(<StatusIndicator type="error">Error</StatusIndicator>);
        break;
      }
      await sleep(5000);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const response = await syncKnowledgeBase(credentials);
      const ingestionJobId = response.ingestionJob.ingestionJobId;
      setJobId(ingestionJobId);
      setIndicator(<StatusIndicator type="in-progress">In progress</StatusIndicator>);
      await getKbSyncStatus(ingestionJobId);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <FormField
        label="Knowledge Base Sync"
        description="Click to sync your Bedrock Knowledge Base with recent documents uploaded to S3"
      />
      <SpaceBetween direction="vertical" size="xs">
        <Button
          variant="primary"
          loading={loading}
          onClick={handleSubmit}
        >
          Sync</Button>
        {indicator}
      </SpaceBetween>
    </>
  );
}