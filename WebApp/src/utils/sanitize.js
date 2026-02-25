// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Sanitization utilities for secure logging
 * 
 * This module provides functions to sanitize user input and external data
 * before logging to prevent log injection attacks and log flooding.
 */

/**
 * Sanitizes a value for safe logging by removing newlines and limiting length
 * 
 * @param {*} input - The value to sanitize (can be any type)
 * @param {number} maxLength - Maximum length of the output string (default: 200)
 * @returns {string} Sanitized string safe for logging
 * 
 * @example
 * sanitizeForLog('Hello\nWorld') // Returns: 'Hello World'
 * sanitizeForLog('A'.repeat(300)) // Returns: 'AAA...' (truncated to 200 chars)
 * sanitizeForLog(null) // Returns: 'null'
 * sanitizeForLog(undefined) // Returns: 'undefined'
 * sanitizeForLog({key: 'value'}) // Returns: '[object Object]'
 */
function sanitizeForLog(input, maxLength = 200) {
  // Handle null and undefined explicitly
  if (input === null) {
    return 'null';
  }
  if (input === undefined) {
    return 'undefined';
  }
  
  // Convert to string
  let str;
  if (typeof input === 'string') {
    str = input;
  } else if (typeof input === 'object') {
    // For objects, use JSON.stringify if possible, otherwise toString
    try {
      str = JSON.stringify(input);
    } catch (e) {
      // Fallback to toString for circular references or other issues
      str = String(input);
    }
  } else {
    str = String(input);
  }
  
  // Remove newlines (both \n and \r) and replace with spaces
  str = str.replace(/[\n\r]/g, ' ');
  
  // Limit string length to prevent log flooding
  if (str.length > maxLength) {
    str = str.substring(0, maxLength) + '...';
  }
  
  return str;
}

export { sanitizeForLog };
