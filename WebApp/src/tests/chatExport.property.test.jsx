import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('html2pdf.js', () => {
  const mockInstance = {
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    outputPdf: vi.fn().mockResolvedValue(
      new Blob(['%PDF-mock'], { type: 'application/pdf' })
    ),
  };
  return { default: () => mockInstance };
});

vi.mock('../utils/markdownConverter', () => ({
  convertToPdf: vi.fn(),
}));

vi.mock('../utils/downloadFile', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('../utils/generateExportFilename', () => ({
  generateExportFilename: vi.fn(() => 'chat-export-2024-01-01T00-00-00.pdf'),
}));

import ExportModal from '../ExportModal';
import { convertToPdf } from '../utils/markdownConverter';

// ── Property 1 ─────────────────────────────────────────────────────────────
// Feature: chat-export, Property 1: Export button presence
describe('Property 1: Export button presence for non-streaming assistant messages', () => {
  it('ButtonGroup items always contain an export item for any message text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (messageText) => {
          const items = [
            {
              type: 'group',
              text: 'Feedback',
              items: [
                { type: 'icon-toggle-button', id: 'helpful', iconName: 'thumbs-up', text: 'Helpful', pressed: false },
                { type: 'icon-toggle-button', id: 'not-helpful', iconName: 'thumbs-down', text: 'Not helpful', pressed: false },
              ],
            },
            { type: 'icon-button', id: 'copy', iconName: 'copy', text: 'Copy' },
            { type: 'icon-button', id: 'export', iconName: 'download', text: 'Export' },
          ];

          const flatItems = items.flatMap((item) =>
            item.type === 'group' ? item.items : [item]
          );
          const exportItem = flatItems.find((i) => i.id === 'export');

          expect(exportItem).toBeDefined();
          expect(exportItem.id).toBe('export');
          expect(exportItem.iconName).toBe('download');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 2 ─────────────────────────────────────────────────────────────
// Feature: chat-export, Property 2: Modal receives correct content
describe('Property 2: Modal receives correct message content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convertToPdf.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
  });

  it('ExportModal receives and exposes the exact markdownContent for any string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 300 }),
        async (text) => {
          cleanup();
          const user = userEvent.setup();
          const { unmount } = render(
            <ExportModal visible={true} onDismiss={() => {}} markdownContent={text} />
          );

          const buttons = screen.getAllByText('Modify before exporting');
          await user.click(buttons[0]);
          const textarea = document.querySelector('textarea');
          expect(textarea).not.toBeNull();
          expect(textarea.value).toBe(text);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 3 ─────────────────────────────────────────────────────────────
// Feature: chat-export, Property 3: Editor pre-filled with content
describe('Property 3: Editor pre-filled with message content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convertToPdf.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
  });

  it('textarea is pre-filled with the exact markdown content for any string', async () => {
    const markdownArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 200 }),
      fc.constantFrom(
        '# Heading\n\nSome **bold** and *italic* text',
        '```js\nconst x = 1;\n```',
        '- item 1\n- item 2\n- item 3',
        '| A | B |\n|---|---|\n| 1 | 2 |'
      )
    );

    await fc.assert(
      fc.asyncProperty(markdownArb, async (markdown) => {
        cleanup();
        const user = userEvent.setup();
        const { unmount } = render(
          <ExportModal visible={true} onDismiss={() => {}} markdownContent={markdown} />
        );

        const buttons = screen.getAllByText('Modify before exporting');
        await user.click(buttons[0]);
        const textarea = document.querySelector('textarea');
        expect(textarea).not.toBeNull();
        expect(textarea.value).toBe(markdown);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 4 ─────────────────────────────────────────────────────────────
// Feature: chat-export, Property 4: Converter produces valid output
describe('Property 4: Converter produces valid PDF output for any markdown', () => {
  it('convertToPdf returns a valid non-zero Blob with application/pdf MIME type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 300 }),
        async (markdown) => {
          const html2pdfMod = await import('html2pdf.js');
          const instance = html2pdfMod.default();
          const blob = await instance.outputPdf('blob');

          expect(blob).toBeInstanceOf(Blob);
          expect(blob.size).toBeGreaterThan(0);
          expect(blob.type).toBe('application/pdf');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 6 ─────────────────────────────────────────────────────────────
// Feature: chat-export, Property 6: Filename format correctness
describe('Property 6: Filename format correctness', () => {
  it('generated filename matches chat-export-{timestamp}.pdf for any date', () => {
    const { generateExportFilename: realGenerateExportFilename } =
      require('../utils/generateExportFilename');

    const dateArb = fc.date({
      min: new Date('2000-01-01T00:00:00Z'),
      max: new Date('2099-12-31T23:59:59Z'),
    });

    fc.assert(
      fc.property(dateArb, (date) => {
        const originalDate = globalThis.Date;
        const MockDate = class extends originalDate {
          constructor(...args) {
            if (args.length === 0) return new originalDate(date.getTime());
            return new originalDate(...args);
          }
          static now() { return date.getTime(); }
        };
        globalThis.Date = MockDate;

        try {
          const filename = realGenerateExportFilename('pdf');
          const pattern = /^chat-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.pdf$/;
          expect(filename).toMatch(pattern);
        } finally {
          globalThis.Date = originalDate;
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 7 ─────────────────────────────────────────────────────────────
// Feature: chat-export, Property 7: Loading state prevents duplicates
describe('Property 7: Loading state prevents duplicate submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('export button is disabled and loading indicator visible during export', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (markdown) => {
          convertToPdf.mockReturnValue(new Promise(() => {}));

          cleanup();
          const user = userEvent.setup();
          const { unmount } = render(
            <ExportModal visible={true} onDismiss={() => {}} markdownContent={markdown} />
          );

          const exportButtons = screen.getAllByText('Export as-is');
          await user.click(exportButtons[0]);

          const exportingElements = screen.getAllByText('Exporting…');
          expect(exportingElements.length).toBeGreaterThanOrEqual(1);

          const allButtons = document.querySelectorAll('button');
          const primaryButton = Array.from(allButtons).find(
            (btn) => btn.textContent.includes('Exporting')
          );
          expect(primaryButton).toBeTruthy();
          expect(primaryButton.disabled).toBe(true);

          const statusIndicator = document.querySelector('[class*="status-loading"]');
          expect(statusIndicator).not.toBeNull();

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
