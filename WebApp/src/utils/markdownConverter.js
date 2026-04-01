import { marked } from 'marked';
import html2pdf from 'html2pdf.js';

/**
 * CSS styles applied to the HTML container before PDF conversion.
 * Ensures headings, lists, code blocks, tables, and inline formatting
 * render with appropriate visual treatment.
 */
const PDF_STYLES = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.6; color: #222; }
  h1 { font-size: 24px; font-weight: bold; margin: 16px 0 8px; }
  h2 { font-size: 20px; font-weight: bold; margin: 14px 0 6px; }
  h3 { font-size: 16px; font-weight: bold; margin: 12px 0 6px; }
  h4 { font-size: 14px; font-weight: bold; margin: 10px 0 4px; }
  h5 { font-size: 12px; font-weight: bold; margin: 8px 0 4px; }
  h6 { font-size: 11px; font-weight: bold; margin: 8px 0 4px; }
  ul, ol { padding-left: 24px; margin: 8px 0; }
  li { margin: 2px 0; }
  pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; }
  code { font-family: 'Courier New', Courier, monospace; font-size: 11px; }
  pre code { display: block; }
  :not(pre) > code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f4f4f4; font-weight: bold; }
  a { color: #0073bb; text-decoration: underline; }
  strong { font-weight: bold; }
  em { font-style: italic; }
`;

/**
 * Convert markdown string to PDF Blob.
 * Uses `marked` to parse markdown to HTML, then `html2pdf.js` to generate PDF.
 * @param {string} markdown
 * @returns {Promise<Blob>}
 */
export async function convertToPdf(markdown) {
  const html = marked.parse(markdown || '');

  const container = document.createElement('div');
  container.innerHTML = `<style>${PDF_STYLES}</style>${html}`;

  const options = {
    margin: [10, 10, 10, 10],
    filename: 'export.pdf',
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  const blob = await html2pdf().set(options).from(container).outputPdf('blob');
  return blob;
}
