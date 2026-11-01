import { describe, expect, it } from 'vitest';
import { getIntroStartZoom } from './introZoom';
import { DEFAULT_VIDEO_SETTINGS, parseVideoSettings } from './videoSettings';
import { VIDEO_MIN_ZOOM } from './overviewCamera';

describe('intro zoom start level', () => {
  it('keeps the automatic start zoom unchanged', () => {
    expect(getIntroStartZoom(10, VIDEO_MIN_ZOOM)).toBe(5);
    expect(getIntroStartZoom(6, VIDEO_MIN_ZOOM)).toBe(5);
    expect(getIntroStartZoom(4, VIDEO_MIN_ZOOM)).toBe(3);
  });

  it('uses a custom start zoom as an absolute level', () => {
    expect(getIntroStartZoom(10, VIDEO_MIN_ZOOM, 7)).toBe(7);
    expect(getIntroStartZoom(8, VIDEO_MIN_ZOOM, 6.5)).toBe(6.5);
  });

  it('clamps a custom start zoom below the target so the intro never zooms out', () => {
    expect(getIntroStartZoom(8, VIDEO_MIN_ZOOM, 9)).toBe(7.5);
    expect(getIntroStartZoom(4.5, VIDEO_MIN_ZOOM, 12)).toBe(4);
  });
});

describe('video settings intro zoom start level parsing', () => {
  it('loads settings saved before the start level existed with automatic defaults', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_VIDEO_SETTINGS };
    delete legacy.introZoomStartMode;
    delete legacy.introZoomStartZoom;
    const parsed = parseVideoSettings(legacy);
    expect(parsed.introZoomStartMode).toBe('auto');
    expect(parsed.introZoomStartZoom).toBe(DEFAULT_VIDEO_SETTINGS.introZoomStartZoom);
  });

  it('round-trips a custom start level', () => {
    const parsed = parseVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, introZoomStartMode: 'custom', introZoomStartZoom: 7.5 });
    expect(parsed.introZoomStartMode).toBe('custom');
    expect(parsed.introZoomStartZoom).toBe(7.5);
  });

  it('rejects an out-of-range custom start zoom', () => {
    expect(() => parseVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, introZoomStartMode: 'custom', introZoomStartZoom: 20 })).toThrow();
    expect(() => parseVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, introZoomStartMode: 'wide' })).toThrow();
  });
});
