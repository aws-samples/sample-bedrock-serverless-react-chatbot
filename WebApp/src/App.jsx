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
        // Fetch runtime config using the JWT token before rendering the app
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
    return <div>Loading...</div>;
  }

  if (configError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Configuration Error</h2>
        <p>{configError}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <CredentialsContext.Provider value={credentials}>
      <div className="App">
        <Layout signOut={signOut} user={user} />
      </div>
    </CredentialsContext.Provider>
  );
}

export default withAuthenticator(App);
