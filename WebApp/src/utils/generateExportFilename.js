export function generateExportFilename(format) {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
  return `chat-export-${timestamp}.${format}`;
}
