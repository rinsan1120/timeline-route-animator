import type { BalloonFramePosition } from './placement';

interface Rect { left: number; top: number; width: number; height: number }

interface FrameDragOptions {
  threshold?: number;
  start?: () => boolean | 'selection-only';
  end?: (committed: boolean) => void;
  skipUnchanged?: boolean;
  keepCommittedPreview?: boolean;
  activate?: () => void;
  blockedMove?: () => void;
  deferTouchStart?: boolean;
}

// The invisible hit target follows the shared Canvas rectangle. Pointer capture
// keeps drags local to the balloon, including touch cancellation and lost capture.
export function bindFrameBalloonDrag(
  element: HTMLButtonElement, rect: () => Rect, displayScale: () => number,
  position: (center: { x: number; y: number }) => BalloonFramePosition,
  preview: (position: BalloonFramePosition | null) => void,
  commit: (position: BalloonFramePosition) => void,
  options: FrameDragOptions = {},
) {
  let drag: { id: number; x: number; y: number; scale: number; center: { x: number; y: number }; moved: boolean; started: boolean; editable: boolean; position: BalloonFramePosition | null } | null = null;
  const stop = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const changed = (center: { x: number; y: number }, next: BalloonFramePosition) => {
    const original = position(center);
    return Math.abs(original.x - next.x) > 1e-9 || Math.abs(original.y - next.y) > 1e-9;
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag || !event.isPrimary) return;
    stop(event);
    const deferred = !!options.deferTouchStart && event.pointerType === 'touch';
    const start = deferred ? undefined : options.start?.();
    if (start === false) return;
    const box = rect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, scale: displayScale(), center: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, moved: false, started: !deferred, editable: start !== 'selection-only', position: null };
    element.setPointerCapture(event.pointerId);
    element.dataset.dragging = 'true';
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    stop(event);
    if (event.clientX === drag.x && event.clientY === drag.y && !drag.moved) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < (options.threshold ?? 0)) return;
    if (!drag.started) {
      const start = options.start?.();
      if (!drag) return;
      if (start === false) { cancel(); return; }
      drag.started = true;
      drag.editable = start !== 'selection-only';
    }
    drag.moved = true;
    if (!drag.editable) {
      // End capture before a selection confirmation can open a native dialog.
      cancel();
      options.blockedMove?.();
      return;
    }
    const scale = options.threshold === undefined ? displayScale() : drag.scale;
    drag.position = position({ x: drag.center.x + (event.clientX - drag.x) / scale, y: drag.center.y + (event.clientY - drag.y) / scale });
    preview(drag.position);
  };
  const finish = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.type === 'pointerup') move(event);
    if (!drag) return;
    stop(event);
    const current = drag;
    drag = null;
    element.dataset.dragging = 'false';
    if (element.hasPointerCapture(current.id)) element.releasePointerCapture(current.id);
    const committed = event.type === 'pointerup' && current.moved && current.position !== null
      && (!options.skipUnchanged || changed(current.center, current.position));
    if (committed) commit(current.position!);
    options.end?.(committed);
    if (!committed || !options.keepCommittedPreview) preview(null);
    if (event.type === 'pointerup' && !current.moved) options.activate?.();
  };
  const keydown = (event: KeyboardEvent) => {
    const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
    if (!delta || drag) return;
    stop(event);
    const start = options.start?.();
    if (start === false) return;
    if (start === 'selection-only') { options.blockedMove?.(); return; }
    const box = rect();
    const step = event.shiftKey ? 20 : 5;
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const next = position({ x: center.x + delta[0] * step, y: center.y + delta[1] * step });
    const committed = !options.skipUnchanged || changed(center, next);
    if (committed) commit(next);
    options.end?.(committed);
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  const click = (event: MouseEvent) => {
    stop(event);
    if (event.detail === 0 && !('pointerType' in event && event.pointerType) && !drag) options.activate?.();
  };
  element.addEventListener('click', click);
  element.addEventListener('keydown', keydown);
  const cancel = () => {
    const id = drag?.id;
    drag = null;
    element.dataset.dragging = 'false';
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    if (id !== undefined) { options.end?.(false); if (options.end) preview(null); }
  };
  const cleanup = () => {
    cancel();
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.removeEventListener('lostpointercapture', finish);
    element.removeEventListener('click', click);
    element.removeEventListener('keydown', keydown);
  };
  return Object.assign(cleanup, { cancel });
}
