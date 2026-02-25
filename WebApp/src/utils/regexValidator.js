// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Regular Expression Validation Utility
 * 
 * Provides safe validation for user-provided regex patterns to prevent
 * ReDoS (Regular Expression Denial of Service) attacks.
 * 
 * Requirements: 8.2, 8.5 - Static RegExp patterns and ReDoS protection
 */

// Predefined safe regex patterns for common use cases
const SAFE_FILTER_PATTERNS = {
  'all': '.*',
  'pdf': '.*\\.pdf',
  'zip': '.*\\.zip',
  'exe': '.*\\.exe',
  'images': '.*\\.(jpg|jpeg|png|gif|svg)',
  'documents': '.*\\.(pdf|doc|docx|xls|xlsx|ppt|pptx)',
  'archives': '.*\\.(zip|tar|gz|rar|7z)'
};

/**
 * Validates a regex filter pattern for safety
 * @param {string} filter - The regex pattern to validate
 * @returns {boolean} - True if the pattern is safe, false otherwise
 * @throws {Error} - If the pattern is unsafe or invalid
 */
const validateRegexPattern = (filter) => {
  // Check if it's a predefined safe pattern
  if (Object.values(SAFE_FILTER_PATTERNS).includes(filter)) {
    return true;
  }
  
  // Reject patterns that are too complex (potential ReDoS)
  if (filter.length > 100) {
    throw new Error('Regex pattern too long (max 100 characters)');
  }
  
  // Validate pattern safety: reject patterns that could cause ReDoS
  // Check for nested quantifiers: (x*)*, (x+)+, (x*)+, (x+)*, (x{n,m})+, etc.
  // This regex looks for: opening paren, content, quantifier, closing paren, quantifier
  if (filter.match(/\([^)]*[*+}]\)[*+{]/)) {
    throw new Error('Unsafe regex pattern detected: nested quantifiers');
  }
  
  // Test the pattern is valid by constructing it
  try {
    const testRegex = new RegExp(filter);
    const testString = 'test';
    const startTime = Date.now();
    testRegex.test(testString);
    const endTime = Date.now();
    
    // If regex takes too long on simple string, it's potentially dangerous
    if (endTime - startTime > 10) {
      throw new Error('Regex pattern too complex (execution timeout)');
    }
  } catch (e) {
    // Re-throw with original error message if it's a syntax error
    if (e.message.includes('Invalid regular expression')) {
      throw e;
    }
    // Otherwise throw our custom error
    throw new Error(`Invalid regex pattern: ${e.message}`);
  }
  
  return true;
};

/**
 * Validates a list of regex filter patterns
 * @param {string} filters - Newline-separated list of regex patterns
 * @returns {boolean} - True if all patterns are valid and safe
 */
const validateFilters = (filters) => {
  if (!filters.trim()) {
    return false;
  }
  
  // Check if each filter is a valid regex
  const filterArray = filters.split('\n').map(f => f.trim()).filter(f => f);
  if (filterArray.length === 0) {
    return false;
  }
  
  // Validate each filter for safety
  try {
    filterArray.forEach(filter => validateRegexPattern(filter));
    return true;
  } catch (e) {
    return false;
  }
};

export {
  SAFE_FILTER_PATTERNS,
  validateRegexPattern,
  validateFilters
};
