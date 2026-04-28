import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import { convertToPdf } from './utils/markdownConverter';
import { downloadFile } from './utils/downloadFile';
import { generateExportFilename } from './utils/generateExportFilename';

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
      downloadFile(blob, generateExportFilename('pdf'));
      handleDismiss();
    } catch (err) {
      setError(err.message || 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [handleDismiss]);

  return (
    <Dialog open={visible} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent size={editing ? 'large' : 'default'}>
        <DialogHeader>
          <DialogTitle>Export message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive" dismissible onDismiss={() => setError(null)}>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {isExporting && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Exporting…
            </div>
          )}
          {editing && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Content</label>
              <Textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                rows={12}
                disabled={isExporting}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          {!editing ? (
            <>
              <Button variant="outline" onClick={() => { setEditing(true); setEditedContent(markdownContent); setError(null); }} disabled={isExporting}>
                Modify before exporting
              </Button>
              <Button onClick={() => doExport(markdownContent)} disabled={isExporting}>
                {isExporting ? 'Exporting…' : 'Export as-is'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleDismiss} disabled={isExporting}>Cancel</Button>
              <Button onClick={() => doExport(editedContent)} disabled={isExporting}>
                {isExporting ? 'Exporting…' : 'Export'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
