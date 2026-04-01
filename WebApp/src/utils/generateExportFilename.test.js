import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateExportFilename } from './generateExportFilename';

describe('generateExportFilename', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a filename ending with .pdf for pdf format', () => {
    const filename = generateExportFilename('pdf');
    expect(filename).toMatch(/^chat-export-.+\.pdf$/);
  });

  it('returns a filename ending with .docx for docx format', () => {
    const filename = generateExportFilename('docx');
    expect(filename).toMatch(/^chat-export-.+\.docx$/);
  });

  it('does not contain colons in the timestamp', () => {
    const filename = generateExportFilename('pdf');
    // Extract the timestamp portion between "chat-export-" and ".pdf"
    const timestamp = filename.replace('chat-export-', '').replace('.pdf', '');
    expect(timestamp).not.toContain(':');
  });

  it('produces a filename-safe ISO-like timestamp', () => {
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
    const filename = generateExportFilename('pdf');
    expect(filename).toBe('chat-export-2024-01-15T10-30-00.pdf');
    vi.useRealTimers();
  });
});
