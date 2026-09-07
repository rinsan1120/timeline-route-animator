import { describe, expect, it, vi } from 'vitest';
import { EMPTY_BUFFER_ERROR, JSON_PARSE_ERROR, processTimelineBuffer, TIMELINE_FORMAT_ERROR } from './workerProcessor';

const encode = (value: string) => new TextEncoder().encode(value).buffer;
const logger = { info: vi.fn(), error: vi.fn() };

describe('Timeline Worker buffer processing', () => {
  it('decodes and processes valid Timeline JSON from an ArrayBuffer', () => {
    const json = JSON.stringify({ semanticSegments: [{ timelinePath: [{ point: '35°, 139°', time: '2026-09-07T10:00:00+09:00' }] }] });
    const result = processTimelineBuffer(encode(json), logger);
    expect(result.dates).toEqual(['2026-09-07']);
    expect(result.index.routeByDate.get('2026-09-07')).toHaveLength(1);
  });

  it('rejects a zero-byte buffer', () => {
    expect(() => processTimelineBuffer(new ArrayBuffer(0), logger)).toThrow(EMPTY_BUFFER_ERROR);
  });

  it('reports invalid JSON separately', () => {
    expect(() => processTimelineBuffer(encode('{invalid'), logger)).toThrow(JSON_PARSE_ERROR);
  });

  it('reports data that is not a Timeline document separately', () => {
    expect(() => processTimelineBuffer(encode('{}'), logger)).toThrow(TIMELINE_FORMAT_ERROR);
  });
});
