import { describe, expect, it, vi } from 'vitest';
import { EMPTY_FILE_ERROR, readTimelineFile, type ReadableTimelineFile } from './fileLoader';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

describe('Timeline file loading', () => {
  it('uses the actual buffer even when the provider reports file.size as zero', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const buffer = bytes('{"semanticSegments":[]}');
    const file: ReadableTimelineFile = { name: 'timeline.json', type: 'application/json', size: 0, arrayBuffer: async () => buffer };
    await expect(readTimelineFile(file)).resolves.toBe(buffer);
  });

  it('rejects an actually empty buffer with a clear error', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const file: ReadableTimelineFile = { name: 'empty.json', type: '', size: 0, arrayBuffer: async () => new ArrayBuffer(0) };
    await expect(readTimelineFile(file)).rejects.toThrow(EMPTY_FILE_ERROR);
  });
});
