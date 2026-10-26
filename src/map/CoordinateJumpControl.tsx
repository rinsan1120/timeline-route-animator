import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Marker, type Map } from 'maplibre-gl';
import HelpTip from '../help/HelpTip';
import { parseCoordinateInput, type ReferencePosition } from './coordinateInput';

export default function CoordinateJumpControl({ map, hostId, disabled, hidden, onError }: {
  map: Map | null; hostId: string; disabled: boolean; hidden?: boolean; onError: (message: string) => void;
}) {
  const [input, setInput] = useState('');
  const [position, setPosition] = useState<ReferencePosition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

  const moveToPosition = (next: ReferencePosition) => {
    if (disabled || hidden || !map) return;
    setPosition(next); inputRef.current?.blur();
    map.jumpTo({ center: [next.longitude, next.latitude], zoom: Math.max(15, map.getZoom()) });
  };
  const submitCoordinates = () => {
    if (disabled || hidden || !map || composingRef.current) return;
    const query = input.trim();
    if (!query) return;
    const position = parseCoordinateInput(query);
    if (!position) { onError('緯度, 経度の形式で入力してください。緯度は−90〜90、経度は−180〜180です。'); return; }
    onError(''); moveToPosition(position);
  };
  useEffect(() => {
    if (!map || !position || hidden) return;
    const element = document.createElement('div');
    element.className = 'reference-position-marker';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', '参考位置');
    // Consume gestures on the reference marker, including synthetic touch clicks.
    for (const name of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu']) {
      element.addEventListener(name, (event) => { event.stopPropagation(); event.preventDefault(); }, { passive: false });
    }
    const marker = new Marker({ element, draggable: false }).setLngLat([position.longitude, position.latitude]).addTo(map);
    return () => { marker.remove(); };
  }, [map, position, hidden]);
  const host = document.getElementById(hostId);
  if (!host) return null;
  return createPortal(<div className="coordinate-jump-control" hidden={hidden}>
    <form className="coordinate-jump-row" onSubmit={(event) => {
      event.preventDefault();
      submitCoordinates();
    }}>
      <input ref={inputRef} aria-label="参考位置の緯度, 経度" placeholder="緯度, 経度" value={input} disabled={disabled}
        onChange={(event) => setInput(event.target.value)}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(event) => { composingRef.current = false; setInput(event.currentTarget.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!composingRef.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submitCoordinates();
          }
        }} enterKeyHint="go" autoComplete="off" spellCheck={false} />
      <button type="submit" disabled={disabled || !map}>移動</button><HelpTip helpKey="coordinateJump" />
    </form>
    {position && <div className="coordinate-jump-status" role="status">参考位置を表示中 <button type="button" aria-label="参考位置を消す" disabled={disabled} onClick={() => setPosition(null)}>消す</button></div>}
  </div>, host);
}
