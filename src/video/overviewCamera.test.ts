import { describe, expect, it } from 'vitest';
import { getVideoPreviewViewport, videoZoomToPreviewZoom } from './overviewCamera';

describe('overview camera viewport conversion', () => {
  it('scales the video camera into a centered 16:9 frame, not the entire map', () => {
    const previewViewport = getVideoPreviewViewport(960, 720);
    expect(previewViewport).toEqual({ width: 960, height: 540, left: 0, top: 90, scale: 0.5 });
    expect(videoZoomToPreviewZoom(10, previewViewport.scale)).toBe(9);
  });
});
