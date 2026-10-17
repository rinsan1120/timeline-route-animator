import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP_CONTENT, type HelpKey } from './helpContent';

interface HelpTipProps {
  helpKey: HelpKey;
  variant?: 'inline' | 'toolbar';
  fitViewport?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function HelpTip({ helpKey, variant = 'inline', fitViewport = false, open, onOpenChange }: HelpTipProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [toolbarStyle, setToolbarStyle] = useState<CSSProperties>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const content = HELP_CONTENT[helpKey];
  const isOpen = open ?? internalOpen;

  useLayoutEffect(() => {
    if (!isOpen || variant !== 'toolbar') return;
    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      if (fitViewport) {
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
        const height = viewport?.height ?? window.innerHeight, viewportWidth = viewport?.width ?? window.innerWidth;
        const width = Math.min(320, viewportWidth - 24);
        const above = Math.max(0, rect.top - top - 20), below = Math.max(0, top + height - rect.bottom - 20);
        const placeAbove = above >= Math.min(180, height * 0.4) || above >= below;
        setToolbarStyle({ width, left: Math.min(left + viewportWidth - width - 12, Math.max(left + 12, rect.left + rect.width / 2 - width / 2)),
          maxHeight: Math.min(180, height * 0.4, placeAbove ? above : below),
          ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
        });
        return;
      }
      const width = Math.min(320, window.innerWidth - 24);
      setToolbarStyle({
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
        left: Math.min(window.innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2)),
        width,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    if (fitViewport) {
      window.visualViewport?.addEventListener('resize', updatePosition);
      window.visualViewport?.addEventListener('scroll', updatePosition);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      if (fitViewport) {
        window.visualViewport?.removeEventListener('resize', updatePosition);
        window.visualViewport?.removeEventListener('scroll', updatePosition);
      }
    };
  }, [isOpen, variant, fitViewport]);

  const panel = <span className={`help-tip-panel${variant === 'toolbar' ? ' help-tip-panel--toolbar' : ''}`} id={panelId} role="note"
    style={variant === 'toolbar' ? toolbarStyle : undefined} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <strong>{content.title}</strong>
    <span>{content.body}</span>
  </span>;

  return <span className={`help-tip help-tip--${variant}`}>
    <button ref={buttonRef} className={`help-tip-button${variant === 'toolbar' ? ' help-tip-button--toolbar' : ''}`} type="button"
      aria-label={`${content.title}のヘルプを${isOpen ? '閉じる' : '表示'}`} aria-expanded={isOpen} aria-controls={panelId}
      onClick={(event) => {
        if (variant === 'toolbar') event.stopPropagation();
        const nextOpen = !isOpen;
        if (open === undefined) setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      onPointerDown={(event) => { if (variant === 'toolbar') event.stopPropagation(); }}>
      <span aria-hidden="true">?</span>
    </button>
    {isOpen && (variant === 'toolbar' ? createPortal(panel, document.body) : panel)}
  </span>;
}
