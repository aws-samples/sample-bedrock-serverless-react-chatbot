// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { getBedrockAgent, getInstruction, setBedrockAgentInstruction } from './bedrockAgent';
import { CredentialsContext } from './SessionContext';

export default function AgentInstructions() {
  const [instructions, setInstructions] = useState(null);
  const credentials = useContext(CredentialsContext);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    async function getCurrentInstructions() {
      if (instructions === null) {
        try {
          const inst = await getInstruction(credentials);
          setInstructions(inst);
        } catch (error) {
          console.error(error);
        }
      }
    }
    getCurrentInstructions();
  }, []);

  const handleSubmit = async () => {
    setBedrockAgentInstruction(credentials, instructions);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">Bedrock Agent Instruction Update</Label>
        <p className="text-sm text-muted-foreground mt-1">
          Modify the instructions used by your Bedrock Agent
        </p>
      </div>
      <Textarea
        onChange={(e) => setInstructions(e.target.value)}
        value={instructions || ''}
        rows={8}
      />
      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit}>Update</Button>
        {status === 'loading' && <Badge variant="info" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />In progress</Badge>}
        {status === 'success' && <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />Success</Badge>}
        {status === 'error' && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>}
      </div>
    </div>
  );
}
