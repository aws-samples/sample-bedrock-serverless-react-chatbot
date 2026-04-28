// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useEffect } from 'react';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import awsconfig from './aws-config';
import { CredentialsContext } from './SessionContext';
import Layout from './AppLayout';
import useSessionRefresh from './useSessionRefresh';
import { fetchConfig } from './configService';
import { TooltipProvider } from '@/components/ui/tooltip';

Amplify.configure(awsconfig);

function App({ signOut, user }) {
  const [initialCredentials, setInitialCredentials] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [configError, setConfigError] = useState(null);
  const [credentials, setCredentials] = useSessionRefresh(initialCredentials);

  useEffect(() => {
    async function getInitialCredentials() {
      try {
        const session = await fetchAuthSession();
        const jwtToken = session.tokens?.idToken?.toString();
        if (jwtToken) {
          await fetchConfig(jwtToken);
        }
        setInitialCredentials(session.credentials);
        setCredentials(session.credentials);
      } catch (err) {
        console.error('Error fetching initial credentials:', err);
        setConfigError(err.message || 'Failed to load application configuration');
      } finally {
        setIsLoading(false);
      }
    }
    getInitialCredentials();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        Loading...
      </div>
    );
  }

  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <h2 className="text-xl font-semibold">Configuration Error</h2>
        <p className="text-muted-foreground">{configError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <CredentialsContext.Provider value={credentials}>
      <TooltipProvider>
        <div className="App">
          <Layout signOut={signOut} user={user} />
        </div>
      </TooltipProvider>
    </CredentialsContext.Provider>
  );
}

export default withAuthenticator(App);
