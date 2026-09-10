export interface ViewportSize {
  width: number;
  height: number;
}

export interface OverviewPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const VIDEO_VIEWPORT: ViewportSize = { width: 1920, height: 1080 };

export const OVERVIEW_FIT_PADDING: OverviewPadding = {
  top: 72,
  right: 44,
  bottom: 92,
  left: 44,
};

export function overviewViewportScale(reference: ViewportSize, target: ViewportSize): number {
  if (!isValidViewport(reference) || !isValidViewport(target)) return 1;
  return Math.min(target.width / reference.width, target.height / reference.height);
}

export function overviewZoomForViewport(zoom: number, reference: ViewportSize, target: ViewportSize): number {
  return zoom + Math.log2(overviewViewportScale(reference, target));
}

export function overviewPaddingForViewport(reference: ViewportSize, target: ViewportSize): OverviewPadding {
  const scale = overviewViewportScale(reference, target);
  return {
    top: OVERVIEW_FIT_PADDING.top * scale,
    right: OVERVIEW_FIT_PADDING.right * scale,
    bottom: OVERVIEW_FIT_PADDING.bottom * scale,
    left: OVERVIEW_FIT_PADDING.left * scale,
  };
}

function isValidViewport(viewport: ViewportSize): boolean {
  return Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;
}
