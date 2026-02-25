// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const CONFIG_STORAGE_KEY = 'appConfig';

export async function fetchConfig(jwtToken) {
  const cached = sessionStorage.getItem(CONFIG_STORAGE_KEY);
  if (cached) return JSON.parse(cached);

  const apiUrl = import.meta.env.VITE_CONFIG_API_URL;
  if (!apiUrl) {
    console.warn('VITE_CONFIG_API_URL not configured, skipping config fetch');
    return null;
  }

  const response = await fetch(apiUrl, {
    headers: { Authorization: jwtToken }
  });

  if (!response.ok) throw new Error(`Config API error: ${response.status}`);

  const config = await response.json();
  sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  return config;
}

export function getConfig() {
  const cached = sessionStorage.getItem(CONFIG_STORAGE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export function clearConfig() {
  sessionStorage.removeItem(CONFIG_STORAGE_KEY);
}
