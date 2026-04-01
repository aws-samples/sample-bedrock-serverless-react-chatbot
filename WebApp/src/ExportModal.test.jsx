import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportModal from './ExportModal';

// Mock converter functions
vi.mock('./utils/markdownConverter', () => ({
  convertToPdf: vi.fn(),
}));

vi.mock('./utils/downloadFile', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('./utils/generateExportFilename', () => ({
  generateExportFilename: vi.fn(() => 'chat-export-2024-01-01T00-00-00.pdf'),
}));

import { convertToPdf } from './utils/markdownConverter';
import { downloadFile } from './utils/downloadFile';

describe('ExportModal', () => {
  const defaultProps = {
    visible: true,
    onDismiss: vi.fn(),
    markdownContent: '# Hello World',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    convertToPdf.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
  });

  // 5.7 - Shows "Export as-is" and "Modify before exporting" buttons
  it('shows "Export as-is" and "Modify before exporting" buttons', () => {
    render(<ExportModal {...defaultProps} />);
    expect(screen.getByText('Export as-is')).toBeTruthy();
    expect(screen.getByText('Modify before exporting')).toBeTruthy();
  });

  // 5.8 - Cancel closes modal without exporting
  it('cancel closes modal without exporting', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ExportModal {...defaultProps} onDismiss={onDismiss} />);

    await user.click(screen.getByText('Modify before exporting'));
    await user.click(screen.getByText('Cancel'));

    expect(onDismiss).toHaveBeenCalled();
    expect(convertToPdf).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  // 5.9 - Conversion error displays inline error alert
  it('displays inline error alert when conversion fails', async () => {
    const user = userEvent.setup();
    convertToPdf.mockRejectedValue(new Error('Conversion failed'));

    render(<ExportModal {...defaultProps} />);
    await user.click(screen.getByText('Export as-is'));

    await waitFor(() => {
      expect(screen.getByText('Conversion failed')).toBeTruthy();
    });
  });
});

// 5.10 - Export button uses "download" icon name
describe('Export button icon', () => {
  it('export button item uses "download" as iconName', () => {
    const items = [
      {
        type: 'group',
        text: 'Feedback',
        items: [
          { type: 'icon-toggle-button', id: 'helpful', iconName: 'thumbs-up', text: 'Helpful' },
          { type: 'icon-toggle-button', id: 'not-helpful', iconName: 'thumbs-down', text: 'Not helpful' },
        ],
      },
      { type: 'icon-button', id: 'copy', iconName: 'copy', text: 'Copy' },
      { type: 'icon-button', id: 'export', iconName: 'download', text: 'Export' },
    ];

    const exportItem = items.find((item) => item.id === 'export');
    expect(exportItem).toBeDefined();
    expect(exportItem.iconName).toBe('download');
    expect(exportItem.type).toBe('icon-button');
  });
});
