// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect, useContext } from 'react';
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { syncKnowledgeBase, createBedrockAgentAlias, setBedrockAgentModel, updateBedrockAgentInstructions, getBedrockAgentInstructions, getBedrockAgent, getInstruction, setBedrockAgentInstruction } from './bedrockAgent';
import { CredentialsContext } from './SessionContext';

export default function AgentInstructions() {
  const [instructions, setInstructions] = useState(null);
  const credentials = useContext(CredentialsContext);
  const [indicator, setIndicator] = useState(null);

  // Sleep helper function
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    async function getCurrentInstructions() {
      if(instructions === null) {
        try {
          const instructions = await getInstruction(credentials);
          setInstructions(instructions);
        } catch (error) {
          console.error(error);
        }
      }
    }
    getCurrentInstructions();
  }, []);

  const getPreparedState = async () => {
    while (true) {
      const status = await getBedrockAgent(credentials).agent.agentStatus;
      if (status === "PREPARED") {
        break;
      }
      await sleep(5000);
    }
  };

  const getAliasCreationStatus = async (aliasId) => {
    while (true) {
      const status = await getBedrockAgent(credentials).agent.agentStatus;
      if (status === "PREPARED") {
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
    setBedrockAgentInstruction(credentials, instructions);
    // const response = await updateBedrockAgentInstructions(credentials, instructions);
    // setIndicator(<StatusIndicator type="in-progress">In progress</StatusIndicator>);
    // getPreparedState();
    // const aliasId = bedrockConfig.agentAliasId;
    // getAliasCreationStatus(aliasId);
  };



  return (
    <>
      <FormField
        label="Bedrock Agent Instruction Update"
        description="Modify the instructions used by your Bedrock Agent"
      />
      <SpaceBetween direction="vertical" size="xs">
        <Textarea
          onChange={({ detail }) => setInstructions(detail.value)}
          value={instructions}
          // placeholder={currentInstructions}
        />
        <Button variant="primary" onClick={handleSubmit}>Update</Button>
        {indicator}
      </SpaceBetween>
    </>
  );
}