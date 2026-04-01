import { describe, it, expect, vi } from 'vitest';

// html2pdf.js relies on html2canvas which doesn't work in jsdom,
// so we mock the module to return a Blob with the correct MIME type.
vi.mock('html2pdf.js', () => {
  const mockInstance = {
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    outputPdf: vi.fn().mockResolvedValue(new Blob(['%PDF-mock'], { type: 'application/pdf' })),
  };
  return { default: () => mockInstance };
});

import { convertToPdf } from './markdownConverter';

describe('markdownConverter', () => {
  describe('convertToPdf', () => {
    it('returns a Blob with application/pdf MIME type', async () => {
      const blob = await convertToPdf('# Hello PDF');
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/pdf');
    });

    it('returns a non-zero size Blob for non-empty markdown', async () => {
      const blob = await convertToPdf('Some **bold** text');
      expect(blob.size).toBeGreaterThan(0);
    });
  });
});
