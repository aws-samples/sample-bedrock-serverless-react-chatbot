// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect, useContext, useCallback } from 'react';
import { CredentialsContext } from './SessionContext';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { PersonaService } from './PersonaService';
import {
  Select,
  Box,
  SpaceBetween,
  Icon,
  Popover,
  StatusIndicator
} from '@cloudscape-design/components';

const PersonaSelector = ({ selectedPersonaId, onPersonaChange, personas: externalPersonas }) => {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  
  const credentials = useContext(CredentialsContext);

  useEffect(() => {
    const initializeUser = async () => {
      try {
        const attributes = await fetchUserAttributes();
        setUserEmail(attributes.email);
      } catch (error) {
        console.error('Error fetching user attributes:', error);
      }
    };
    initializeUser();
  }, []);

  const loadPersonas = useCallback(async () => {
    try {
      setLoading(true);
      
      // Initialize default personas if needed
      await PersonaService.initializeDefaultPersonas(userEmail, credentials);
      
      // Load all personas
      const userPersonas = await PersonaService.getUserPersonas(userEmail, credentials);
      setPersonas(userPersonas);
    } catch (error) {
      console.error('Error loading personas:', error);
      // Fallback to empty array
      setPersonas([]);
    } finally {
      setLoading(false);
    }
  }, [userEmail, credentials]);

  useEffect(() => {
    if (externalPersonas) {
      // Use personas passed from parent (PersonaManager)
      setPersonas(externalPersonas);
      setLoading(false);
    } else if (userEmail && credentials) {
      // Load personas from service
      loadPersonas();
    }
  }, [userEmail, credentials, externalPersonas, loadPersonas]);

  const selectedPersona = personas.find(p => p.id === selectedPersonaId) || personas.find(p => p.isDefault) || personas[0];
  
  const personaOptions = personas.map(persona => ({
    label: persona.name,
    value: persona.id,
    description: persona.description
  }));

  if (loading) {
    return (
      <div>
        <Box>Loading personas...</Box>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <Select
          selectedOption={personaOptions.find(option => option.value === selectedPersonaId)}
          onChange={({ detail }) => onPersonaChange(detail.selectedOption.value)}
          options={personaOptions}
          placeholder="Select a persona"
          expandToViewport
          renderHighlightedAriaLive={(option) => `${option.label}, ${option.description}`}
          loading={loading}
        />
      </div>
      {selectedPersona && selectedPersona.prompt && (
        <Popover
          dismissButton={false}
          position="top"
          size="large"
          triggerType="custom"
          content={
            <Box>
              <SpaceBetween size="xs">
                <Box variant="strong">{selectedPersona.name}</Box>
                <Box variant="p">{selectedPersona.description}</Box>
                <Box variant="small">
                  <strong>System Prompt:</strong>
                  <br />
                  {selectedPersona.prompt}
                </Box>
              </SpaceBetween>
            </Box>
          }
        >
          <Icon name="status-info" variant="link" />
        </Popover>
      )}
      {selectedPersona && selectedPersona.id !== 'default' && !selectedPersona.isDefault && (
        <div style={{ flexShrink: 0 }}>
          <StatusIndicator type="success">
            <Box variant="small">Active</Box>
          </StatusIndicator>
        </div>
      )}
    </div>
  );
};

export default PersonaSelector;