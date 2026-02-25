// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { enforceHttps, isHttps, validateHttpsUrl } from './urlValidator';

describe('urlValidator', () => {
  describe('enforceHttps', () => {
    test('converts http:// to https://', () => {
      expect(enforceHttps('http://example.com')).toBe('https://example.com');
      expect(enforceHttps('http://api.example.com/path')).toBe('https://api.example.com/path');
    });

    test('preserves https:// URLs', () => {
      expect(enforceHttps('https://example.com')).toBe('https://example.com');
      expect(enforceHttps('https://api.example.com/path')).toBe('https://api.example.com/path');
    });

    test('adds https:// to URLs without protocol', () => {
      expect(enforceHttps('example.com')).toBe('https://example.com');
      expect(enforceHttps('api.example.com/path')).toBe('https://api.example.com/path');
    });

    test('handles URLs with whitespace', () => {
      expect(enforceHttps('  http://example.com  ')).toBe('https://example.com');
      expect(enforceHttps('  example.com  ')).toBe('https://example.com');
    });

    test('throws error for empty or invalid input', () => {
      expect(() => enforceHttps('')).toThrow('URL must be a non-empty string');
      expect(() => enforceHttps('   ')).toThrow('URL must be a non-empty string');
      expect(() => enforceHttps(null)).toThrow('URL must be a non-empty string');
      expect(() => enforceHttps(undefined)).toThrow('URL must be a non-empty string');
    });

    test('throws error for non-HTTP protocols', () => {
      expect(() => enforceHttps('ftp://example.com')).toThrow('Only HTTPS protocol is allowed');
      expect(() => enforceHttps('file:///path/to/file')).toThrow('Only HTTPS protocol is allowed');
    });
  });

  describe('isHttps', () => {
    test('returns true for HTTPS URLs', () => {
      expect(isHttps('https://example.com')).toBe(true);
      expect(isHttps('https://api.example.com/path')).toBe(true);
    });

    test('returns false for HTTP URLs', () => {
      expect(isHttps('http://example.com')).toBe(false);
      expect(isHttps('http://api.example.com/path')).toBe(false);
    });

    test('returns false for URLs without protocol', () => {
      expect(isHttps('example.com')).toBe(false);
      expect(isHttps('api.example.com/path')).toBe(false);
    });

    test('returns false for empty or invalid input', () => {
      expect(isHttps('')).toBe(false);
      expect(isHttps('   ')).toBe(false);
      expect(isHttps(null)).toBe(false);
      expect(isHttps(undefined)).toBe(false);
    });

    test('handles URLs with whitespace', () => {
      expect(isHttps('  https://example.com  ')).toBe(true);
      expect(isHttps('  http://example.com  ')).toBe(false);
    });
  });

  describe('validateHttpsUrl', () => {
    test('validates correct HTTPS URLs', () => {
      expect(validateHttpsUrl('https://example.com')).toBe(true);
      expect(validateHttpsUrl('https://api.example.com/path')).toBe(true);
      expect(validateHttpsUrl('https://example.com:8080/path?query=value')).toBe(true);
    });

    test('validates and converts HTTP URLs', () => {
      expect(validateHttpsUrl('http://example.com')).toBe(true);
      expect(validateHttpsUrl('http://api.example.com/path')).toBe(true);
    });

    test('validates and adds protocol to URLs without it', () => {
      expect(validateHttpsUrl('example.com')).toBe(true);
      expect(validateHttpsUrl('api.example.com/path')).toBe(true);
    });

    test('returns false for invalid URLs', () => {
      expect(validateHttpsUrl('')).toBe(false);
      expect(validateHttpsUrl('not a url')).toBe(false);
      expect(validateHttpsUrl('ftp://example.com')).toBe(false);
    });

    test('returns false for malformed URLs', () => {
      expect(validateHttpsUrl('https://')).toBe(false);
      expect(validateHttpsUrl('not a url at all')).toBe(false);
    });
  });
});
