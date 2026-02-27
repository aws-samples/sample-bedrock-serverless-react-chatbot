// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { createContext, useState, useContext } from 'react';

const KbRefreshContext = createContext();

export const useKbRefresh = () => {
  const context = useContext(KbRefreshContext);
  if (!context) {
    throw new Error('useKbRefresh must be used within KbRefreshProvider');
  }
  return context;
};

export const KbRefreshProvider = ({ children }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const triggerRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <KbRefreshContext.Provider value={{ refreshTrigger, triggerRefresh }}>
      {children}
    </KbRefreshContext.Provider>
  );
};
