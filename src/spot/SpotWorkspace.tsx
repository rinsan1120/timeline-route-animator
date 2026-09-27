import { useEffect, useReducer, useState } from 'react';
import { emptyHistory, historyReducer } from '../route/history';
import { appendPlanPoint, deletePoint, movePoint } from '../route/editor';
import { DEFAULT_ANNOTATION_STYLE } from '../route/annotationStyle';
import { saveBlobWithPicker, saveErrorMessage } from '../files/saveBlob';
import HelpTip from '../help/HelpTip';
import SpotMap, { type SpotTool } from './SpotMap';
import { spotsInBounds, type ImageBounds } from './imageBounds';
import { renderSpotImage } from './renderSpotImage';
import type { RoutePoint } from '../timeline/types';

export default function SpotWorkspace({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<SpotTool>('add');
  const [bounds, setBounds] = useState<ImageBounds | null>(null);
  const [style, setStyle] = useState(DEFAULT_ANNOTATION_STYLE);
  const [label, setLabel] = useState('');
  const [fitRequest, setFitRequest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const points = history.present;
  const selected = points.find((point) => point.id === selectedId);
  const targetCount = bounds ? spotsInBounds(points, bounds).length : 0;
  useEffect(() => { setLabel(selected?.annotation?.label ?? ''); }, [selected?.id, selected?.annotation?.label]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy]);
  const commit = (next: RoutePoint[]) => { dispatch({ type: 'commit', points: next }); setNotice(''); };
  const save = async () => {
    if (!bounds || !targetCount || busy) return;
    setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      // Open the picker in the click gesture; render only after the destination is chosen.
      const name = await saveBlobWithPicker(() => renderSpotImage(points, bounds, style),
        { suggestedName: 'spot-map.png', mimeType: 'image/png', extension: '.png' });
      if (name) setNotice(`PNGを保存しました（${name}）。`);
    } catch (reason) {
      const message = reason instanceof Error && /^(指定|画像|地図|バルーン)/.test(reason.message) ? reason.message : 'PNGを保存できませんでした。もう一度お試しください。';
      setError(saveErrorMessage(reason, message));
    } finally { setBusy(false); onBusy(false); }
  };
  return <div className="workspace spot-workspace">
    <aside className="control-panel">
      <section className="panel-section">
        <div className="section-heading"><span className="step">01</span><div><h2>スポットを設定</h2><p>{points.length}件のスポット</p></div></div>
        <div className="control-label-with-help"><p className="range-note">「連続追加」で地図をクリック／タップ。「選択」で地点やバルーンをドラッグできます。</p><HelpTip helpKey="spotWorkspace" /></div>
        <label>選択中のスポット<select value={selected?.id ?? ''} disabled={busy} onChange={(event) => { setSelectedId(event.target.value || null); setTool('select'); }}>
          <option value="">スポットを選択</option>{points.map((point, index) => <option key={point.id} value={point.id}>{point.annotation?.label || `スポット ${index + 1}`}</option>)}
        </select></label>
        {selected && <div className="annotation-editor">
          <label htmlFor="spot-label">地点ラベル（最大30文字）</label>
          <input id="spot-label" value={label} maxLength={30} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
          <button disabled={busy || !label.trim()} onClick={() => commit(points.map((point) => point.id === selected.id ? { ...point, annotation: { ...point.annotation, label: label.trim() } } : point))}>バルーンを設定</button>
          <button disabled={busy || !selected.annotation} onClick={() => commit(points.map((point) => point.id === selected.id ? { ...point, annotation: undefined } : point))}>バルーンを削除</button>
        </div>}
      </section>
      <section className="panel-section">
        <div className="section-heading"><span className="step">02</span><div><h2>画像範囲</h2><p>{bounds ? `範囲設定済み・対象 ${targetCount}件` : '画像範囲は未指定です'}</p></div></div>
        <div className="control-label-with-help"><button disabled={busy} onClick={() => { setTool('bounds'); setError(''); }}>{bounds ? '範囲を再指定' : '画像範囲を指定'}</button><HelpTip helpKey="spotBounds" /></div>
        {bounds && <button disabled={busy} onClick={() => { setBounds(null); setTool('select'); setNotice(''); }}>範囲を解除</button>}
        {bounds && !targetCount && <p className="range-note">指定範囲内にスポットがありません。</p>}
      </section>
      <section className="panel-section">
        <div className="section-heading"><span className="step">03</span><div><h2>画像設定</h2><p>PNG · 1920 × 1080</p></div></div>
        <div className="annotation-style-controls">{(['balloonScale', 'fontScale'] as const).map((key) => <div className="annotation-style-item" key={key}>
          <div className="control-label-with-help"><label htmlFor={`spot-${key}`}>{key === 'balloonScale' ? 'バルーンサイズ' : '文字サイズ'} <span className="annotation-style-value">{Math.round(style[key] * 100)}%</span></label><HelpTip helpKey={key === 'balloonScale' ? 'balloonScale' : 'balloonFontScale'} /></div>
          <input id={`spot-${key}`} type="range" min="50" max="200" step="10" value={style[key] * 100} disabled={busy} onChange={(event) => setStyle((current) => ({ ...current, [key]: Number(event.target.value) / 100 }))} />
        </div>)}</div>
        <button disabled={!bounds || busy} onClick={() => setFitRequest((value) => value + 1)}>指定範囲に合わせる</button>
        <div className="control-label-with-help"><button className="generate-button" disabled={!bounds || !targetCount || busy} onClick={() => void save()}>{busy ? 'PNGを準備しています…' : 'PNGを保存'}</button><HelpTip helpKey="spotExport" /></div>
      </section>
    </aside>
    <section className="map-stage">
      <SpotMap points={points} selectedId={selectedId} tool={tool} busy={busy} bounds={bounds} fitRequest={fitRequest} annotationStyle={style}
        onSelect={setSelectedId} onAdd={(latitude, longitude) => {
          const next = appendPlanPoint(points, latitude, longitude); commit(next); setSelectedId(next.at(-1)!.id);
        }} onMove={(id, latitude, longitude) => { commit(movePoint(points, id, latitude, longitude)); setSelectedId(id); }}
        onPlacement={(id, placement) => commit(points.map((point) => point.id === id && point.annotation ? { ...point, annotation: { ...point.annotation, placement } } : point))}
        onBounds={(value) => { setBounds(value); setTool('select'); setError(''); setNotice(''); }} onError={setError} />
      {(error || notice) && <div className={`toast${error ? ' toast--error' : ''}`} role={error ? 'alert' : 'status'}><p>{error || notice}</p><button aria-label="閉じる" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
      <div className="spot-tool-hint">{tool === 'bounds' ? 'ドラッグして16:9の画像範囲を指定' : tool === 'add' ? '地図をクリック／タップしてスポットを追加' : '地点・バルーン・オレンジの範囲をドラッグして移動'}</div>
      <nav className="edit-toolbar" aria-label="スポット編集ツール">
        <button className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'} disabled={busy} onClick={() => setTool('select')}>選択</button>
        <button className={tool === 'add' ? 'active' : ''} aria-pressed={tool === 'add'} disabled={busy} onClick={() => setTool('add')}>連続追加</button>
        <button className={tool === 'bounds' ? 'active' : ''} aria-pressed={tool === 'bounds'} disabled={busy} onClick={() => setTool('bounds')}>画像範囲</button>
        <button disabled={busy || !selected} onClick={() => { commit(deletePoint(points, selectedId!)); setSelectedId(null); }}>削除</button>
        <button disabled={busy || !history.past.length} onClick={() => dispatch({ type: 'undo' })}>元に戻す</button>
        <button disabled={busy || !history.future.length} onClick={() => dispatch({ type: 'redo' })}>やり直す</button>
        <button disabled={busy || (!points.length && !bounds)} onClick={() => { dispatch({ type: 'reset' }); setSelectedId(null); setBounds(null); setTool('add'); setError(''); setNotice(''); }}>初期状態</button>
      </nav>
    </section>
  </div>;
}
