import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTimelineRange, getAvailableDates, parseTimelineText } from '../src/timeline/parser';

const sampleDirectory = resolve(process.cwd(), 'sample-data');
const files = existsSync(sampleDirectory)
  ? readdirSync(sampleDirectory).filter((name) => name.endsWith('.json')).map((name) => resolve(sampleDirectory, name))
  : [];

describe.skipIf(files.length === 0)('local private Timeline samples', () => {
  for (const file of files) {
    it(`parses ${file.split('/').at(-1)} without exposing location data`, () => {
      expect(statSync(file).size).toBeGreaterThan(0);
      const index = parseTimelineText(readFileSync(file, 'utf8'));
      const dates = getAvailableDates(index);
      expect(dates.length).toBeGreaterThan(0);
      const results = dates.map((date) => extractTimelineRange(index, date, '00:00', '23:59'));
      const routeCount = results.reduce((sum, result) => sum + result.routePoints.length, 0);
      const rawCount = results.reduce((sum, result) => sum + result.rawPositions.length, 0);
      expect(routeCount).toBeGreaterThan(0);
      expect(rawCount).toBeGreaterThan(0);
      expect(results.every((result) => result.routePoints.every((point) => point.source === 'timelinePath'))).toBe(true);
      expect(results.every((result) => result.routePoints.every((point, index, points) => index === 0 || (points[index - 1].timestamp ?? '') <= (point.timestamp ?? '')))).toBe(true);
      console.info(`private sample verified: ${dates.length} dates, ${routeCount} route points, ${rawCount} raw positions`);
    }, 30_000);
  }
});
