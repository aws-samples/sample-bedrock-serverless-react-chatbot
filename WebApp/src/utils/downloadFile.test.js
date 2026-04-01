import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadFile } from './downloadFile';

describe('downloadFile', () => {
  let clickSpy;
  let createObjectURLSpy;
  let revokeObjectURLSpy;

  beforeEach(() => {
    clickSpy = vi.fn();
    createObjectURLSpy = vi.fn(() => 'blob:http://localhost/fake-url');
    revokeObjectURLSpy = vi.fn();

    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;

    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
      style: {},
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a blob URL from the provided blob', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    downloadFile(blob, 'test.txt');
    expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
  });

  it('sets the download attribute to the provided filename', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    const anchor = { href: '', download: '', click: clickSpy, style: {} };
    document.createElement.mockReturnValue(anchor);

    downloadFile(blob, 'my-file.pdf');
    expect(anchor.download).toBe('my-file.pdf');
  });

  it('triggers a click on the anchor element', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    downloadFile(blob, 'test.txt');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('revokes the blob URL after download', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    downloadFile(blob, 'test.txt');
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/fake-url');
  });
});
