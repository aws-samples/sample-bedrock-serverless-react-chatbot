// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { syncKnowledgeBase, getSyncStatus } from './bedrockAgent';
import { CredentialsContext } from './SessionContext';

export default function KnowledgeBaseSync() {
  const [jobId, setJobId] = useState(null);
  const credentials = useContext(CredentialsContext);
  const [status, setStatus] = useState(null); // 'loading' | 'success' | 'error'
  const [loading, setLoading] = useState(false);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getKbSyncStatus = async (ingestionJobId) => {
    while (true) {
      const syncStatus = await getSyncStatus(ingestionJobId, credentials);
      if (syncStatus === "STARTING" || syncStatus === "IN_PROGRESS") {
        setStatus('loading');
      } else if (syncStatus === "COMPLETE") {
        setStatus('success');
        break;
      } else if (syncStatus === "FAILED") {
        setStatus('error');
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
      setStatus('loading');
      await getKbSyncStatus(ingestionJobId);
    } catch (error) {
      console.error(error);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">Knowledge Base Sync</Label>
        <p className="text-sm text-muted-foreground mt-1">
          Click to sync your Bedrock Knowledge Base with recent documents uploaded to S3
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit} loading={loading}>Sync</Button>
        {status === 'loading' && (
          <Badge variant="info" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />In progress</Badge>
        )}
        {status === 'success' && (
          <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />Success</Badge>
        )}
        {status === 'error' && (
          <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>
        )}
      </div>
    </div>
  );
}
