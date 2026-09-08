export const INTRO_ZOOM_DURATION_SECONDS = 3;
export const INTRO_ZOOM_MAX_START = 5;
export const INTRO_ZOOM_MIN_DELTA = 1;

export function getIntroStartZoom(targetZoom: number, minZoom: number): number {
  return Math.max(minZoom, Math.min(INTRO_ZOOM_MAX_START, targetZoom - INTRO_ZOOM_MIN_DELTA));
}

export function interpolateIntroZoom(startZoom: number, targetZoom: number, progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
  return startZoom + (targetZoom - startZoom) * eased;
}
