import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Marker, type Map } from 'maplibre-gl';
import HelpTip from '../help/HelpTip';
import { parseCoordinateInput, searchOpenPoi, type PlaceSearchItem, type ReferencePosition, type SearchKind } from './openPoiSearch';

const ITEM_LABELS = { facility: '施設', place: '地域', category: 'カテゴリ', brand: 'ブランド' };

export default function CoordinateJumpControl({ map, hostId, disabled, hidden, onError }: {
  map: Map | null; hostId: string; disabled: boolean; hidden?: boolean; onError: (message: string) => void;
}) {
  const [input, setInput] = useState('');
  const [position, setPosition] = useState<ReferencePosition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<PlaceSearchItem[]>([]);
  const [searchKind, setSearchKind] = useState<SearchKind>('suggest');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [suggestEnabled, setSuggestEnabled] = useState(false);
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const cancelSearch = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);
  const runSearch = useCallback(async (query: string, kind: SearchKind) => {
    cancelSearch();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setSearchKind(kind); setItems([]); setSearchStatus('loading');
    try {
      const results = await searchOpenPoi(query, kind, controller.signal);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setItems(results); setSearchStatus('ready');
    } catch {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setSearchStatus('error');
    } finally {
      if (generation === generationRef.current) requestRef.current = null;
    }
  }, [cancelSearch]);
  useEffect(() => {
    const query = input.trim();
    if (!suggestEnabled || composing || disabled || hidden || !map || [...query].length < 3 || parseCoordinateInput(query).isCoordinate) return;
    const timer = setTimeout(() => { debounceRef.current = null; void runSearch(query, 'suggest'); }, 300);
    debounceRef.current = timer;
    return () => { clearTimeout(timer); if (debounceRef.current === timer) debounceRef.current = null; };
  }, [input, suggestEnabled, composing, disabled, hidden, map, runSearch]);
  useEffect(() => {
    if (disabled || hidden) { cancelSearch(); setSuggestEnabled(false); setItems([]); setSearchStatus('idle'); }
  }, [disabled, hidden, cancelSearch]);
  useEffect(() => cancelSearch, [cancelSearch]);

  const moveToPosition = (next: ReferencePosition) => {
    if (disabled || hidden || !map) return;
    setPosition(next); inputRef.current?.blur();
    map.jumpTo({ center: [next.longitude, next.latitude], zoom: Math.max(15, map.getZoom()) });
  };
  const submitSearch = (query = input.trim()) => {
    if (disabled || hidden || !map || composingRef.current) return;
    cancelSearch(); setSuggestEnabled(false); setItems([]); setSearchStatus('idle');
    if (!query) return;
    const coordinates = parseCoordinateInput(query);
    if (coordinates.isCoordinate) {
      if (!coordinates.position) { onError('緯度, 経度の形式で入力してください。緯度は−90〜90、経度は−180〜180です。'); return; }
      onError(''); moveToPosition(coordinates.position);
    } else void runSearch(query, 'search');
  };
  const selectItem = (item: PlaceSearchItem) => {
    if (disabled || hidden || !map) return;
    cancelSearch(); setSuggestEnabled(false); setItems([]); setSearchStatus('idle');
    if (item.type === 'category' || item.type === 'brand') {
      setInput(item.query); void runSearch(item.query, 'search');
    } else if (item.type === 'facility') moveToPosition(item.position);
    else if (item.type === 'place') {
      if (item.bounds) {
        setPosition(null); inputRef.current?.blur();
        map.fitBounds(item.bounds, { padding: 40, maxZoom: 15, duration: 0 });
      } else if (item.center) moveToPosition({ longitude: item.center[0], latitude: item.center[1] });
    }
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
      submitSearch();
    }}>
      <input ref={inputRef} aria-label="参考位置の緯度, 経度" placeholder="施設名・地名 / 緯度, 経度" value={input} disabled={disabled}
        onChange={(event) => { cancelSearch(); setInput(event.target.value); setSuggestEnabled(true); setItems([]); setSearchStatus('idle'); }}
        onCompositionStart={() => { composingRef.current = true; setComposing(true); cancelSearch(); setItems([]); setSearchStatus('idle'); }}
        onCompositionEnd={(event) => { composingRef.current = false; setComposing(false); setInput(event.currentTarget.value); setSuggestEnabled(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!composingRef.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submitSearch();
          } else if (event.key === 'Escape') { cancelSearch(); setSuggestEnabled(false); setItems([]); setSearchStatus('idle'); }
        }} enterKeyHint="search" autoComplete="off" spellCheck={false} />
      <button type="submit" disabled={disabled || !map}>検索</button><HelpTip helpKey="coordinateJump" />
    </form>
    {searchStatus !== 'idle' && <div className="coordinate-search-panel" aria-busy={searchStatus === 'loading'}>
      {searchKind === 'search' && <strong className="coordinate-search-heading">検索結果</strong>}
      <div role="status" className="coordinate-search-message">
        {searchStatus === 'loading' ? '検索中…' : searchStatus === 'error' ? '場所を検索できませんでした'
          : !items.length ? (searchKind === 'search' ? '検索結果が見つかりませんでした' : '候補が見つかりませんでした') : ''}
      </div>
      {!!items.length && <ul className="coordinate-search-list" aria-label={searchKind === 'search' ? '場所の検索結果' : '場所の入力候補'}>
        {items.map((item, index) => <li key={`${item.type}-${index}`}><button type="button" disabled={disabled || !map} onClick={() => selectItem(item)}>
          <span className="coordinate-search-name">{item.label}</span><span className="coordinate-search-type">{ITEM_LABELS[item.type]}</span>
          {item.address && <span className="coordinate-search-address">{item.address}</span>}
        </button></li>)}
      </ul>}
    </div>}
    <div className="coordinate-search-attribution">検索データ：<a href="https://openpoiapi.com/attribution.html" target="_blank" rel="noreferrer">OpenPOI API</a></div>
    {position && <div className="coordinate-jump-status" role="status">参考位置を表示中 <button type="button" aria-label="参考位置を消す" disabled={disabled} onClick={() => setPosition(null)}>消す</button></div>}
  </div>, host);
}
