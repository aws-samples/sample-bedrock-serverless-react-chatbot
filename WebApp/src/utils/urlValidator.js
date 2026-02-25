// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * URL validation and enforcement utilities
 * Ensures all URLs use HTTPS protocol for security
 */

/**
 * Enforces HTTPS protocol on URLs
 * @param {string} url - The URL to validate/convert
 * @returns {string} - URL with HTTPS protocol
 * @throws {Error} - If URL is invalid
 */
export const enforceHttps = (url) => {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('URL must be a non-empty string');
  }

  const trimmedUrl = url.trim();

  // If URL starts with http://, replace with https://
  if (trimmedUrl.startsWith('http://')) {
    return trimmedUrl.replace('http://', 'https://');
  }

  // If URL starts with https://, return as-is
  if (trimmedUrl.startsWith('https://')) {
    return trimmedUrl;
  }

  // If URL has no protocol, add https://
  if (!trimmedUrl.match(/^[a-z]+:\/\//i)) {
    return `https://${trimmedUrl}`;
  }

  // For other protocols (ftp://, etc.), throw error
  throw new Error('Only HTTPS protocol is allowed');
};

/**
 * Validates that a URL uses HTTPS protocol
 * @param {string} url - The URL to validate
 * @returns {boolean} - True if URL uses HTTPS
 */
export const isHttps = (url) => {
  if (typeof url !== 'string' || !url.trim()) {
    return false;
  }

  return url.trim().startsWith('https://');
};

/**
 * Validates URL format and ensures HTTPS
 * @param {string} url - The URL to validate
 * @returns {boolean} - True if URL is valid and uses HTTPS
 */
export const validateHttpsUrl = (url) => {
  try {
    const httpsUrl = enforceHttps(url);
    // Try to create a URL object to validate format
    new URL(httpsUrl);
    return true;
  } catch (error) {
    return false;
  }
};
