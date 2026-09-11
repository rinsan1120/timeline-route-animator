import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP_CONTENT, type HelpKey } from './helpContent';

interface HelpTipProps {
  helpKey: HelpKey;
  variant?: 'inline' | 'toolbar';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function HelpTip({ helpKey, variant = 'inline', open, onOpenChange }: HelpTipProps) {
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
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, variant]);

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
