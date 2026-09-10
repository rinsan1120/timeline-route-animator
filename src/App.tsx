import type { PopupPlacement, EndpointMarkerPlacements, EndpointMarkerLabel } from './popup/placement';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import RouteMap from './map/RouteMap';
import { downloadPlanFile, parsePlanFile, PLAN_FILE_ERROR } from './plan/planFile';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from './route/annotationStyle';
import type { RouteMarkerMode } from './route/routeMarker';
import { addPoint, appendPlanPoint, deletePoint, movePoint } from './route/editor';
import { formatDistance } from './route/geometry';
import { emptyHistory, historyReducer } from './route/history';
import { deriveDayMarkers, derivePlanDayMarkers, planRouteDistances, tripRouteDistance } from './route/tripRoute';
import type { RawPosition, WorkerResponse } from './timeline/types';
import { readTimelineFile } from './timeline/fileLoader';
import { buildFollowCameraPlan, type FollowCameraPlan, type FollowZoomPreset, type VideoCameraMode } from './video/followCamera';
import { INTRO_ZOOM_DURATION_SECONDS } from './video/introZoom';
import type { ViewportSize } from './video/overviewCamera';
import { outputVideoDuration, outputVideoFrameCount, renderRouteVideo, type VideoProgress } from './video/renderer';

type MapMode = 'display' | 'edit' | 'animation-range';
type WorkspaceMode = 'timeline' | 'plan';

export default function App() {
  const [dayMarkerPlacements, setDayMarkerPlacements] = useState<Record<string, PopupPlacement>>({});
  const [endpointMarkerPlacements, setEndpointMarkerPlacements] = useState<EndpointMarkerPlacements>({});
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('timeline');
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mapViewportRef = useRef<ViewportSize | null>(null);
  const routeLoadedNoticeTimerRef = useRef<number | null>(null);
  const previewEndTimerRef = useRef<number | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const minAvailableDate = dates.at(-1) ?? '';
  const maxAvailableDate = dates[0] ?? '';
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [from, setFrom] = useState('00:00');
  const [to, setTo] = useState('23:59');
  const [fileName, setFileName] = useState('');
  const [rawPositions, setRawPositions] = useState<RawPosition[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [selectedRaw, setSelectedRaw] = useState<RawPosition | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectionCandidateIds, setSelectionCandidateIds] = useState<string[]>([]);
  const [annotationLabel, setAnnotationLabel] = useState('');
  const [dayMarkerNotes, setDayMarkerNotes] = useState<Record<string, string>>({});
  const [planDayStarts, setPlanDayStarts] = useState<string[]>([]);
  const [planDayNotes, setPlanDayNotes] = useState<Record<string, string>>({});
  const [dayMarkerNoteInput, setDayMarkerNoteInput] = useState('');
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const [mapMode, setMapMode] = useState<MapMode>('display');
  const [addMode, setAddMode] = useState(false);
  const [rangeDeleteMode, setRangeDeleteMode] = useState(false);
  const [rangeDeletePointIds, setRangeDeletePointIds] = useState<string[]>([]);
  const [animationStartPointId, setAnimationStartPointId] = useState<string | null>(null);
  const [animationEndPointId, setAnimationEndPointId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(10);
  const [durationInput, setDurationInput] = useState('10');
  const [cameraMode, setCameraMode] = useState<VideoCameraMode>('overview');
  const [followZoomPreset, setFollowZoomPreset] = useState<FollowZoomPreset>('standard');
  const [overviewZoomMode, setOverviewZoomMode] = useState<'auto' | 'custom'>('auto');
  const [overviewCustomZoom, setOverviewCustomZoom] = useState(10);
  const [overviewCustomZoomInput, setOverviewCustomZoomInput] = useState('10.0');
  const [followCustomZoom, setFollowCustomZoom] = useState(10);
  const [followCustomZoomInput, setFollowCustomZoomInput] = useState('10.0');
  const [introZoomEnabled, setIntroZoomEnabled] = useState(true);
  const [routeMarkerMode, setRouteMarkerMode] = useState<RouteMarkerMode>('day');
  const [followCameraPlan, setFollowCameraPlan] = useState<FollowCameraPlan | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState('');

  const points = history.present;
  const editMode = mapMode === 'edit';
  const animationRangeMode = mapMode === 'animation-range';
  const selectedPoint = points.find((point) => point.id === selectedPointId) ?? null;
  const selectedPointIndex = selectedPointId ? points.findIndex((point) => point.id === selectedPointId) : -1;
  const selectionCandidateIndex = selectedPointId ? selectionCandidateIds.indexOf(selectedPointId) : -1;
  const showSelectionCandidateSwitcher = editMode && !addMode && !rangeDeleteMode && previewProgress === null
    && selectionCandidateIds.length >= 2 && selectionCandidateIndex >= 0;
  const dayMarkers = useMemo(() => (workspaceMode === 'plan'
    ? derivePlanDayMarkers(points, planDayStarts, planDayNotes)
    : deriveDayMarkers(points, dayMarkerNotes, startDate)).map((marker) => ({ ...marker, placement: dayMarkerPlacements[workspaceMode === 'plan' ? marker.pointId : marker.date!] })), [dayMarkerPlacements, workspaceMode, points, planDayStarts, planDayNotes, dayMarkerNotes, startDate]);
  const selectedDayMarker = dayMarkers.find((marker) => marker.pointId === selectedPointId) ?? null;
  const selectedPlanDayNumber = useMemo(() => {
    if (workspaceMode !== 'plan' || !selectedPointId) return null;
    const selectedIndex = points.findIndex((point) => point.id === selectedPointId);
    const starts = new Set(dayMarkers.map((marker) => marker.pointId));
    return 1 + points.slice(0, selectedIndex).filter((point) => starts.has(point.id)).length;
  }, [workspaceMode, selectedPointId, points, dayMarkers]);
  useEffect(() => {
    setAnnotationLabel(selectedPoint?.annotation?.label ?? '');
  }, [selectedPoint?.id, selectedPoint?.annotation?.label]);
  useEffect(() => {
    setDayMarkerNoteInput(workspaceMode === 'plan'
      ? (selectedDayMarker ? planDayNotes[selectedDayMarker.pointId] ?? '' : '')
      : (selectedDayMarker?.date ? dayMarkerNotes[selectedDayMarker.date] ?? '' : ''));
  }, [workspaceMode, selectedDayMarker?.pointId, selectedDayMarker?.date, dayMarkerNotes, planDayNotes]);

  const selectAdjacentCandidate = (offset: -1 | 1) => {
    if (!selectionCandidateIds.length || selectionCandidateIndex < 0) return;
    const nextIndex = (selectionCandidateIndex + offset + selectionCandidateIds.length) % selectionCandidateIds.length;
    setSelectedPointId(selectionCandidateIds[nextIndex]);
    setSelectedRaw(null);
  };

  const setAnnotationPlacement = (id: string, placement?: PopupPlacement) => {
    dispatch({ type: 'commit', points: points.map((point) => {
      if (point.id !== id || !point.annotation) return point;
      const { placement: previous, ...annotation } = point.annotation;
      return { ...point, annotation: { ...annotation, ...(placement ? { placement } : {}) } };
    }) });
    setSelectedPointId(id);
  };
  const setDayPlacement = (id: string, placement?: PopupPlacement) => {
    const marker = dayMarkers.find((item) => item.pointId === id);
    const key = workspaceMode === 'plan' ? id : marker?.date;
    if (!key) return;
    setDayMarkerPlacements((current) => {
      const next = { ...current };
      if (placement) next[key] = placement;
      else delete next[key];
      return next;
    });
    setSelectedPointId(id);
  };
  const setEndpointPlacement = (label: EndpointMarkerLabel, placement?: PopupPlacement) => {
    setEndpointMarkerPlacements((current) => {
      const next = { ...current };
      if (placement) next[label] = placement;
      else delete next[label];
      return next;
    });
    setSelectedPointId((label === 'START' ? animationPoints[0] : animationPoints.at(-1))?.id ?? null);
  };

  const saveAnnotation = () => {
    if (!selectedPoint) return;
    const label = annotationLabel.trim();
    if (!label || Array.from(label).length > 30) {
      setError('地点ラベルは1〜30文字で入力してください。');
      return;
    }
    if (selectedPoint.annotation?.label !== label) {
      dispatch({ type: 'commit', points: points.map((point) => point.id === selectedPoint.id ? { ...point, annotation: { ...point.annotation, label } } : point) });
    }
    setAnnotationLabel(label);
    setError('');
  };

  const removeAnnotation = () => {
    if (!selectedPoint?.annotation) return;
    dispatch({ type: 'commit', points: points.map((point) => {
      if (point.id !== selectedPoint.id) return point;
      const { annotation, ...rest } = point;
      return rest;
    }) });
    setError('');
  };

  const saveDayMarkerNote = () => {
    if (!selectedDayMarker) return;
    const note = dayMarkerNoteInput.trim();
    if (!note || Array.from(note).length > 40) {
      setError(workspaceMode === 'plan' ? 'DAYマーカーの補足は1〜40文字で入力してください。' : '日付マーカーの補足は1〜40文字で入力してください。');
      return;
    }
    const key = workspaceMode === 'plan' ? selectedDayMarker.pointId : selectedDayMarker.date;
    if (!key) return;
    const setNotes = workspaceMode === 'plan' ? setPlanDayNotes : setDayMarkerNotes;
    setNotes((current) => ({ ...current, [key]: note }));
    setDayMarkerNoteInput(note);
    setError('');
  };

  const removeDayMarkerNote = () => {
    if (!selectedDayMarker) return;
    const key = workspaceMode === 'plan' ? selectedDayMarker.pointId : selectedDayMarker.date;
    if (!key) return;
    const setNotes = workspaceMode === 'plan' ? setPlanDayNotes : setDayMarkerNotes;
    setNotes((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDayMarkerNoteInput('');
    setError('');
  };

  const planDistances = useMemo(() => workspaceMode === 'plan'
    ? planRouteDistances(points, planDayStarts) : null, [workspaceMode, points, planDayStarts]);
  const distance = useMemo(() => planDistances?.totalMeters ?? tripRouteDistance(points), [points, planDistances]);
  const animationPoints = useMemo(() => {
    if (points.length < 2) return points;
    const startIndex = animationStartPointId ? points.findIndex((point) => point.id === animationStartPointId) : 0;
    const endIndex = animationEndPointId ? points.findIndex((point) => point.id === animationEndPointId) : points.length - 1;
    return startIndex >= 0 && endIndex > startIndex ? points.slice(startIndex, endIndex + 1) : points;
  }, [points, animationStartPointId, animationEndPointId]);

  const extract = useCallback(() => {
    setError('');
    setBusy(true);
    workerRef.current?.postMessage({ type: 'extract-range', startDate, endDate, from, to });
  }, [startDate, endDate, from, to]);

  useEffect(() => {
    const worker = new Worker(new URL('./timeline/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'error') {
        setError(message.message);
        setBusy(false);
      } else if (message.type === 'loaded') {
        setDayMarkerPlacements({});
        setEndpointMarkerPlacements({});
        setWorkspaceMode('timeline');
        setPlanDayStarts([]);
        setPlanDayNotes({});
        setDates(message.dates);
        setStartDate(message.dates[0]);
        setEndDate(message.dates[0]);
        setDayMarkerNotes({});
        setFileName(message.fileName);
        setNotice(`${message.dates.length}日分の日付を検出しました。`);
        worker.postMessage({ type: 'extract', date: message.dates[0], from: '00:00', to: '23:59' });
      } else {
        setWorkspaceMode('timeline');
        setPlanDayStarts([]);
        setPlanDayNotes({});
        dispatch({ type: 'load', points: message.routePoints });
        setRawPositions(message.rawPositions);
        setSelectedPointId(null);
        setSelectionCandidateIds([]);
        setSelectedRaw(null);
        setRangeDeletePointIds([]);
        setAnimationStartPointId(null);
        setAnimationEndPointId(null);
        setBusy(false);
        if (message.routePoints.length) {
          if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
          const routeLoadedNotice = `${message.routePoints.length}点のルートを読み込みました。`;
          setNotice(routeLoadedNotice);
          routeLoadedNoticeTimerRef.current = window.setTimeout(() => {
            setNotice((current) => current === routeLoadedNotice ? '' : current);
            routeLoadedNoticeTimerRef.current = null;
          }, 5000);
        } else {
          setNotice('指定時間内にtimelinePathがありません。時間範囲を変更してください。');
        }
      }
    };
    worker.onerror = () => { setError('Worker処理に失敗しました。'); setBusy(false); };
    return () => {
      worker.terminate();
      if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (previewProgress === null) return;
    const previewDuration = duration + (introZoomEnabled ? INTRO_ZOOM_DURATION_SECONDS : 0);
    const startedAt = performance.now() - previewProgress * previewDuration * 1000;
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / (previewDuration * 1000));
      setPreviewProgress(progress);
      if (progress < 1) frame = requestAnimationFrame(animate);
      else previewEndTimerRef.current = window.setTimeout(() => {
        previewEndTimerRef.current = null;
        setPreviewProgress(null);
      }, 350);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      if (previewEndTimerRef.current !== null) window.clearTimeout(previewEndTimerRef.current);
      previewEndTimerRef.current = null;
    };
  }, [previewProgress === null, duration, introZoomEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      setRangeDeletePointIds([]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  useEffect(() => {
    setRangeDeletePointIds([]);
    setSelectionCandidateIds([]);
  }, [points]);

  useEffect(() => {
    if (!editMode || addMode || rangeDeleteMode) setSelectionCandidateIds([]);
  }, [editMode, addMode, rangeDeleteMode]);

  useEffect(() => {
    if (editMode) return;
    setAddMode(false);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  }, [editMode]);

  useEffect(() => {
    const startMissing = animationStartPointId && !points.some((point) => point.id === animationStartPointId);
    const endMissing = animationEndPointId && !points.some((point) => point.id === animationEndPointId);
    if (startMissing || endMissing) {
      setAnimationStartPointId(null);
      setAnimationEndPointId(null);
      setNotice('指定したポイントが削除されたため、アニメ範囲を全ルートへ戻しました。');
    }
  }, [points, animationStartPointId, animationEndPointId]);

  const loadFile = async (file: File) => {
    setBusy(true);
    setError('');
    setNotice('JSONを端末内で解析しています…');
    setSelectionCandidateIds([]);
    try {
      const buffer = await readTimelineFile(file);
      const worker = workerRef.current;
      if (!worker) throw new Error('Worker処理に失敗しました。');
      console.info('[Timeline] sending buffer to Worker', { byteLength: buffer.byteLength });
      worker.postMessage({ type: 'load', buffer, fileName: file.name }, [buffer]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ファイル内容を読み取れませんでした。');
      setBusy(false);
    }
  };

  const startPlanMode = () => {
    if (workspaceMode === 'plan' || busy || videoProgress) return;
    setWorkspaceMode('plan');
    setDayMarkerPlacements({});
    setEndpointMarkerPlacements({});
    setPlanDayStarts([]);
    setPlanDayNotes({});
    dispatch({ type: 'load', points: [] });
    setDates([]);
    setStartDate('');
    setEndDate('');
    setFileName('');
    setRawPositions([]);
    setShowRaw(false);
    setSelectedRaw(null);
    setDayMarkerNotes({});
    setSelectedPointId(null);
    setSelectionCandidateIds([]);
    setAnnotationLabel('');
    setDayMarkerNoteInput('');
    setAnimationStartPointId(null);
    setAnimationEndPointId(null);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
    setMapMode('edit');
    setAddMode(true);
    setPreviewProgress(null);
    setFollowCameraPlan(null);
    setVideoUrl('');
    setError('');
    setNotice('');
    if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
    routeLoadedNoticeTimerRef.current = null;
  };

  const savePlan = () => {
    if (workspaceMode !== 'plan' || !points.length || busy) return;
    try {
      downloadPlanFile({ points, planDayStarts, planDayNotes, dayMarkerPlacements });
      setError('');
    } catch {
      setError('計画データを保存できませんでした。もう一度お試しください。');
    }
  };

  const loadPlan = async (file: File) => {
    if (workspaceMode !== 'plan' || busy || videoProgress || previewProgress !== null) return;
    setBusy(true);
    try {
      const saved = parsePlanFile(await file.text());
      // A video export may have started while the file was being read.
      if (abortRef.current) {
        setError('動画生成が終了してから、作業を再開してください。');
        return;
      }
      setWorkspaceMode('plan');
      dispatch({ type: 'load', points: saved.points });
      setPlanDayStarts(saved.planDayStarts);
      setPlanDayNotes(saved.planDayNotes);
      setDayMarkerPlacements(saved.dayMarkerPlacements);
      setEndpointMarkerPlacements({});
      setSelectedPointId(null);
      setSelectionCandidateIds([]);
      setSelectedRaw(null);
      setRangeDeletePointIds([]);
      setAnimationStartPointId(null);
      setAnimationEndPointId(null);
      setPreviewProgress(null);
      setFollowCameraPlan(null);
      setVideoUrl('');
      setAnnotationLabel('');
      setDayMarkerNoteInput('');
      setRangeDeleteMode(false);
      setAddMode(false);
      setMapMode('edit');
      setRawPositions([]);
      setShowRaw(false);
      setDayMarkerNotes({});
      setDates([]);
      setStartDate('');
      setEndDate('');
      setFileName('');
      setError('');
      if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
      routeLoadedNoticeTimerRef.current = null;
      setNotice('計画データを復元しました。編集を続けられます。');
    } catch {
      setError(PLAN_FILE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const commitAdd = (latitude: number, longitude: number) => {
    const next = workspaceMode === 'plan'
      ? appendPlanPoint(points, latitude, longitude)
      : addPoint(points, latitude, longitude);
    dispatch({ type: 'commit', points: next });
    setSelectedPointId(next.find((point) => !points.some((old) => old.id === point.id))?.id ?? null);
  };

  const selectEditTool = () => {
    setAddMode(false);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  };

  const toggleAddMode = () => {
    setAddMode((current) => !current);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  };

  const toggleRangeDeleteMode = () => {
    setAddMode(false);
    setRangeDeleteMode((current) => !current);
    setRangeDeletePointIds([]);
    setSelectedPointId(null);
    setSelectedRaw(null);
  };

  const commitRangeDelete = () => {
    if (!rangeDeletePointIds.length) return;
    const selectedIds = new Set(rangeDeletePointIds);
    dispatch({ type: 'commit', points: points.filter((point) => !selectedIds.has(point.id)) });
    setRangeDeletePointIds([]);
    setSelectedPointId(null);
    setSelectedRaw(null);
  };

  const setAnimationStart = () => {
    if (!selectedPointId) return;
    const selectedIndex = points.findIndex((point) => point.id === selectedPointId);
    const endIndex = animationEndPointId ? points.findIndex((point) => point.id === animationEndPointId) : points.length - 1;
    if (selectedIndex < 0 || selectedIndex >= endIndex) {
      setError('開始地点は終了地点より前のポイントを選択してください。');
      return;
    }
    setError('');
    setAnimationStartPointId(selectedPointId);
  };

  const setAnimationEnd = () => {
    if (!selectedPointId) return;
    const selectedIndex = points.findIndex((point) => point.id === selectedPointId);
    const startIndex = animationStartPointId ? points.findIndex((point) => point.id === animationStartPointId) : 0;
    if (selectedIndex <= startIndex) {
      setError('終了地点は開始地点より後のポイントを選択してください。');
      return;
    }
    setError('');
    setAnimationEndPointId(selectedPointId);
  };

  const resetAnimationRange = () => {
    setAnimationStartPointId(null);
    setAnimationEndPointId(null);
    setError('');
  };

  const startPreview = () => {
    if (cameraMode === 'follow') {
      setError('');
      try {
        setFollowCameraPlan(buildFollowCameraPlan(animationPoints, followZoomPreset, duration, followCustomZoom));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'ルート追従の準備に失敗しました。');
        return;
      }
    } else {
      setFollowCameraPlan(null);
    }
    setPreviewProgress(0);
  };

  const generateVideo = async () => {
    setError('');
    let plan: FollowCameraPlan | undefined;
    if (cameraMode === 'follow') {
      try {
        plan = buildFollowCameraPlan(animationPoints, followZoomPreset, duration, followCustomZoom);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'ルート追従の準備に失敗しました。');
        return;
      }
    }
    setVideoProgress({ current: 0, total: outputVideoFrameCount(duration), percent: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const blob = await renderRouteVideo({ points: animationPoints, dayMarkers, endpointMarkerPlacements, routeMarkerMode, duration, revealRoute: true, cameraMode, overviewZoomMode, overviewCustomZoom, overviewReferenceViewport: mapViewportRef.current ?? undefined, followZoomPreset, followCustomZoom, followCameraPlan: plan, introZoomEnabled, annotationStyle, signal: controller.signal, onProgress: setVideoProgress });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
      setNotice('MP4を生成しました。端末へ保存できます。');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setNotice('動画生成をキャンセルしました。');
      else setError(reason instanceof Error ? reason.message : '動画生成に失敗しました。');
    } finally {
      abortRef.current = null;
      setVideoProgress(null);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div className="brand-copy">
          <h1>Timeline Route Animator</h1>
          <p>移動の軌跡を、一本の映像へ。</p>
        </div>
        <div className="topbar-actions">
          <button className="file-button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <span>JSONを開く</span><small>端末内で処理</small>
          </button>
          <button className="file-button plan-button" onClick={startPlanMode} disabled={workspaceMode === 'plan' || busy || !!videoProgress}>
            <span>計画モード</span><small>地図から作成</small>
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.currentTarget.value = ''; }} />
      </header>

      <section className="privacy-note"><span>●</span> 位置履歴JSONは端末内でのみ処理され、外部へ送信されません</section>

      <div className="workspace">
        <aside className="control-panel">
          <section className="panel-section source-section">
            {workspaceMode === 'timeline' ? <>
            <div className="section-heading"><span className="step">01</span><div><h2>範囲を選ぶ</h2><p>{fileName || 'Timeline JSONを読み込んでください'}</p></div></div>
            <div className="date-grid">
              <label>開始日<input type="date" value={startDate} min={minAvailableDate} max={maxAvailableDate} disabled={!dates.length || busy} onChange={(event) => {
                const value = event.target.value;
                setStartDate(value);
                setEndDate(value);
              }} /></label>
              <label>終了日<input type="date" value={endDate} min={minAvailableDate} max={maxAvailableDate} disabled={!dates.length || busy} onChange={(event) => setEndDate(event.target.value)} /></label>
            </div>
            <div className="time-grid">
              <label>From<input type="time" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
              <span className="time-arrow">→</span>
              <label>To<input type="time" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            </div>
            <p className="range-note">※ 開始日のFromから、終了日のToまでを読み込みます。</p>
            <button className="secondary-button wide" disabled={!startDate || !endDate || busy} onClick={() => extract()}>この範囲を読み込む</button>
            </> : <>
              <div className="section-heading"><span className="step">01</span><div><h2>ルートを計画する</h2><p>地図をクリックした順にポイントを追加します</p></div></div>
              <p className="range-note">「編集」→「連続追加」で地点を追加できます。</p>
              <button className="secondary-button wide" disabled={!points.length || busy} onClick={savePlan}>作業を保存</button>
              <button className="secondary-button wide" disabled={busy || !!videoProgress || previewProgress !== null} onClick={() => planFileInputRef.current?.click()}>作業を再開</button>
              <input ref={planFileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void loadPlan(file);
              }} />
            </>}
          </section>

          <section className="panel-section">
            <div className="section-heading"><span className="step">02</span><div><h2>ルートを整える</h2><p>{points.length ? `${points.length} points · ${workspaceMode === 'plan' ? '約 ' : ''}${formatDistance(distance)}` : 'ルートは未選択です'}</p></div></div>
            <div className="mode-switch">
              <button className={mapMode === 'display' ? 'active' : ''} onClick={() => { setMapMode('display'); setAddMode(false); setRangeDeleteMode(false); setRangeDeletePointIds([]); }}>表示</button>
              <button className={editMode ? 'active' : ''} onClick={() => setMapMode('edit')}>編集</button>
              <button className={animationRangeMode ? 'active' : ''} onClick={() => { setMapMode('animation-range'); setAddMode(false); setRangeDeleteMode(false); setRangeDeletePointIds([]); }}>アニメ範囲</button>
            </div>
            {planDistances && <div className="detail-card">
              <strong>概算距離</strong>
              {planDistances.days.map((day) => <span key={day.pointId}>DAY {day.dayNumber}　約 {formatDistance(day.distanceMeters)}</span>)}
              <strong>合計　約 {formatDistance(planDistances.totalMeters)}</strong>
              <span>※ ポイント間の地表上の直線距離の合計です。道路に沿った走行距離ではありません。</span>
            </div>}
            {workspaceMode === 'timeline' && <label className="toggle-row"><span><strong>測位データを表示</strong><small>rawSignals（参考情報）</small></span><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} /><i /></label>}
            {selectedPoint && <div className="detail-card"><strong>選択中のルートポイント</strong><span>全{points.length}点中 {selectedPointIndex + 1}番目</span><span>{selectedPoint.source === 'manual' ? '手動追加' : 'timelinePath'}</span><code>{selectedPoint.latitude.toFixed(6)}, {selectedPoint.longitude.toFixed(6)}</code>{selectedPoint.timestamp && <time>{formatTimestamp(selectedPoint.timestamp)}</time>}
              {showSelectionCandidateSwitcher && <div className="selection-candidate-switcher">
                <button type="button" aria-label="前の候補" onClick={() => selectAdjacentCandidate(-1)}>‹</button>
                <span>候補 {selectionCandidateIndex + 1} / {selectionCandidateIds.length}</span>
                <button type="button" aria-label="次の候補" onClick={() => selectAdjacentCandidate(1)}>›</button>
              </div>}
              {editMode && <>
                {selectedPoint.annotation?.placement && <button className="secondary-button" onClick={() => setAnnotationPlacement(selectedPoint.id)}>バルーン位置をリセット</button>}
                {selectedDayMarker?.placement && <button className="secondary-button" onClick={() => setDayPlacement(selectedPoint.id)}>DAY位置をリセット</button>}
                {selectedPoint.id === animationPoints[0]?.id && endpointMarkerPlacements.START && <button className="secondary-button" onClick={() => setEndpointPlacement('START')}>START位置をリセット</button>}
                {selectedPoint.id === animationPoints.at(-1)?.id && endpointMarkerPlacements.GOAL && <button className="secondary-button" onClick={() => setEndpointPlacement('GOAL')}>GOAL位置をリセット</button>}
              </>}
              {editMode && <div className="annotation-editor">
                <label htmlFor="annotation-label">地点ラベル（最大30文字）</label>
                <input id="annotation-label" type="text" value={annotationLabel} onChange={(event) => setAnnotationLabel(event.currentTarget.value)} onKeyDown={(event) => {
                  // Text editing keeps its own Undo/Redo instead of changing route history.
                  event.stopPropagation();
                }} placeholder="美瑛・青い池" />
                <button className="secondary-button" disabled={!annotationLabel.trim() || Array.from(annotationLabel.trim()).length > 30} onClick={saveAnnotation}>{selectedPoint.annotation ? '変更' : 'バルーンを設定'}</button>
                {selectedPoint.annotation && <button className="secondary-button" onClick={removeAnnotation}>バルーンを削除</button>}
              </div>}
              {workspaceMode === 'plan' && editMode && <div className="day-marker-editor plan-day-editor">
                <strong>計画DAY</strong>
                {!selectedDayMarker && <button className="secondary-button" onClick={() => setPlanDayStarts((current) => [...new Set([...current, selectedPoint.id])])}>ここからDAY {selectedPlanDayNumber}</button>}
                {selectedDayMarker && selectedPoint.id !== points[0]?.id && <button className="secondary-button" onClick={() => setPlanDayStarts((current) => current.filter((id) => id !== selectedPoint.id))}>DAY {selectedDayMarker.dayNumber}設定を解除</button>}
              </div>}
              {editMode && (workspaceMode === 'plan' || routeMarkerMode === 'day') && selectedDayMarker && <div className="day-marker-editor">
                <strong>DAY {selectedDayMarker.dayNumber}{selectedDayMarker.date && ` · ${selectedDayMarker.date.replaceAll('-', '.')}`}</strong>
                <label htmlFor="day-marker-note">{workspaceMode === 'plan' ? 'DAY' : '日付'}マーカーの補足（最大40文字）</label>
                <input id="day-marker-note" type="text" value={dayMarkerNoteInput} onChange={(event) => setDayMarkerNoteInput(event.currentTarget.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="○○ホテル" />
                <button className="secondary-button" disabled={!dayMarkerNoteInput.trim() || Array.from(dayMarkerNoteInput.trim()).length > 40} onClick={saveDayMarkerNote}>{selectedDayMarker.note ? '変更' : '設定'}</button>
                {selectedDayMarker.note && <button className="secondary-button" onClick={removeDayMarkerNote}>削除</button>}
              </div>}
            </div>}
            {animationRangeMode && <div className="detail-card animation-range-card">
              <strong>アニメーション範囲</strong>
              <span>開始: {animationPoints[0] ? `${points.indexOf(animationPoints[0]) + 1}番目` : '未選択'}</span>
              <span>終了: {animationPoints.at(-1) ? `${points.indexOf(animationPoints.at(-1)!) + 1}番目` : '未選択'}</span>
              <div className="animation-range-actions">
                <button className="secondary-button" disabled={!selectedPoint} onClick={setAnimationStart}>ここを開始地点に設定</button>
                <button className="secondary-button" disabled={!selectedPoint} onClick={setAnimationEnd}>ここを終了地点に設定</button>
              </div>
              <button className="text-button" onClick={resetAnimationRange}>全ルートを使用</button>
            </div>}
            {workspaceMode === 'timeline' && selectedRaw && <RawDetail point={selectedRaw} onClose={() => setSelectedRaw(null)} />}
          </section>

          <section className="panel-section video-section">
            <div className="section-heading"><span className="step">03</span><div><h2>動画にする</h2><p>FHD · 30fps · MP4（H.264）</p></div></div>
            <div className="video-camera-controls">
              <label>表示モード</label>
              <div className="video-mode-options">
                <button className={cameraMode === 'overview' ? 'active' : ''} aria-pressed={cameraMode === 'overview'} disabled={previewProgress !== null || !!videoProgress} onClick={() => setCameraMode('overview')}>全体表示</button>
                <button className={cameraMode === 'follow' ? 'active' : ''} aria-pressed={cameraMode === 'follow'} disabled={previewProgress !== null || !!videoProgress} onClick={() => setCameraMode('follow')}>ルート追従</button>
              </div>
              {cameraMode === 'overview' && <>
                <label>表示範囲</label>
                <div className="video-mode-options">
                  {(['auto', 'custom'] as const).map((mode) => <button key={mode} className={overviewZoomMode === mode ? 'active' : ''} aria-pressed={overviewZoomMode === mode} disabled={previewProgress !== null || !!videoProgress} onClick={() => setOverviewZoomMode(mode)}>{mode === 'auto' ? '自動' : 'カスタム'}</button>)}
                </div>
              </>}
              {cameraMode === 'follow' && <>
                <label>表示範囲</label>
                <div className="follow-zoom-options">
                  {([['wide', '広め'], ['standard', '標準'], ['close', '寄り'], ['custom', 'カスタム']] as const).map(([preset, label]) => <button key={preset} className={followZoomPreset === preset ? 'active' : ''} aria-pressed={followZoomPreset === preset} disabled={previewProgress !== null || !!videoProgress} onClick={() => setFollowZoomPreset(preset)}>{label}</button>)}
                </div>
              </>}
              {((cameraMode === 'overview' && overviewZoomMode === 'custom') || (cameraMode === 'follow' && followZoomPreset === 'custom')) && <label className="custom-zoom-number">
                Zoom
                <input type="number" inputMode="decimal" min="4" max="16" step="0.1"
                  value={cameraMode === 'overview' ? overviewCustomZoomInput : followCustomZoomInput}
                  disabled={previewProgress !== null || !!videoProgress}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (cameraMode === 'overview') setOverviewCustomZoomInput(value);
                    else setFollowCustomZoomInput(value);
                  }}
                  onBlur={(event) => {
                    const input = event.currentTarget.value;
                    const previous = cameraMode === 'overview' ? overviewCustomZoom : followCustomZoom;
                    const zoom = input.trim() && Number.isFinite(Number(input))
                      ? Math.round(Math.min(16, Math.max(4, Number(input))) * 10) / 10 : previous;
                    if (cameraMode === 'overview') {
                      setOverviewCustomZoom(zoom);
                      setOverviewCustomZoomInput(zoom.toFixed(1));
                    } else {
                      setFollowCustomZoom(zoom);
                      setFollowCustomZoomInput(zoom.toFixed(1));
                    }
                  }}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
              </label>}
              <label>地点マーカー</label>
              <div className="route-marker-options">
                {([['day', 'DAY'], ['start-goal', 'START / GOAL'], ['none', 'なし']] as const).map(([mode, label]) => <button key={mode} className={routeMarkerMode === mode ? 'active' : ''} aria-pressed={routeMarkerMode === mode} disabled={previewProgress !== null || !!videoProgress} onClick={() => setRouteMarkerMode(mode)}>{label}</button>)}
              </div>
              <label className="toggle-row"><span><strong>開始時ズーム</strong><small>開始3秒で広域表示からズーム</small></span><input type="checkbox" checked={introZoomEnabled} disabled={previewProgress !== null || !!videoProgress} onChange={(event) => setIntroZoomEnabled(event.target.checked)} /><i /></label>
            </div>
            <div className="duration-controls">
              <label htmlFor="video-duration-range">移動時間</label>
              <input id="video-duration-range" type="range" min="5" max="120" step="1" value={duration} disabled={previewProgress !== null || !!videoProgress} onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setDuration(value);
                setDurationInput(String(value));
              }} />
              <div className="duration-limits"><span>5秒</span><span>120秒</span></div>
              <label className="duration-number" htmlFor="video-duration-number">
                <input id="video-duration-number" aria-label="移動時間（秒）" type="number" inputMode="numeric" min="5" max="120" step="1" value={durationInput} disabled={previewProgress !== null || !!videoProgress} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDurationInput(value);
                  if (value !== '' && Number.isFinite(Number(value))) setDuration(Math.min(120, Math.max(5, Math.round(Number(value)))));
                }} onBlur={() => setDurationInput(String(duration))} />
                秒
              </label>
              <div className="video-duration-note">
                <span>※ 出力動画は、移動時間に開始前3秒・到着後3秒が追加されます。</span>
                <span>出力時間: {outputVideoDuration(duration)}秒</span>
              </div>
            </div>
            <div className="annotation-style-controls">
              <h3>バルーン表示</h3>
              {(['balloonScale', 'fontScale'] as const).map((key) => <label key={key}>
                {key === 'balloonScale' ? 'バルーンサイズ' : '文字サイズ'} <span>{Math.round(annotationStyle[key] * 100)}%</span>
                <input type="range" min="50" max="200" step="10" value={Math.round(annotationStyle[key] * 100)} onChange={(event) => setAnnotationStyle((current) => ({ ...current, [key]: Number(event.target.value) / 100 }))} />
              </label>)}
            </div>
            <button className="preview-button" disabled={previewProgress === null && animationPoints.length < 2} onClick={previewProgress === null ? startPreview : () => setPreviewProgress(null)}>{previewProgress === null ? 'プレビュー' : '中止'}</button>
            <button className="generate-button" disabled={animationPoints.length < 2 || !!videoProgress} onClick={() => void generateVideo()}>MP4を生成 <span>→</span></button>
            {videoProgress && <div className="progress-card"><div><strong>動画生成中</strong><span>{videoProgress.current} / {videoProgress.total} frames</span></div><b>{videoProgress.percent}%</b><progress max="100" value={videoProgress.percent} /><button onClick={() => abortRef.current?.abort()}>キャンセル</button></div>}
            {videoUrl && <a className="download-button" href={videoUrl} download={`route-${startDate}${endDate !== startDate ? `-${endDate}` : ''}.mp4`}>MP4を保存</a>}
          </section>
        </aside>

        <section className="map-stage">
          <RouteMap endpointMarkerPlacements={endpointMarkerPlacements} onAnnotationPlacement={setAnnotationPlacement} onDayPlacement={setDayPlacement} onEndpointPlacement={setEndpointPlacement} overviewZoomMode={overviewZoomMode} overviewCustomZoom={overviewCustomZoom} onMapViewportChange={(viewport) => { mapViewportRef.current = viewport; }} autoFitRouteChanges={workspaceMode === 'timeline'} annotationStyle={annotationStyle} dayMarkers={dayMarkers} points={points} animationPoints={animationPoints} rawPositions={rawPositions} showRaw={showRaw} editMode={editMode} animationRangeMode={animationRangeMode} addMode={addMode} rangeDeleteMode={rangeDeleteMode} rangeDeletePointIds={rangeDeletePointIds} routeMarkerMode={routeMarkerMode} selectedPointId={selectedPointId} previewProgress={previewProgress} previewDuration={duration} introZoomEnabled={introZoomEnabled} revealRoute cameraMode={cameraMode} followCameraPlan={followCameraPlan} onSelectPoint={(id) => { setSelectedPointId(id); setSelectedRaw(null); }} onSelectionCandidates={setSelectionCandidateIds} onSelectRaw={(point) => { setSelectedRaw(point); setSelectedPointId(null); setSelectionCandidateIds([]); }} onAddPoint={commitAdd} onMovePoint={(id, latitude, longitude) => dispatch({ type: 'commit', points: movePoint(points, id, latitude, longitude) })} onRangeDeleteSelection={setRangeDeletePointIds} onError={setError} />
          {workspaceMode === 'timeline' && !points.length && <div className="empty-map"><div className="empty-route-icon">⌁</div><h2>Timeline JSONから旅を始めよう</h2><p>ファイルを読み込むか、地図上で新しいルートを計画できます。</p><div className="empty-map-actions"><button onClick={() => fileInputRef.current?.click()}>JSONを選択</button><button className="plan-button" onClick={startPlanMode} disabled={busy || !!videoProgress}>計画モード</button></div></div>}
          {busy && <div className="loading-overlay"><span className="spinner" />端末内で処理しています…</div>}
          {(error || notice) && <div className={`toast ${error ? 'toast--error' : ''}`} role="status"><span>{error ? '!' : '✓'}</span><p>{error || notice}</p><button aria-label="閉じる" onClick={() => { setError(''); setNotice(''); if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current); routeLoadedNoticeTimerRef.current = null; }}>×</button></div>}
          {editMode && <nav className="edit-toolbar" aria-label="ルート編集">
            <button className={!addMode && !rangeDeleteMode ? 'active' : ''} onClick={selectEditTool}><span>⌖</span>選択</button>
            <button className={addMode ? 'active' : ''} onClick={toggleAddMode}><span>＋</span>連続追加</button>
            <button className={rangeDeleteMode ? 'active' : ''} onClick={toggleRangeDeleteMode}><span>▧</span>範囲削除</button>
            {rangeDeleteMode && <button disabled={!rangeDeletePointIds.length} onClick={commitRangeDelete}><span>⌫</span>{rangeDeletePointIds.length ? `${rangeDeletePointIds.length}点削除` : '選択を削除'}</button>}
            <button disabled={!selectedPoint} onClick={() => { if (selectedPointId) dispatch({ type: 'commit', points: deletePoint(points, selectedPointId) }); setSelectedPointId(null); setSelectionCandidateIds([]); }}><span>⌫</span>削除</button>
            <i />
            <button disabled={!history.past.length} onClick={() => { dispatch({ type: 'undo' }); setRangeDeletePointIds([]); }}><span>↶</span>元に戻す</button>
            <button disabled={!history.future.length} onClick={() => { dispatch({ type: 'redo' }); setRangeDeletePointIds([]); }}><span>↷</span>やり直す</button>
            <button disabled={workspaceMode === 'plan' ? !points.length : !history.initial.length} onClick={() => { dispatch({ type: 'reset' }); setSelectedPointId(null); setRangeDeletePointIds([]); }}><span>↺</span>初期状態</button>
          </nav>}
        </section>
      </div>
    </main>
  );
}

function RawDetail({ point, onClose }: { point: RawPosition; onClose: () => void }) {
  return <div className="detail-card raw-detail"><button onClick={onClose} aria-label="閉じる">×</button><strong>参考測位点</strong><time>{formatTimestamp(point.timestamp)}</time>{point.source && <span>source: {point.source}</span>}{point.accuracyMeters !== undefined && <span>accuracy: {point.accuracyMeters} m</span>}{point.altitudeMeters !== undefined && <span>altitude: {point.altitudeMeters} m</span>}{point.speedMetersPerSecond !== undefined && <span>speed: {point.speedMetersPerSecond} m/s</span>}</div>;
}

function formatTimestamp(timestamp: string) { return timestamp.replace('T', ' ').replace(/\.\d{3}/, ''); }
