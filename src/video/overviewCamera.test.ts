import { describe, expect, it } from 'vitest';
import { overviewPaddingForViewport, overviewZoomForViewport, VIDEO_VIEWPORT } from './overviewCamera';

describe('overview camera viewport conversion', () => {
  it('preserves the preview composition when scaling to the video viewport', () => {
    const previewViewport = { width: 960, height: 540 };

    expect(overviewZoomForViewport(10, previewViewport, VIDEO_VIEWPORT)).toBe(11);
    expect(overviewPaddingForViewport(previewViewport, VIDEO_VIEWPORT)).toEqual({
      top: 144,
      right: 88,
      bottom: 184,
      left: 88,
    });
  });
});
