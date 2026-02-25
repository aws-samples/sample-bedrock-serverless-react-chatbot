// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Unit Tests for Sanitization Utility
 * 
 * Tests verify that the sanitizeForLog function properly sanitizes
 * user input and external data before logging to prevent log injection
 * attacks and log flooding.
 * 
 * Requirements tested: 8.1, 8.4
 */

const { sanitizeForLog } = require('./sanitize');

describe('sanitizeForLog', () => {
  describe('Newline Removal', () => {
    test('should remove \\n newlines', () => {
      const input = 'Hello\nWorld';
      const result = sanitizeForLog(input);
      expect(result).toBe('Hello World');
      expect(result).not.toContain('\n');
    });

    test('should remove \\r carriage returns', () => {
      const input = 'Hello\rWorld';
      const result = sanitizeForLog(input);
      expect(result).toBe('Hello World');
      expect(result).not.toContain('\r');
    });

    test('should remove \\r\\n Windows-style line endings', () => {
      const input = 'Hello\r\nWorld';
      const result = sanitizeForLog(input);
      expect(result).toBe('Hello  World'); // Two spaces because both \r and \n are replaced
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
    });

    test('should remove multiple newlines', () => {
      const input = 'Line1\nLine2\nLine3\nLine4';
      const result = sanitizeForLog(input);
      expect(result).toBe('Line1 Line2 Line3 Line4');
      expect(result).not.toContain('\n');
    });

    test('should handle log injection attempt', () => {
      const maliciousInput = 'User input\n[ERROR] Fake error message\n[WARN] Fake warning';
      const result = sanitizeForLog(maliciousInput);
      expect(result).not.toContain('\n');
      expect(result).toBe('User input [ERROR] Fake error message [WARN] Fake warning');
    });
  });

  describe('Length Limiting', () => {
    test('should limit string to default 200 characters', () => {
      const longString = 'A'.repeat(300);
      const result = sanitizeForLog(longString);
      expect(result.length).toBe(203); // 200 + '...'
      expect(result).toBe('A'.repeat(200) + '...');
    });

    test('should limit string to custom maxLength', () => {
      const longString = 'B'.repeat(150);
      const result = sanitizeForLog(longString, 50);
      expect(result.length).toBe(53); // 50 + '...'
      expect(result).toBe('B'.repeat(50) + '...');
    });

    test('should not truncate strings shorter than maxLength', () => {
      const shortString = 'Short string';
      const result = sanitizeForLog(shortString);
      expect(result).toBe('Short string');
      expect(result).not.toContain('...');
    });

    test('should handle exactly maxLength characters', () => {
      const exactString = 'C'.repeat(200);
      const result = sanitizeForLog(exactString);
      expect(result).toBe(exactString);
      expect(result).not.toContain('...');
    });

    test('should prevent log flooding with very long input', () => {
      const floodAttempt = 'X'.repeat(10000);
      const result = sanitizeForLog(floodAttempt);
      expect(result.length).toBe(203); // 200 + '...'
    });
  });

  describe('Type Handling', () => {
    test('should handle null', () => {
      const result = sanitizeForLog(null);
      expect(result).toBe('null');
    });

    test('should handle undefined', () => {
      const result = sanitizeForLog(undefined);
      expect(result).toBe('undefined');
    });

    test('should handle numbers', () => {
      expect(sanitizeForLog(42)).toBe('42');
      expect(sanitizeForLog(3.14)).toBe('3.14');
      expect(sanitizeForLog(0)).toBe('0');
      expect(sanitizeForLog(-100)).toBe('-100');
    });

    test('should handle booleans', () => {
      expect(sanitizeForLog(true)).toBe('true');
      expect(sanitizeForLog(false)).toBe('false');
    });

    test('should handle objects via JSON.stringify', () => {
      const obj = { key: 'value', number: 42 };
      const result = sanitizeForLog(obj);
      expect(result).toBe('{"key":"value","number":42}');
    });

    test('should handle arrays via JSON.stringify', () => {
      const arr = [1, 2, 3, 'test'];
      const result = sanitizeForLog(arr);
      expect(result).toBe('[1,2,3,"test"]');
    });

    test('should handle circular references gracefully', () => {
      const circular = { name: 'test' };
      circular.self = circular;
      const result = sanitizeForLog(circular);
      // Should fallback to toString for circular references
      expect(result).toBe('[object Object]');
    });

    test('should handle empty string', () => {
      const result = sanitizeForLog('');
      expect(result).toBe('');
    });

    test('should handle empty object', () => {
      const result = sanitizeForLog({});
      expect(result).toBe('{}');
    });

    test('should handle empty array', () => {
      const result = sanitizeForLog([]);
      expect(result).toBe('[]');
    });
  });

  describe('Combined Scenarios', () => {
    test('should handle newlines and length limiting together', () => {
      const input = 'A'.repeat(150) + '\n' + 'B'.repeat(150);
      const result = sanitizeForLog(input);
      expect(result).not.toContain('\n');
      expect(result.length).toBe(203); // 200 + '...'
    });

    test('should handle object with newlines in values', () => {
      const obj = { message: 'Hello\nWorld', data: 'Test\rData' };
      const result = sanitizeForLog(obj);
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\r');
    });

    test('should handle realistic user input scenario', () => {
      const userInput = 'User entered: "Some text\nwith newlines\rand special chars"';
      const result = sanitizeForLog(userInput);
      expect(result).toBe('User entered: "Some text with newlines and special chars"');
    });

    test('should handle error message with stack trace', () => {
      const errorMsg = 'Error occurred\nStack trace:\n  at function1()\n  at function2()';
      const result = sanitizeForLog(errorMsg);
      expect(result).not.toContain('\n');
      expect(result).toContain('Error occurred Stack trace:   at function1()   at function2()');
    });
  });

  describe('Edge Cases', () => {
    test('should handle string with only newlines', () => {
      const result = sanitizeForLog('\n\n\n');
      expect(result).toBe('   '); // Three spaces
    });

    test('should handle very large object', () => {
      const largeObj = {};
      for (let i = 0; i < 100; i++) {
        largeObj[`key${i}`] = `value${i}`;
      }
      const result = sanitizeForLog(largeObj);
      expect(result.length).toBeLessThanOrEqual(203); // Should be truncated
    });

    test('should handle special characters', () => {
      const input = 'Special: !@#$%^&*()_+-=[]{}|;:,.<>?';
      const result = sanitizeForLog(input);
      expect(result).toBe(input); // Special chars should be preserved
    });

    test('should handle unicode characters', () => {
      const input = 'Unicode: 你好 🌍 café';
      const result = sanitizeForLog(input);
      expect(result).toBe(input);
    });

    test('should handle tabs (should be preserved)', () => {
      const input = 'Hello\tWorld';
      const result = sanitizeForLog(input);
      expect(result).toBe('Hello\tWorld'); // Tabs are not removed, only newlines
    });
  });
});
