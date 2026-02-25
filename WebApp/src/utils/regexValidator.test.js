// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for Regular Expression Validator
 * 
 * Tests verify that regex patterns are validated for safety to prevent
 * ReDoS (Regular Expression Denial of Service) attacks.
 * 
 * Requirements tested: 8.2, 8.5 - Static RegExp patterns and ReDoS protection
 */

const { 
  SAFE_FILTER_PATTERNS, 
  validateRegexPattern, 
  validateFilters 
} = require('./regexValidator');

describe('regexValidator', () => {
  describe('SAFE_FILTER_PATTERNS', () => {
    test('should contain predefined safe patterns', () => {
      expect(SAFE_FILTER_PATTERNS).toBeDefined();
      expect(SAFE_FILTER_PATTERNS.all).toBe('.*');
      expect(SAFE_FILTER_PATTERNS.pdf).toBe('.*\\.pdf');
      expect(SAFE_FILTER_PATTERNS.zip).toBe('.*\\.zip');
      expect(SAFE_FILTER_PATTERNS.exe).toBe('.*\\.exe');
    });
  });

  describe('validateRegexPattern', () => {
    describe('Safe Patterns', () => {
      test('should accept predefined safe patterns', () => {
        expect(validateRegexPattern('.*')).toBe(true);
        expect(validateRegexPattern('.*\\.pdf')).toBe(true);
        expect(validateRegexPattern('.*\\.zip')).toBe(true);
        expect(validateRegexPattern('.*\\.exe')).toBe(true);
      });

      test('should accept simple file extension patterns', () => {
        expect(validateRegexPattern('.*\\.txt')).toBe(true);
        expect(validateRegexPattern('.*\\.doc')).toBe(true);
        expect(validateRegexPattern('.*\\.html')).toBe(true);
      });

      test('should accept alternation patterns', () => {
        expect(validateRegexPattern('.*\\.(jpg|png|gif)')).toBe(true);
        expect(validateRegexPattern('(foo|bar)')).toBe(true);
      });

      test('should accept character classes', () => {
        expect(validateRegexPattern('[a-z]+')).toBe(true);
        expect(validateRegexPattern('[0-9]{3}')).toBe(true);
        expect(validateRegexPattern('[A-Za-z0-9]+')).toBe(true);
      });
    });

    describe('ReDoS Protection', () => {
      test('should reject patterns with nested quantifiers (*+)', () => {
        expect(() => validateRegexPattern('(a*)+b')).toThrow('nested quantifiers');
      });

      test('should reject patterns with nested quantifiers (+*)', () => {
        expect(() => validateRegexPattern('(a+)*b')).toThrow('nested quantifiers');
      });

      test('should reject patterns with nested quantifiers ({n,}+)', () => {
        expect(() => validateRegexPattern('(a{2,})+b')).toThrow('nested quantifiers');
      });

      test('should reject patterns that are too long', () => {
        const longPattern = 'a'.repeat(101);
        expect(() => validateRegexPattern(longPattern)).toThrow('too long');
      });

      test('should accept patterns at the length limit', () => {
        const maxLengthPattern = 'a'.repeat(100);
        expect(validateRegexPattern(maxLengthPattern)).toBe(true);
      });
    });

    describe('Invalid Patterns', () => {
      test('should throw on invalid regex syntax', () => {
        expect(() => validateRegexPattern('[abc')).toThrow();
      });

      test('should throw on unclosed groups', () => {
        expect(() => validateRegexPattern('(abc')).toThrow();
      });
    });
  });

  describe('validateFilters', () => {
    describe('Valid Filter Lists', () => {
      test('should accept single valid filter', () => {
        expect(validateFilters('.*\\.pdf')).toBe(true);
      });

      test('should accept multiple valid filters', () => {
        const filters = '.*\\.pdf\n.*\\.zip\n.*\\.exe';
        expect(validateFilters(filters)).toBe(true);
      });

      test('should accept filters with whitespace', () => {
        const filters = '  .*\\.pdf  \n  .*\\.zip  ';
        expect(validateFilters(filters)).toBe(true);
      });

      test('should accept filters with empty lines', () => {
        const filters = '.*\\.pdf\n\n.*\\.zip\n\n';
        expect(validateFilters(filters)).toBe(true);
      });

      test('should accept all predefined safe patterns', () => {
        const filters = Object.values(SAFE_FILTER_PATTERNS).join('\n');
        expect(validateFilters(filters)).toBe(true);
      });
    });

    describe('Invalid Filter Lists', () => {
      test('should reject empty string', () => {
        expect(validateFilters('')).toBe(false);
      });

      test('should reject whitespace only', () => {
        expect(validateFilters('   \n  \n  ')).toBe(false);
      });

      test('should reject filters with ReDoS patterns', () => {
        const filters = '.*\\.pdf\n(a+)+b\n.*\\.zip';
        expect(validateFilters(filters)).toBe(false);
      });

      test('should reject filters with invalid syntax', () => {
        const filters = '.*\\.pdf\n[abc\n.*\\.zip';
        expect(validateFilters(filters)).toBe(false);
      });

      test('should reject filters with patterns that are too long', () => {
        const longPattern = 'a'.repeat(101);
        const filters = `.*\\.pdf\n${longPattern}\n.*\\.zip`;
        expect(validateFilters(filters)).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      test('should handle single line without newline', () => {
        expect(validateFilters('.*\\.pdf')).toBe(true);
      });

      test('should handle trailing newlines', () => {
        expect(validateFilters('.*\\.pdf\n')).toBe(true);
      });

      test('should handle multiple consecutive newlines', () => {
        expect(validateFilters('.*\\.pdf\n\n\n.*\\.zip')).toBe(true);
      });

      test('should handle mixed line endings', () => {
        expect(validateFilters('.*\\.pdf\r\n.*\\.zip')).toBe(true);
      });
    });
  });

  describe('Security Requirements', () => {
    test('should prevent ReDoS attack patterns', () => {
      // Common ReDoS patterns that should be rejected
      const redosPatterns = [
        '(a+)+b',           // Nested quantifiers
        '(a*)*b',           // Nested quantifiers
        '(a+)*b',           // Nested quantifiers
        '(a*)+b',           // Nested quantifiers
        '(a{2,})+b',        // Nested quantifiers with range
      ];

      redosPatterns.forEach(pattern => {
        expect(() => validateRegexPattern(pattern)).toThrow();
      });
    });

    test('should allow safe common patterns', () => {
      // Common safe patterns that should be accepted
      const safePatterns = [
        '.*',
        '.*\\.pdf',
        '.*\\.(jpg|png|gif)',
        '^https?://',
        '[a-zA-Z0-9]+',
        '\\d{3}-\\d{3}-\\d{4}',
        '^[a-z]+$',
      ];

      safePatterns.forEach(pattern => {
        expect(validateRegexPattern(pattern)).toBe(true);
      });
    });

    test('should enforce length limits', () => {
      // Pattern at limit should pass
      const atLimit = 'a'.repeat(100);
      expect(validateRegexPattern(atLimit)).toBe(true);

      // Pattern over limit should fail
      const overLimit = 'a'.repeat(101);
      expect(() => validateRegexPattern(overLimit)).toThrow('too long');
    });
  });
});
