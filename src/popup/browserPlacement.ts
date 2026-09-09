import { nearestPointOnRect, placedPopupRect, popupDisplayScale, type PopupPlacement } from './placement';

export function positionManualPopup(element: HTMLDivElement, container: HTMLDivElement, anchor: { x: number; y: number }, placement: PopupPlacement | undefined, bottomMargin: number) {
  element.dataset.manual = String(Boolean(placement));
  const connector = element.querySelector<SVGSVGElement>('.popup-connector');
  if (!placement || !connector) return;
  connector.style.left = `${-element.clientLeft}px`;
  connector.style.top = `${-element.clientTop}px`;
  const rect = placedPopupRect(anchor, placement, element.offsetWidth, element.offsetHeight, container.clientWidth, container.clientHeight - bottomMargin, 8, popupDisplayScale(container.clientWidth, container.clientHeight));
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  const edge = nearestPointOnRect(rect, anchor);
  const line = connector.querySelector('line')!;
  line.setAttribute('x1', String(edge.x - rect.left));
  line.setAttribute('y1', String(edge.y - rect.top));
  line.setAttribute('x2', String(anchor.x - rect.left));
  line.setAttribute('y2', String(anchor.y - rect.top));
  const dot = connector.querySelector('circle');
  dot?.setAttribute('cx', String(anchor.x - rect.left));
  dot?.setAttribute('cy', String(anchor.y - rect.top));
}

export function bindPopupDrag(element: HTMLDivElement, container: HTMLDivElement, anchor: () => { x: number; y: number }, commit: (placement: PopupPlacement) => void, restore: () => void, bottomMargin: number) {
  let drag: { id: number; x: number; y: number; centerX: number; centerY: number; moved: boolean } | null = null;
  element.dataset.draggable = 'true';
  const stop = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    stop(event);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, centerX: element.offsetLeft + element.offsetWidth / 2, centerY: element.offsetTop + element.offsetHeight / 2, moved: false };
    element.setPointerCapture(event.pointerId);
    element.dataset.dragging = 'true';
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    stop(event);
    if (event.clientX === drag.x && event.clientY === drag.y && !drag.moved) return;
    drag.moved = true;
    const point = anchor();
    const scale = popupDisplayScale(container.clientWidth, container.clientHeight);
    positionManualPopup(element, container, point, { offsetX: (drag.centerX + event.clientX - drag.x - point.x) / scale, offsetY: (drag.centerY + event.clientY - drag.y - point.y) / scale }, bottomMargin);
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (event.type === 'pointerup') move(event);
    stop(event);
    const moved = drag.moved;
    const id = drag.id;
    drag = null;
    element.dataset.dragging = 'false';
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    if (event.type === 'pointerup' && moved) {
      const point = anchor();
      const scale = popupDisplayScale(container.clientWidth, container.clientHeight);
      commit({ offsetX: (element.offsetLeft + element.offsetWidth / 2 - point.x) / scale, offsetY: (element.offsetTop + element.offsetHeight / 2 - point.y) / scale });
    } else restore();
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  element.addEventListener('click', stop);
  return () => {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    element.dataset.draggable = 'false';
    element.dataset.dragging = 'false';
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.removeEventListener('lostpointercapture', finish);
    element.removeEventListener('click', stop);
  };
}
