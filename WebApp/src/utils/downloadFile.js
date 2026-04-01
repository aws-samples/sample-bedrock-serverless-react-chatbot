/**
 * Trigger a browser file download.
 * Creates an anchor element, sets href to a blob URL, sets the download
 * attribute, clicks it, then revokes the URL.
 * @param {Blob} blob - The file content
 * @param {string} filename - e.g. "chat-export-2024-01-15T10-30-00.pdf"
 */
export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
