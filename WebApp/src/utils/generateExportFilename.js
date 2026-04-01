/**
 * Generate a filename in the format "chat-export-{timestamp}.{extension}"
 * The timestamp is ISO-like but safe for filenames (colons replaced with dashes).
 * @param {'pdf' | 'docx'} format
 * @returns {string}
 */
export function generateExportFilename(format) {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
  return `chat-export-${timestamp}.${format}`;
}
