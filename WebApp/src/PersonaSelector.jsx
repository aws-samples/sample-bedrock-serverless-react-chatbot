// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect, useContext, useCallback } from 'react';
import { CredentialsContext } from './SessionContext';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { PersonaService } from './PersonaService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Info, Loader2 } from 'lucide-react';

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
      await PersonaService.initializeDefaultPersonas(userEmail, credentials);
      const userPersonas = await PersonaService.getUserPersonas(userEmail, credentials);
      setPersonas(userPersonas);
    } catch (error) {
      console.error('Error loading personas:', error);
      setPersonas([]);
    } finally {
      setLoading(false);
    }
  }, [userEmail, credentials]);

  useEffect(() => {
    if (externalPersonas) {
      setPersonas(externalPersonas);
      setLoading(false);
    } else if (userEmail && credentials) {
      loadPersonas();
    }
  }, [userEmail, credentials, externalPersonas, loadPersonas]);

  const selectedPersona = personas.find(p => p.id === selectedPersonaId) || personas.find(p => p.isDefault) || personas[0];

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading personas...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 w-full">
      <div className="flex-1 min-w-0">
        <Select value={selectedPersonaId} onValueChange={onPersonaChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a persona" />
          </SelectTrigger>
          <SelectContent>
            {personas.map(persona => (
              <SelectItem key={persona.id} value={persona.id}>
                {persona.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default PersonaSelector;
