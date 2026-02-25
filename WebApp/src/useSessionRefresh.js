// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

const useSessionRefresh = (initialCredentials, refreshInterval = 5 * 60 * 1000) => {
  const [credentials, setCredentials] = useState(initialCredentials);

  useEffect(() => {
    const refreshSession = async () => {
      try {
        const session = await fetchAuthSession();
        setCredentials(session.credentials);
      } catch (err) {
        console.error('Error refreshing session:', err);
      }
    };

    const intervalId = setInterval(refreshSession, refreshInterval);

    return () => clearInterval(intervalId);
  }, [refreshInterval]);

  return [credentials, setCredentials];
};

export default useSessionRefresh;