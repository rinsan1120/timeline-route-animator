import type { BalloonFramePosition } from './placement';

interface Rect { left: number; top: number; width: number; height: number }

// The invisible hit target follows the shared Canvas rectangle. Pointer capture
// keeps drags local to the balloon, including touch cancellation and lost capture.
export function bindFrameBalloonDrag(
  element: HTMLButtonElement, rect: () => Rect, displayScale: () => number,
  position: (center: { x: number; y: number }) => BalloonFramePosition,
  preview: (position: BalloonFramePosition | null) => void,
  commit: (position: BalloonFramePosition) => void,
) {
  let drag: { id: number; x: number; y: number; center: { x: number; y: number }; moved: boolean; position: BalloonFramePosition | null } | null = null;
  const stop = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag || !event.isPrimary) return;
    stop(event);
    const box = rect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, center: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, moved: false, position: null };
    element.setPointerCapture(event.pointerId);
    element.dataset.dragging = 'true';
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    stop(event);
    if (event.clientX === drag.x && event.clientY === drag.y && !drag.moved) return;
    drag.moved = true;
    drag.position = position({ x: drag.center.x + (event.clientX - drag.x) / displayScale(), y: drag.center.y + (event.clientY - drag.y) / displayScale() });
    preview(drag.position);
  };
  const finish = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.type === 'pointerup') move(event);
    stop(event);
    const current = drag;
    drag = null;
    element.dataset.dragging = 'false';
    if (element.hasPointerCapture(current.id)) element.releasePointerCapture(current.id);
    if (event.type === 'pointerup' && current.moved && current.position) commit(current.position);
    preview(null);
  };
  const keydown = (event: KeyboardEvent) => {
    const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
    if (!delta) return;
    stop(event);
    const box = rect();
    const step = event.shiftKey ? 20 : 5;
    commit(position({ x: box.left + box.width / 2 + delta[0] * step, y: box.top + box.height / 2 + delta[1] * step }));
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  element.addEventListener('click', stop);
  element.addEventListener('keydown', keydown);
  return () => {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.removeEventListener('lostpointercapture', finish);
    element.removeEventListener('click', stop);
    element.removeEventListener('keydown', keydown);
  };
}
