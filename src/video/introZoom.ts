export const INTRO_ZOOM_MAX_START = 5;
export const INTRO_ZOOM_MIN_DELTA = 1;
export const INTRO_ZOOM_CUSTOM_MIN_DELTA = 0.5;
export const DEFAULT_INTRO_ZOOM_START_ZOOM = 5;

export function getIntroStartZoom(targetZoom: number, minZoom: number, customStartZoom?: number): number {
  // A custom start level is an absolute zoom, but it must stay below the
  // target so the intro always zooms in, never out.
  if (customStartZoom !== undefined && Number.isFinite(customStartZoom)) {
    return Math.max(minZoom, Math.min(customStartZoom, targetZoom - INTRO_ZOOM_CUSTOM_MIN_DELTA));
  }
  return Math.max(minZoom, Math.min(INTRO_ZOOM_MAX_START, targetZoom - INTRO_ZOOM_MIN_DELTA));
}

export function interpolateIntroZoom(startZoom: number, targetZoom: number, progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
  return startZoom + (targetZoom - startZoom) * eased;
}
