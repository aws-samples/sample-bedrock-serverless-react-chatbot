import { useState, useCallback } from 'react';
import Modal from '@cloudscape-design/components/modal';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Alert from '@cloudscape-design/components/alert';
import { convertToPdf } from './utils/markdownConverter';
import { downloadFile } from './utils/downloadFile';
import { generateExportFilename } from './utils/generateExportFilename';

/**
 * ExportModal — lets the user export markdown content as PDF.
 * Supports "export as-is" and "modify before exporting" workflows.
 *
 * @param {{ visible: boolean, onDismiss: () => void, markdownContent: string }} props
 */
export default function ExportModal({ visible, onDismiss, markdownContent }) {
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);

  const resetState = useCallback(() => {
    setEditing(false);
    setEditedContent('');
    setIsExporting(false);
    setError(null);
  }, []);

  const handleDismiss = useCallback(() => {
    resetState();
    onDismiss();
  }, [resetState, onDismiss]);

  const doExport = useCallback(async (content) => {
    setIsExporting(true);
    setError(null);
    try {
      const blob = await convertToPdf(content);
      const filename = generateExportFilename('pdf');
      downloadFile(blob, filename);
      handleDismiss();
    } catch (err) {
      setError(err.message || 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [handleDismiss]);

  const handleExportAsIs = useCallback(() => {
    doExport(markdownContent);
  }, [doExport, markdownContent]);

  const handleModifyBeforeExporting = useCallback(() => {
    setEditing(true);
    setEditedContent(markdownContent);
    setError(null);
  }, [markdownContent]);

  const handleExportEdited = useCallback(() => {
    doExport(editedContent);
  }, [doExport, editedContent]);

  const handleCancel = useCallback(() => {
    handleDismiss();
  }, [handleDismiss]);

  return (
    <Modal
      visible={visible}
      onDismiss={handleDismiss}
      size={editing ? 'large' : 'medium'}
      header="Export message"
      footer={
        <Box float="right">
          {!editing ? (
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={handleModifyBeforeExporting} disabled={isExporting}>
                Modify before exporting
              </Button>
              <Button
                variant="primary"
                onClick={handleExportAsIs}
                disabled={isExporting}
              >
                {isExporting ? 'Exporting…' : 'Export as-is'}
              </Button>
            </SpaceBetween>
          ) : (
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={handleCancel} disabled={isExporting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleExportEdited}
                disabled={isExporting}
              >
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            </SpaceBetween>
          )}
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {isExporting && (
          <StatusIndicator type="loading">Exporting…</StatusIndicator>
        )}

        {editing && (
          <Box>
            <Box variant="awsui-key-label">Content</Box>
            <Textarea
              value={editedContent}
              onChange={({ detail }) => setEditedContent(detail.value)}
              rows={12}
              disabled={isExporting}
            />
          </Box>
        )}
      </SpaceBetween>
    </Modal>
  );
}
