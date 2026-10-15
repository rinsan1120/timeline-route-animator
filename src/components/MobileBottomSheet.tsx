import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import HelpTip from '../help/HelpTip';

type SheetState = 'closed' | 'half' | 'full';
const STATES: SheetState[] = ['closed', 'half', 'full'];
const STATE_LABELS = { closed: '閉じる', half: '半開き', full: '全開' };

interface MobileBottomSheetProps {
  children: ReactNode;
  steps: readonly [string, string, string];
  resetKey?: string;
}

export default function MobileBottomSheet({ children, steps, resetKey }: MobileBottomSheetProps) {
  const [state, setState] = useState<SheetState>('closed');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const contentId = useId();

  useEffect(() => { setState('closed'); }, [resetKey]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current!;
    const workspace = panel.parentElement!;
    // Share the actual sheet height with map overlays without resizing the map.
    const update = () => workspace.style.setProperty('--mobile-sheet-height', `${panel.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    update();
    return () => { observer.disconnect(); workspace.style.removeProperty('--mobile-sheet-height'); };
  }, []);

  useEffect(() => {
    const shell = panelRef.current?.closest<HTMLElement>('.app-shell');
    const viewport = window.visualViewport;
    if (!shell || !viewport || !mobile) return;
    // Also follow keyboards on browsers where dvh alone does not shrink.
    const update = () => shell.style.setProperty('--mobile-viewport-height', `${viewport.height}px`);
    update();
    viewport.addEventListener('resize', update);
    return () => { viewport.removeEventListener('resize', update); shell.style.removeProperty('--mobile-viewport-height'); };
  }, [mobile]);

  const move = (direction: number) => setState((current) => STATES[Math.max(0, Math.min(2, STATES.indexOf(current) + direction))]);
  const finishGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    gestureRef.current = null;
    const delta = event.clientY - gesture.y;
    const moved = Math.hypot(event.clientX - gesture.x, delta) > 10;
    suppressClickRef.current = moved;
    if (Math.abs(delta) >= 30 && Math.abs(delta) > Math.abs(event.clientX - gesture.x)) move(delta < 0 ? 1 : -1);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <aside ref={panelRef} className="control-panel mobile-bottom-sheet" data-sheet-state={state}>
    <div className="mobile-sheet-header">
      <button type="button" className="mobile-sheet-handle" aria-expanded={state !== 'closed'} aria-controls={contentId}
        aria-label={`設定パネル：${STATE_LABELS[state]}。タップで開閉、上下矢印キーで高さを変更`}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          suppressClickRef.current = false;
          gestureRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={finishGesture}
        onPointerCancel={() => { gestureRef.current = null; suppressClickRef.current = true; }}
        onLostPointerCapture={() => {
          if (gestureRef.current) suppressClickRef.current = true;
          gestureRef.current = null;
        }}
        onClick={(event) => {
          if (event.detail !== 0 && suppressClickRef.current) { suppressClickRef.current = false; return; }
          setState((current) => current === 'closed' ? 'half' : 'closed');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(event.key === 'ArrowUp' ? 1 : -1); }
          if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); setState('closed'); }
          if (event.key === 'End') { event.preventDefault(); setState('full'); }
        }}>
        <span className="mobile-sheet-grip" aria-hidden="true" />
        <span>設定パネル <small>{STATE_LABELS[state]}</small></span>
      </button>
      <div className="mobile-sheet-navigation" hidden={state === 'closed'}>
        <nav aria-label="設定セクションへ移動">{steps.map((title, index) => <button type="button" key={index}
          aria-label={`Step 0${index + 1}：${title}へ移動`}
          onClick={() => {
            const content = contentRef.current;
            const section = content?.querySelectorAll<HTMLElement>(':scope > .panel-section')[index];
            if (content && section) content.scrollTo({ top: section.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop });
          }}>Step 0{index + 1}</button>)}</nav>
        <HelpTip helpKey="mobileBottomSheet" />
      </div>
    </div>
    <div ref={contentRef} id={contentId} className="mobile-sheet-content" inert={mobile && state === 'closed'}>
      {children}
    </div>
  </aside>;
}
