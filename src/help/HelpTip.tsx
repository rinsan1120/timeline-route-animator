import { useId, useState } from 'react';
import { HELP_CONTENT, type HelpKey } from './helpContent';

interface HelpTipProps {
  helpKey: HelpKey;
}

export default function HelpTip({ helpKey }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const content = HELP_CONTENT[helpKey];
  return <span className="help-tip">
    <button className="help-tip-button" type="button" aria-label={`${content.title}のヘルプを${open ? '閉じる' : '表示'}`}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
      <span aria-hidden="true">?</span>
    </button>
    {open && <span className="help-tip-panel" id={panelId} role="note">
      <strong>{content.title}</strong>
      <span>{content.body}</span>
    </span>}
  </span>;
}
