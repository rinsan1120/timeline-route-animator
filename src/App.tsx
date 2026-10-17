import MobileBottomSheet from './components/MobileBottomSheet';
import { WORKSPACE_MODE_COPY } from './workspaceModeCopy';
import { hasRecordedRouteTime } from './video/routeClock';
import SpotWorkspace from './spot/SpotWorkspace';
import type { BalloonFramePosition, PopupPlacement, EndpointMarkerLabel } from './popup/placement';
import { hasMissingMarkerFramePositions, resolveMarkerFramePositions, type MarkerReferenceProjector } from './video/markerFramePositions';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import RouteMap from './map/RouteMap';
import { downloadPlanFile, parsePlanFile, PLAN_FILE_ERROR, PLAN_FILE_FORMAT, type PlanState } from './plan/planFile';
import { downloadWorkFile, parseWorkFile, WORK_FILE_ERROR, WORK_FILE_FORMAT, type TimelineWorkState } from './timeline/workFile';
import { saveBlobWithPicker, saveErrorMessage } from './files/saveBlob';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from './route/annotationStyle';
import type { RouteMarkerMode } from './route/routeMarker';
import { addPoint, appendPlanPoint, insertPlanPoint, deletePoint, movePoint } from './route/editor';
import { formatDistance } from './route/geometry';
import { emptyEditHistory, editHistoryReducer, type HistoryAction } from './route/history';
import { deriveDayMarkers, derivePlanDayMarkers, planRouteDistances, tripRouteDistance } from './route/tripRoute';
import { buildRouteDistanceModel } from './route/routeDistanceProgress';
import { clampDistanceHudPlacement, distanceHudLayout, type DistanceHudSettings } from './video/distanceHud';
import type { RawPosition, RoutePoint, WorkerResponse } from './timeline/types';
import { readLeadingFileFormat, readTimelineFile } from './timeline/fileLoader';
import { buildFollowCameraPlan, type FollowCameraPlan, type FollowZoomPreset, type FollowViewMode, type VideoCameraMode } from './video/followCamera';
import { createOverviewCamera } from './video/overviewCamera';
import { outputVideoDuration, outputVideoFrameCount, renderRouteVideo, type VideoProgress } from './video/renderer';
import { DEFAULT_VIDEO_SETTINGS, type VideoSettings } from './video/videoSettings';
import VideoWorkspace from './video/VideoWorkspace';
import type { PreviewFrameOptions, PreviewMarkerPosition, PreviewMarkerTarget } from './video/previewFrameRenderer';
import { useVideoPlayer } from './video/useVideoPlayer';
import { sameFramePlanInputs } from './video/previewUpdates';
import { captureVideoOutputOptions, createVideoOutputSnapshot, type VideoOutputOptions } from './video/videoOutputSnapshot';
import { balloonPauseSeconds } from './video/balloonPauses';
import { normalizePauseSeconds, totalPauseSeconds } from './video/playbackTimeline';
import { buildRoutePointDayNumbers } from './route/dayRouteColor';
import HelpTip from './help/HelpTip';
import type { HelpKey } from './help/helpContent';

type MapMode = 'display' | 'edit' | 'animation-range';
type WorkspaceMode = 'timeline' | 'plan' | 'spot';

function stableSerialize(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, nested]) => [key, normalize(nested)]),
    );
    return item;
  };
  return JSON.stringify(normalize(value)) ?? 'null';
}

function defaultPlanState(): PlanState {
  return {
    points: [], planDayStarts: [], planDayNotes: {}, dayMarkerPlacements: {},
    videoSettings: DEFAULT_VIDEO_SETTINGS, annotationStyle: DEFAULT_ANNOTATION_STYLE,
    animationStartPointId: null, animationEndPointId: null, endpointMarkerPlacements: {}, dayMarkerFramePositions: {}, endpointMarkerFramePositions: {},
  };
}

export default function App() {
  const markerRevisionRef = useRef(0);
  const [history, dispatchHistory] = useReducer(editHistoryReducer, emptyEditHistory);
  const editSnapshotRef = useRef(history.present);
  editSnapshotRef.current = history.present;
  const { points, dayMarkerPlacements, endpointMarkerPlacements, dayMarkerFramePositions, endpointMarkerFramePositions, legacyDayKeys } = history.present;
  const dispatch = useCallback((action: HistoryAction) => {
    if (action.type !== 'resolve-balloon-positions' && action.type !== 'resolve-marker-positions' && action.type !== 'sync-hud-position') {
      markerRevisionRef.current += 1;
    }
    dispatchHistory(action);
  }, []);
  const markerProjectorRef = useRef<MarkerReferenceProjector | null>(null);
  const [markerProjector, setMarkerProjector] = useState<MarkerReferenceProjector | null>(null);
  const markerProjectorWaitersRef = useRef(new Set<(projector: MarkerReferenceProjector) => void>());
  const onMarkerProjectorReady = useCallback((projector: MarkerReferenceProjector | null) => {
    markerProjectorRef.current = projector;
    setMarkerProjector(() => projector);
    if (projector) {
      for (const resolve of markerProjectorWaitersRef.current) resolve(projector);
      markerProjectorWaitersRef.current.clear();
    }
  }, []);
  const waitForMarkerProjector = useCallback((signal?: AbortSignal): Promise<MarkerReferenceProjector> => {
    if (markerProjectorRef.current) return Promise.resolve(markerProjectorRef.current);
    return new Promise((resolve, reject) => {
      const cleanup = () => { window.clearTimeout(timer); markerProjectorWaitersRef.current.delete(ready); signal?.removeEventListener('abort', abort); };
      const ready = (projector: MarkerReferenceProjector) => { cleanup(); resolve(projector); };
      const abort = () => { cleanup(); reject(new DOMException('マーカー配置の準備をキャンセルしました。', 'AbortError')); };
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('地図の準備完了後にもう一度操作してください。')); }, 20_000);
      markerProjectorWaitersRef.current.add(ready);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }, []);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('timeline');
  const [mobileModeMenuOpen, setMobileModeMenuOpen] = useState(false);
  const topbarRef = useRef<HTMLElement>(null);
  const [workspaceView, setWorkspaceView] = useState<'map' | 'video'>('map');
  const initialGuideShownRef = useRef(false);
  const [selectedOutputDay, setSelectedOutputDay] = useState('all');
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const workFileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const routeLoadedNoticeTimerRef = useRef<number | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const minAvailableDate = dates.at(-1) ?? '';
  const maxAvailableDate = dates[0] ?? '';
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [from, setFrom] = useState('00:00');
  const [to, setTo] = useState('23:59');
  const [fileName, setFileName] = useState('');
  const [workSaveName, setWorkSaveName] = useState('route-work.json');
  const [planSaveName, setPlanSaveName] = useState('route-plan.json');
  const videoBlobRef = useRef<Blob | null>(null);
  const videoUrlRef = useRef('');
  const currentOutputSnapshotRef = useRef('');
  const [rawPositions, setRawPositions] = useState<RawPosition[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [selectedRaw, setSelectedRaw] = useState<RawPosition | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectionCandidateIds, setSelectionCandidateIds] = useState<string[]>([]);
  const [annotationLabel, setAnnotationLabel] = useState('');
  const [recordedTimeClockEnabled, setRecordedTimeClockEnabled] = useState(DEFAULT_VIDEO_SETTINGS.recordedTimeClockEnabled);
  const [commonPauseSeconds, setCommonPauseSeconds] = useState(DEFAULT_VIDEO_SETTINGS.commonPauseSeconds);
  const [commonPauseInput, setCommonPauseInput] = useState(DEFAULT_VIDEO_SETTINGS.commonPauseSeconds.toFixed(1));
  const [preRollSeconds, setPreRollSeconds] = useState(DEFAULT_VIDEO_SETTINGS.preRollSeconds);
  const [preRollInput, setPreRollInput] = useState(DEFAULT_VIDEO_SETTINGS.preRollSeconds.toFixed(1));
  const [postRollSeconds, setPostRollSeconds] = useState(DEFAULT_VIDEO_SETTINGS.postRollSeconds);
  const [postRollInput, setPostRollInput] = useState(DEFAULT_VIDEO_SETTINGS.postRollSeconds.toFixed(1));
  const [dayMarkerNotes, setDayMarkerNotes] = useState<Record<string, string>>({});
  const [planDayStarts, setPlanDayStarts] = useState<string[]>([]);
  const [planDayNotes, setPlanDayNotes] = useState<Record<string, string>>({});
  const [dayMarkerNoteInput, setDayMarkerNoteInput] = useState('');
  const [mobileDayMarkerEditingScale, setMobileDayMarkerEditingScale] = useState(1);
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [mapMode, setMapMode] = useState<MapMode>('display');
  const [openToolbarHelpKey, setOpenToolbarHelpKey] = useState<HelpKey | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [insertMode, setInsertMode] = useState(false);
  const [rangeDeleteMode, setRangeDeleteMode] = useState(false);
  const [rangeDeletePointIds, setRangeDeletePointIds] = useState<string[]>([]);
  const [animationStartPointId, setAnimationStartPointId] = useState<string | null>(null);
  const [animationEndPointId, setAnimationEndPointId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(DEFAULT_VIDEO_SETTINGS.duration);
  const [durationInput, setDurationInput] = useState(String(DEFAULT_VIDEO_SETTINGS.duration));
  const [cameraMode, setCameraMode] = useState<VideoCameraMode>(DEFAULT_VIDEO_SETTINGS.cameraMode);
  const [followZoomPreset, setFollowZoomPreset] = useState<FollowZoomPreset>(DEFAULT_VIDEO_SETTINGS.followZoomPreset);
  const [followViewMode, setFollowViewMode] = useState<FollowViewMode>(DEFAULT_VIDEO_SETTINGS.followViewMode);
  const [overviewZoomMode, setOverviewZoomMode] = useState<'auto' | 'custom'>(DEFAULT_VIDEO_SETTINGS.overviewZoomMode);
  const [overviewCustomZoom, setOverviewCustomZoom] = useState(DEFAULT_VIDEO_SETTINGS.overviewCustomZoom);
  const [overviewCustomZoomInput, setOverviewCustomZoomInput] = useState(DEFAULT_VIDEO_SETTINGS.overviewCustomZoom.toFixed(1));
  const [followCustomZoom, setFollowCustomZoom] = useState(DEFAULT_VIDEO_SETTINGS.followCustomZoom);
  const [followCustomZoomInput, setFollowCustomZoomInput] = useState(DEFAULT_VIDEO_SETTINGS.followCustomZoom.toFixed(1));
  const [introZoomEnabled, setIntroZoomEnabled] = useState(DEFAULT_VIDEO_SETTINGS.introZoomEnabled);
  const [routeMarkerMode, setRouteMarkerMode] = useState<RouteMarkerMode>(DEFAULT_VIDEO_SETTINGS.routeMarkerMode);
  const [dayRouteColorsEnabled, setDayRouteColorsEnabled] = useState(DEFAULT_VIDEO_SETTINGS.dayRouteColorsEnabled);
  const [distanceHudOptions, setDistanceHudOptions] = useState(() => ({
    enabled: DEFAULT_VIDEO_SETTINGS.distanceHudSettings.enabled, scale: DEFAULT_VIDEO_SETTINGS.distanceHudSettings.scale,
  }));
  const distanceHudSettings = useMemo<DistanceHudSettings>(() => ({ ...distanceHudOptions, ...history.present.distanceHudPlacement }),
    [distanceHudOptions, history.present.distanceHudPlacement]);
  const balloonFollowPlanCache = useRef<{ key: string; plan: FollowCameraPlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [generatedOutputSnapshot, setGeneratedOutputSnapshot] = useState<string | null>(null);
  const replaceVideoUrl = useCallback((next: string) => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = next;
    setVideoUrl(next);
  }, []);
  const clearGeneratedVideo = useCallback(() => {
    videoBlobRef.current = null;
    setGeneratedOutputSnapshot(null);
    replaceVideoUrl('');
  }, [replaceVideoUrl]);

  const videoSettings: VideoSettings = {
    duration, commonPauseSeconds, preRollSeconds, postRollSeconds, cameraMode,
    overviewZoomMode, overviewCustomZoom, followZoomPreset, followCustomZoom, followViewMode,
    introZoomEnabled, routeMarkerMode, dayRouteColorsEnabled, recordedTimeClockEnabled, distanceHudSettings,
  };
  const timelineBaselineRef = useRef<string | null>(null);
  const planBaselineRef = useRef<string | null>(null);
  const pendingExtractionSnapshotRef = useRef<((routePoints: RoutePoint[]) => string) | null>(null);
  const pendingTimelineLoadRef = useRef<{ dates: string[]; fileName: string } | null>(null);
  const [spotHasUnsavedChanges, setSpotHasUnsavedChanges] = useState(false);
  const applyVideoSettings = useCallback((settings: VideoSettings) => {
    setDuration(settings.duration);
    setDurationInput(String(settings.duration));
    setCommonPauseSeconds(settings.commonPauseSeconds);
    setCommonPauseInput(settings.commonPauseSeconds.toFixed(1));
    setPreRollSeconds(settings.preRollSeconds);
    setPreRollInput(settings.preRollSeconds.toFixed(1));
    setPostRollSeconds(settings.postRollSeconds);
    setPostRollInput(settings.postRollSeconds.toFixed(1));
    setCameraMode(settings.cameraMode);
    setOverviewZoomMode(settings.overviewZoomMode);
    setOverviewCustomZoom(settings.overviewCustomZoom);
    setOverviewCustomZoomInput(settings.overviewCustomZoom.toFixed(1));
    setFollowZoomPreset(settings.followZoomPreset);
    setFollowCustomZoom(settings.followCustomZoom);
    setFollowCustomZoomInput(settings.followCustomZoom.toFixed(1));
    setFollowViewMode(settings.followViewMode);
    setIntroZoomEnabled(settings.introZoomEnabled);
    setRouteMarkerMode(settings.routeMarkerMode);
    setDayRouteColorsEnabled(settings.dayRouteColorsEnabled);
    setRecordedTimeClockEnabled(settings.recordedTimeClockEnabled);
    setDistanceHudOptions({ enabled: settings.distanceHudSettings.enabled, scale: settings.distanceHudSettings.scale });
  }, []);

  const timelineWorkState: TimelineWorkState = {
    points, startDate, endDate, from, to, dayMarkerNotes, dayMarkerPlacements,
    endpointMarkerPlacements, annotationStyle, animationStartPointId, animationEndPointId,
    dayMarkerFramePositions, endpointMarkerFramePositions,
    videoSettings, selectedOutputDay,
  };
  const planState: PlanState = {
    points, planDayStarts, planDayNotes, dayMarkerPlacements, videoSettings, annotationStyle,
    animationStartPointId, animationEndPointId, endpointMarkerPlacements,
    dayMarkerFramePositions, endpointMarkerFramePositions,
  };
  if (timelineBaselineRef.current === null && workspaceMode === 'timeline') {
    timelineBaselineRef.current = stableSerialize(timelineWorkState);
  }
  const timelineStateKey = () => stableSerialize(timelineWorkState);
  const planStateKey = () => stableSerialize(planState);
  const compactMobileHeader = !(workspaceMode === 'timeline' && points.length === 0);
  const currentWorkspaceModeCopy = WORKSPACE_MODE_COPY[workspaceMode];

  useEffect(() => {
    if (!mobileModeMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !topbarRef.current?.contains(event.target)) setMobileModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileModeMenuOpen(false);
      topbarRef.current?.querySelector<HTMLButtonElement>('.mobile-mode-trigger')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileModeMenuOpen]);

  useEffect(() => setMobileModeMenuOpen(false), [workspaceMode]);
  const editMode = mapMode === 'edit';
  const animationRangeMode = mapMode === 'animation-range';
  const selectedPoint = points.find((point) => point.id === selectedPointId) ?? null;
  const selectedPointIndex = selectedPointId ? points.findIndex((point) => point.id === selectedPointId) : -1;
  const selectionCandidateIndex = selectedPointId ? selectionCandidateIds.indexOf(selectedPointId) : -1;
  const showSelectionCandidateSwitcher = editMode && !addMode && !insertMode && !rangeDeleteMode
    && selectionCandidateIds.length >= 2 && selectionCandidateIndex >= 0;
  const dayMarkers = useMemo(() => (workspaceMode === 'plan'
    ? derivePlanDayMarkers(points, planDayStarts, planDayNotes)
    : deriveDayMarkers(points, dayMarkerNotes, startDate)).map((marker) => {
      const key = workspaceMode === 'plan' ? marker.pointId : marker.date!;
      return { ...marker, placement: dayMarkerPlacements[key], framePosition: dayMarkerFramePositions[key], legacyFramePlacement: legacyDayKeys.has(key) };
    }), [dayMarkerPlacements, dayMarkerFramePositions, legacyDayKeys, workspaceMode, points, planDayStarts, planDayNotes, dayMarkerNotes, startDate]);
  const selectedDayMarker = dayMarkers.find((marker) => marker.pointId === selectedPointId) ?? null;
  const dayNumberByPointId = useMemo(() => buildRoutePointDayNumbers(points, dayMarkers), [points, dayMarkers]);
  const outputDay = workspaceMode === 'timeline' && selectedOutputDay !== 'all'
    ? dayMarkers.find((marker) => marker.date === selectedOutputDay) : undefined;
  const dayFilteredPoints = useMemo(() => {
    if (!outputDay) return points;
    const markerIndex = dayMarkers.indexOf(outputDay);
    const start = markerIndex === 0 ? 0 : points.findIndex((point) => point.id === outputDay.pointId);
    const nextMarker = dayMarkers[markerIndex + 1];
    const end = nextMarker ? points.findIndex((point) => point.id === nextMarker.pointId) : points.length;
    return points.slice(start, end);
  }, [points, dayMarkers, outputDay]);
  const visibleDayMarkers = useMemo(() => outputDay ? [outputDay] : dayMarkers, [outputDay, dayMarkers]);
  const visibleDayNumbers = useMemo(() => outputDay
    ? new Map(dayFilteredPoints.map((point) => [point.id, outputDay.dayNumber])) : dayNumberByPointId,
  [dayFilteredPoints, outputDay, dayNumberByPointId]);
  const visibleRawPositions = useMemo(() => outputDay
    ? rawPositions.filter((point) => point.timestamp.slice(0, 10) === outputDay.date) : rawPositions,
  [rawPositions, outputDay]);
  const changeOutputDay = useCallback((date: string) => {
    setSelectedOutputDay(date);
    setSelectedPointId(null);
    setSelectedRaw(null);
    setSelectionCandidateIds([]);
    setRangeDeletePointIds([]);
    setAnimationStartPointId(null);
    setAnimationEndPointId(null);
  }, []);
  useEffect(() => {
    if (selectedOutputDay !== 'all' && (workspaceMode !== 'timeline'
      || !dayMarkers.some((marker) => marker.date === selectedOutputDay)
      || (startDate && selectedOutputDay < startDate) || (endDate && selectedOutputDay > endDate))) {
      changeOutputDay('all');
    }
  }, [selectedOutputDay, workspaceMode, dayMarkers, startDate, endDate, changeOutputDay]);
  useEffect(() => {
    if (selectedPointId && !dayFilteredPoints.some((point) => point.id === selectedPointId)) {
      setSelectedPointId(null);
      setSelectionCandidateIds([]);
    }
  }, [dayFilteredPoints, selectedPointId]);
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
  useEffect(() => {
    if (!editMode || workspaceMode !== 'plan') setOpenToolbarHelpKey(null);
  }, [editMode, workspaceMode]);

  const selectAdjacentCandidate = (offset: -1 | 1) => {
    if (!selectionCandidateIds.length || selectionCandidateIndex < 0) return;
    const nextIndex = (selectionCandidateIndex + offset + selectionCandidateIds.length) % selectionCandidateIds.length;
    setSelectedPointId(selectionCandidateIds[nextIndex]);
    setSelectedRaw(null);
  };

  const setAnnotationPlacement = (id: string, placement?: PopupPlacement) => {
    dispatch({ type: 'commit', points: points.map((point) => {
      if (point.id !== id || !point.annotation) return point;
      const { placement: previous, framePosition: previousFrame, ...annotation } = point.annotation;
      return { ...point, annotation: { ...annotation, ...(placement ? { placement } : {}) } };
    }) });
    setSelectedPointId(id);
  };
  const setBalloonFramePosition = useCallback((id: string, framePosition: BalloonFramePosition) => {
    const target = points.find((point) => point.id === id)?.annotation;
    if (!target || target.framePosition && Math.abs(target.framePosition.x - framePosition.x) < 1e-9 && Math.abs(target.framePosition.y - framePosition.y) < 1e-9) return;
    dispatch({ type: 'commit', points: points.map((point) => point.id === id && point.annotation
      ? { ...point, annotation: { ...point.annotation, framePosition } } : point) });
    setSelectedPointId(id);
  }, [points]);
  const commitVideoMarker = (target: PreviewMarkerTarget, position: PreviewMarkerPosition) => {
    if (target.kind === 'day') {
      const marker = dayMarkers.find((item) => item.pointId === target.pointId);
      const key = workspaceMode === 'plan' ? marker?.pointId : marker?.date;
      if (!key) return;
      dispatch({ type: 'commit', edit: { dayMarkerFramePositions: { ...dayMarkerFramePositions, [key]: position } } });
    } else if (target.kind === 'endpoint') {
      dispatch({ type: 'commit', edit: { endpointMarkerFramePositions: { ...endpointMarkerFramePositions, [target.label]: position } } });
    } else dispatch({ type: 'commit', edit: { distanceHudPlacement: position } });
  };
  const resolveBalloonPositions = useCallback((positions: ReadonlyMap<string, BalloonFramePosition>) => {
    dispatch({ type: 'resolve-balloon-positions', positions });
  }, []);
  const setDayPlacement = (id: string, placement?: PopupPlacement) => {
    const marker = dayMarkers.find((item) => item.pointId === id);
    const key = workspaceMode === 'plan' ? id : marker?.date;
    if (!key) return;
    const previous = dayMarkerPlacements[key];
    if (placement === previous || placement && previous && placement.offsetX === previous.offsetX && placement.offsetY === previous.offsetY) { setSelectedPointId(id); return; }
    const nextPlacements = { ...dayMarkerPlacements }, nextPositions = { ...dayMarkerFramePositions }, nextLegacyKeys = new Set(legacyDayKeys);
    if (placement) nextPlacements[key] = placement;
    else delete nextPlacements[key];
    delete nextPositions[key];
    nextLegacyKeys.delete(key);
    dispatch({ type: 'commit', edit: { dayMarkerPlacements: nextPlacements, dayMarkerFramePositions: nextPositions, legacyDayKeys: nextLegacyKeys } });
    setSelectedPointId(id);
  };
  const setEndpointPlacement = (label: EndpointMarkerLabel, placement?: PopupPlacement) => {
    const previous = endpointMarkerPlacements[label];
    if (placement === previous || placement && previous && placement.offsetX === previous.offsetX && placement.offsetY === previous.offsetY) {
      setSelectedPointId((label === 'START' ? animationPoints[0] : animationPoints.at(-1))?.id ?? null);
      return;
    }
    const nextPlacements = { ...endpointMarkerPlacements }, nextPositions = { ...endpointMarkerFramePositions };
    if (placement) nextPlacements[label] = placement;
    else delete nextPlacements[label];
    delete nextPositions[label];
    dispatch({ type: 'commit', edit: { endpointMarkerPlacements: nextPlacements, endpointMarkerFramePositions: nextPositions } });
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
  const distance = useMemo(() => planDistances?.totalMeters ?? tripRouteDistance(dayFilteredPoints), [dayFilteredPoints, planDistances]);
  const animationPoints = useMemo(() => {
    if (dayFilteredPoints.length < 2) return dayFilteredPoints;
    const startIndex = animationStartPointId ? dayFilteredPoints.findIndex((point) => point.id === animationStartPointId) : 0;
    const endIndex = animationEndPointId ? dayFilteredPoints.findIndex((point) => point.id === animationEndPointId) : dayFilteredPoints.length - 1;
    return startIndex >= 0 && endIndex > startIndex ? dayFilteredPoints.slice(startIndex, endIndex + 1) : dayFilteredPoints;
  }, [dayFilteredPoints, animationStartPointId, animationEndPointId]);
  const canShowVideo = workspaceMode !== 'spot' && animationPoints.length >= 2;
  const showingVideo = workspaceView === 'video' && canShowVideo;
  useEffect(() => { setWorkspaceView('map'); }, [workspaceMode]);
  useEffect(() => { if (!canShowVideo) setWorkspaceView('map'); }, [canShowVideo]);
  useEffect(() => {
    if (!canShowVideo || initialGuideShownRef.current || error || busy) return;
    initialGuideShownRef.current = true;
    const guide = 'ルートを確認してください。修正しなければ、そのままMP4を生成できます。';
    const guideNotice = notice ? `${notice} ${guide}` : guide;
    setNotice(guideNotice);
    if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
    routeLoadedNoticeTimerRef.current = window.setTimeout(() => {
      setNotice((current) => current === guideNotice ? '' : current);
      routeLoadedNoticeTimerRef.current = null;
    }, 5000);
  }, [canShowVideo, animationPoints, error, busy, notice]);
  const recordedTimeAvailable = useMemo(() => workspaceMode === 'timeline' && hasRecordedRouteTime(animationPoints), [workspaceMode, animationPoints]);
  const showRecordedTimeClock = recordedTimeAvailable && recordedTimeClockEnabled;
  const pointPauses = useMemo(() => balloonPauseSeconds(animationPoints, visibleDayMarkers, routeMarkerMode, commonPauseSeconds),
    [animationPoints, visibleDayMarkers, routeMarkerMode, commonPauseSeconds]);
  const animationPauseSeconds = useMemo(() => totalPauseSeconds(pointPauses), [pointPauses]);
  const overviewCamera = useMemo(() => createOverviewCamera(animationPoints,
    overviewZoomMode === 'custom' ? overviewCustomZoom : undefined),
  [animationPoints, overviewZoomMode, overviewCustomZoom]);

  const balloonFollowCamera = useMemo(() => {
    if (cameraMode !== 'follow' || animationPoints.length < 2 || !points.some((point) => point.annotation?.label)) return null;
    const key = `${followZoomPreset}:${duration}:${followCustomZoom}:${followViewMode}`;
    const cached = balloonFollowPlanCache.current;
    // Label/placement/history updates do not change the camera path. Avoid
    // rebuilding its segment sampling every time a balloon is dragged.
    if (cached?.key === key && cached.plan.points.length === animationPoints.length && cached.plan.points.every((point, index) => {
      const current = animationPoints[index];
      return point.id === current.id && point.latitude === current.latitude && point.longitude === current.longitude && point.timestamp === current.timestamp;
    })) return cached.plan;
    try {
      const plan = buildFollowCameraPlan(animationPoints, followZoomPreset, duration, followCustomZoom, followViewMode);
      balloonFollowPlanCache.current = { key, plan };
      return plan;
    }
    catch { return null; }
  }, [cameraMode, points, animationPoints, followZoomPreset, duration, followCustomZoom, followViewMode]);
  const distanceHudModel = useMemo(() => distanceHudSettings.enabled && dayFilteredPoints.length > 0
    ? buildRouteDistanceModel(dayFilteredPoints, visibleDayMarkers, animationPoints) : null,
  [distanceHudSettings.enabled, dayFilteredPoints, visibleDayMarkers, animationPoints]);
  const distanceHud = useMemo(() => distanceHudModel
    ? { settings: distanceHudSettings, model: distanceHudModel } : undefined, [distanceHudModel, distanceHudSettings]);
  const framePreviewOptions = useMemo<PreviewFrameOptions>(() => ({
    points: animationPoints, dayMarkers: visibleDayMarkers, dayNumberByPointId: visibleDayNumbers,
    recordedTimeClockEnabled: showRecordedTimeClock, dayRouteColorsEnabled, endpointMarkerPlacements, endpointMarkerFramePositions,
    routeMarkerMode, commonPauseSeconds, preRollSeconds, postRollSeconds, duration, revealRoute: true,
    cameraMode, overviewCamera: overviewCamera ?? undefined, overviewZoomMode, overviewCustomZoom,
    followZoomPreset, followCustomZoom, followViewMode, followCameraPlan: balloonFollowCamera ?? undefined,
    introZoomEnabled, annotationStyle, distanceHud: distanceHud ? { ...distanceHud, dayColorsEnabled: dayRouteColorsEnabled } : undefined,
  }), [animationPoints, visibleDayMarkers, visibleDayNumbers, showRecordedTimeClock, dayRouteColorsEnabled,
    endpointMarkerPlacements, endpointMarkerFramePositions, routeMarkerMode, commonPauseSeconds, preRollSeconds, postRollSeconds, duration,
    cameraMode, overviewCamera, overviewZoomMode, overviewCustomZoom, followZoomPreset, followCustomZoom,
    followViewMode, balloonFollowCamera, introZoomEnabled, annotationStyle, distanceHud]);
  // Position resolution must survive its own state commit, but never a different
  // route, placement edit, camera, output range, or restored work session.
  const markerConversionToken = useMemo(() => ({}), [history.revision, workspaceMode, animationPoints, selectedOutputDay,
    dayMarkerPlacements, endpointMarkerPlacements, legacyDayKeys, dayMarkerNotes, planDayNotes, planDayStarts, startDate,
    routeMarkerMode, commonPauseSeconds, preRollSeconds, postRollSeconds, duration, cameraMode,
    overviewCamera, balloonFollowCamera, overviewZoomMode, overviewCustomZoom, followZoomPreset, followCustomZoom, followViewMode, introZoomEnabled, annotationStyle]);
  const markerConversionTokenRef = useRef(markerConversionToken);
  markerConversionTokenRef.current = markerConversionToken;
  const markerFrameOptionsRef = useRef(framePreviewOptions);
  markerFrameOptionsRef.current = framePreviewOptions;
  const [markerReadyToken, setMarkerReadyToken] = useState<object | null>(null);
  const missingMarkerPositions = useMemo(() => hasMissingMarkerFramePositions(framePreviewOptions), [framePreviewOptions]);
  const ensureMarkerPositions = useCallback(async (signal?: AbortSignal) => {
    const input = framePreviewOptions;
    const revision = markerRevisionRef.current;
    if (!hasMissingMarkerFramePositions(input)) return {
      options: input, positions: { dayMarkerFramePositions, endpointMarkerFramePositions },
    };
    const projector = await waitForMarkerProjector(signal);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('マーカー配置の計算用Canvasを作成できませんでした。');
    const resolved = await resolveMarkerFramePositions(context, input, projector, signal);
    const current = markerFrameOptionsRef.current;
    // Normal balloon coordinate initialization may replace the points array
    // while leaving every marker reference-frame input unchanged.
    const sameInputs = markerConversionTokenRef.current === markerConversionToken || sameFramePlanInputs(input, current)
      && input.annotationStyle?.fontScale === current.annotationStyle?.fontScale
      && input.annotationStyle?.minimumWidth === current.annotationStyle?.minimumWidth
      && input.annotationStyle?.minimumWidthForDay === current.annotationStyle?.minimumWidthForDay
      && input.annotationStyle?.minimumWidthForBalloon === current.annotationStyle?.minimumWidthForBalloon
      && (input.dayMarkers ?? []).every((marker, index) => {
        const next = current.dayMarkers?.[index];
        return next && marker.pointId === next.pointId && marker.date === next.date && marker.note === next.note
          && marker.legacyFramePlacement === next.legacyFramePlacement;
      });
    if (signal?.aborted || revision !== markerRevisionRef.current || !sameInputs) {
      throw new DOMException('マーカー配置の準備をキャンセルしました。', 'AbortError');
    }
    const source = editSnapshotRef.current;
    const nextDays = { ...source.dayMarkerFramePositions };
    const nextEndpoints = { ...source.endpointMarkerFramePositions };
    let daysChanged = false, endpointsChanged = false;
    for (const marker of resolved.dayMarkers ?? []) {
      const key = workspaceMode === 'plan' ? marker.pointId : marker.date;
      if (key && marker.framePosition && !nextDays[key]) { nextDays[key] = { ...marker.framePosition }; daysChanged = true; }
    }
    for (const label of ['START', 'GOAL'] as const) {
      const position = resolved.endpointMarkerFramePositions?.[label];
      if (position && !nextEndpoints[label]) { nextEndpoints[label] = { ...position }; endpointsChanged = true; }
    }
    if (daysChanged || endpointsChanged) dispatch({ type: 'resolve-marker-positions', source, days: nextDays, endpoints: nextEndpoints });
    setMarkerReadyToken(markerConversionToken);
    return { options: resolved, positions: { dayMarkerFramePositions: nextDays, endpointMarkerFramePositions: nextEndpoints } };
  }, [framePreviewOptions, dayMarkerFramePositions, endpointMarkerFramePositions, workspaceMode, markerConversionToken, waitForMarkerProjector, dispatch]);
  useEffect(() => {
    if (!missingMarkerPositions || !markerProjector || busy || videoProgress || markerReadyToken === markerConversionToken) return;
    const controller = new AbortController();
    void ensureMarkerPositions(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : 'マーカーの配置を準備できませんでした。');
      }
    });
    return () => controller.abort();
  }, [missingMarkerPositions, markerProjector, busy, videoProgress, markerReadyToken, markerConversionToken, ensureMarkerPositions]);
  const markerPositionsReady = !missingMarkerPositions || markerReadyToken === markerConversionToken;
  const currentOutputSnapshot = useMemo(() => createVideoOutputSnapshot(framePreviewOptions), [framePreviewOptions]);
  currentOutputSnapshotRef.current = currentOutputSnapshot;
  const videoNeedsRegeneration = !!videoUrl && generatedOutputSnapshot !== currentOutputSnapshot;
  const videoPlayer = useVideoPlayer(framePreviewOptions, showingVideo && markerPositionsReady, !!videoProgress);

  const canReplaceSession = () => {
    if (videoPlayer.isEditingBalloon()) {
      setError('配置を確定またはキャンセルしてから、保存・読込・切替を行ってください。');
      return false;
    }
    return true;
  };

  const confirmDiscardCurrent = () => {
    if (!canReplaceSession()) return false;
    const pendingTextEdit = (!!selectedPoint && annotationLabel !== (selectedPoint.annotation?.label ?? ''))
      || (!!selectedDayMarker && dayMarkerNoteInput !== (workspaceMode === 'plan'
        ? planDayNotes[selectedDayMarker.pointId] ?? ''
        : dayMarkerNotes[selectedDayMarker.date ?? ''] ?? ''));
    const dirty = pendingTextEdit || (workspaceMode === 'spot'
      ? spotHasUnsavedChanges
      : workspaceMode === 'plan'
        ? planBaselineRef.current !== null && planStateKey() !== planBaselineRef.current
        : timelineBaselineRef.current !== null && timelineStateKey() !== timelineBaselineRef.current);
    if (!dirty) return true;
    const message = workspaceMode === 'spot'
      ? 'スポット画像の編集内容は、この操作で失われます。PNG画像を保存していても編集状態は復元できません。破棄して続けますか？'
      : '未保存の編集内容があります。破棄して続けますか？';
    return window.confirm(message);
  };
  const stopVideoPreview = videoPlayer.stop;
  const openVideoWorkspace = () => {
    videoPlayer.pause();
    setOpenToolbarHelpKey(null);
    setWorkspaceView('video');
  };
  const selectVideoBalloon = (id: string) => {
    setSelectedPointId(id);
    setSelectedRaw(null);
    setSelectionCandidateIds([]);
  };
  const openSelectedBalloonInVideo = () => {
    if (!selectedPoint?.annotation?.label || busy || videoProgress || videoPlayer.isEditingBalloon()) return;
    if (!animationPoints.some((point) => point.id === selectedPoint.id)) {
      setNotice('この地点はアニメーション対象範囲外です。アニメーション範囲を調整してください。');
      return;
    }
    if (!canShowVideo) { setNotice('動画生成には2点以上のルートが必要です。'); return; }
    videoPlayer.requestBalloonEvent(selectedPoint.id);
    openVideoWorkspace();
  };
  useEffect(() => {
    if (!distanceHudModel) return;
    dispatch({ type: 'sync-hud-position', placement: clampDistanceHudPlacement(distanceHudSettings, distanceHudLayout(distanceHudModel, distanceHudSettings.scale)) });
  }, [distanceHudModel, distanceHudSettings, dispatch]);

  const extract = () => {
    if (!dates.length || busy || videoProgress || !confirmDiscardCurrent()) return;
    const currentState = timelineWorkState;
    pendingExtractionSnapshotRef.current = (routePoints) => stableSerialize({
      ...currentState, points: routePoints, selectedOutputDay: 'all',
      animationStartPointId: null, animationEndPointId: null,
    });
    setError('');
    setBusy(true);
    workerRef.current?.postMessage({ type: 'extract-range', startDate, endDate, from, to });
  };

  useEffect(() => {
    const worker = new Worker(new URL('./timeline/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'error') {
        pendingExtractionSnapshotRef.current = null;
        pendingTimelineLoadRef.current = null;
        setError(message.message);
        setBusy(false);
      } else if (message.type === 'loaded') {
        const firstDate = message.dates[0];
        pendingTimelineLoadRef.current = { dates: message.dates, fileName: message.fileName };
        setNotice(`${message.dates.length}日分の日付を検出しました。ルートを抽出しています…`);
        pendingExtractionSnapshotRef.current = (routePoints) => stableSerialize({
          points: routePoints, startDate: firstDate, endDate: firstDate, from: '00:00', to: '23:59',
          dayMarkerNotes: {}, dayMarkerPlacements: {}, endpointMarkerPlacements: {}, dayMarkerFramePositions: {}, endpointMarkerFramePositions: {},
          annotationStyle: DEFAULT_ANNOTATION_STYLE, animationStartPointId: null, animationEndPointId: null,
          videoSettings: DEFAULT_VIDEO_SETTINGS, selectedOutputDay: 'all',
        });
        worker.postMessage({ type: 'extract', date: firstDate, from: '00:00', to: '23:59' });
      } else {
        const pendingLoad = pendingTimelineLoadRef.current;
        const nextBaseline = pendingExtractionSnapshotRef.current?.(message.routePoints);
        if (nextBaseline !== undefined) timelineBaselineRef.current = nextBaseline;
        pendingExtractionSnapshotRef.current = null;
        pendingTimelineLoadRef.current = null;
        if (pendingLoad) {
          videoPlayer.reset();
          setWorkspaceView('map');
          initialGuideShownRef.current = false;
          applyVideoSettings(DEFAULT_VIDEO_SETTINGS);
          setAnnotationStyle(DEFAULT_ANNOTATION_STYLE);
          clearGeneratedVideo();
          setDates(pendingLoad.dates);
          setStartDate(pendingLoad.dates[0]);
          setEndDate(pendingLoad.dates[0]);
          setFrom('00:00');
          setTo('23:59');
          setDayMarkerNotes({});
          setFileName(pendingLoad.fileName);
          setWorkSaveName('route-work.json');
          setRawPositions([]);
          setShowRaw(false);
          setSelectedRaw(null);
          setPlanDayStarts([]);
          setPlanDayNotes({});
          setSpotHasUnsavedChanges(false);
        }
        setWorkspaceMode('timeline');
        setSelectedOutputDay('all');
        setInsertMode(false);
        setPlanDayStarts([]);
        setPlanDayNotes({});
        dispatch({ type: 'load', points: message.routePoints, preserveEdit: !pendingLoad });
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
          setNotice('指定時間内にルートの記録がありません。時間範囲を変更してください。');
        }
      }
    };
    worker.onerror = () => {
      pendingExtractionSnapshotRef.current = null;
      pendingTimelineLoadRef.current = null;
      setError('移動履歴の読み込みに失敗しました。');
      setBusy(false);
    };
    return () => {
      worker.terminate();
      if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
    };
  }, [applyVideoSettings, videoPlayer.reset, clearGeneratedVideo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (workspaceMode === 'spot' || busy || videoProgress || videoPlayer.isEditingBalloon()) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      setRangeDeletePointIds([]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceMode, busy, videoProgress, videoPlayer.editingBalloonId]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  useEffect(() => {
    setRangeDeletePointIds([]);
    setSelectionCandidateIds([]);
  }, [points]);

  useEffect(() => {
    if (!editMode || addMode || insertMode || rangeDeleteMode) setSelectionCandidateIds([]);
  }, [editMode, addMode, insertMode, rangeDeleteMode]);

  useEffect(() => {
    if (editMode) return;
    setAddMode(false);
    setInsertMode(false);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  }, [editMode]);

  useEffect(() => {
    const startMissing = animationStartPointId && !dayFilteredPoints.some((point) => point.id === animationStartPointId);
    const endMissing = animationEndPointId && !dayFilteredPoints.some((point) => point.id === animationEndPointId);
    if (startMissing || endMissing) {
      setAnimationStartPointId(null);
      setAnimationEndPointId(null);
      setNotice('指定したポイントが表示範囲から外れたため、アニメ範囲を表示中のルート全体へ戻しました。');
    }
  }, [dayFilteredPoints, animationStartPointId, animationEndPointId]);

  const loadFile = async (file: File) => {
    if (busy || videoProgress || !canReplaceSession()) return;
    setBusy(true);
    setError('');
    setNotice('JSONを端末内で解析しています…');
    try {
      const format = await readLeadingFileFormat(file);
      if (format === WORK_FILE_FORMAT) {
        await restoreWorkFile(file);
        return;
      }
      if (format === PLAN_FILE_FORMAT) {
        setNotice('');
        throw new Error('計画JSONは「計画モード」の「作業を再開」から読み込んでください。');
      }
      const buffer = await readTimelineFile(file);
      if (!confirmDiscardCurrent()) {
        setNotice('');
        setBusy(false);
        return;
      }
      const worker = workerRef.current;
      if (!worker) throw new Error('移動履歴の読み込みに失敗しました。');
      pendingExtractionSnapshotRef.current = null;
      pendingTimelineLoadRef.current = null;
      console.info('[Timeline] sending buffer to Worker', { byteLength: buffer.byteLength });
      worker.postMessage({ type: 'load', buffer, fileName: file.name }, [buffer]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ファイル内容を読み取れませんでした。');
      setBusy(false);
    }
  };

  const beginNewMode = (mode: 'plan' | 'spot') => {
    videoPlayer.reset();
    setWorkspaceView('map');
    initialGuideShownRef.current = false;
    applyVideoSettings(DEFAULT_VIDEO_SETTINGS);
    setAnnotationStyle(DEFAULT_ANNOTATION_STYLE);
    setWorkspaceMode(mode);
    setSelectedOutputDay('all');
    setPlanSaveName('route-plan.json');
    setInsertMode(false);
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
    clearGeneratedVideo();
    setError('');
    setNotice('');
    setSpotHasUnsavedChanges(false);
    if (mode === 'plan') planBaselineRef.current = stableSerialize(defaultPlanState());
    if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
    routeLoadedNoticeTimerRef.current = null;
  };

  const startPlanMode = () => {
    if (workspaceMode === 'plan' || busy || videoProgress || !confirmDiscardCurrent()) return;
    beginNewMode('plan');
  };

  const startSpotMode = () => {
    if (workspaceMode === 'spot' || busy || videoProgress || !confirmDiscardCurrent()) return;
    beginNewMode('spot');
  };

  const saveWork = async () => {
    if (workspaceMode !== 'timeline' || !points.length || busy || videoProgress || !canReplaceSession()) return;
    setBusy(true);
    try {
      const resolved = await ensureMarkerPositions();
      const stateAtSave: TimelineWorkState = { ...timelineWorkState, ...resolved.positions };
      const baselineAtSave = stableSerialize(stateAtSave);
      const name = await downloadWorkFile(stateAtSave, workSaveName);
      if (name) {
        setWorkSaveName(name);
        timelineBaselineRef.current = baselineAtSave;
      }
      setError('');
    } catch (reason) {
      setError(saveErrorMessage(reason, '作業データを保存できませんでした。もう一度お試しください。'));
    } finally {
      setBusy(false);
    }
  };

  const loadWork = async (file: File) => {
    if (workspaceMode !== 'timeline' || busy || videoProgress || !canReplaceSession()) return;
    setBusy(true);
    await restoreWorkFile(file);
  };

  const restoreWorkFile = async (file: File) => {
    try {
      // Validate the whole file before replacing any editing state; never send it to the Timeline worker.
      const saved = parseWorkFile(await file.text());
      if (abortRef.current) {
        setError('動画生成が終了してから、作業を再開してください。');
        return;
      }
      if (!confirmDiscardCurrent()) { setNotice(''); return; }
      const resumedState: TimelineWorkState = {
        ...saved, videoSettings: saved.videoSettings ?? DEFAULT_VIDEO_SETTINGS,
        selectedOutputDay: saved.selectedOutputDay ?? 'all',
        dayMarkerFramePositions: saved.dayMarkerFramePositions ?? {}, endpointMarkerFramePositions: saved.endpointMarkerFramePositions ?? {},
      };
      dispatch({ type: 'load', points: saved.points, edit: {
        dayMarkerPlacements: saved.dayMarkerPlacements, endpointMarkerPlacements: saved.endpointMarkerPlacements,
        dayMarkerFramePositions: saved.dayMarkerFramePositions ?? {}, endpointMarkerFramePositions: saved.endpointMarkerFramePositions ?? {},
        distanceHudPlacement: { x: resumedState.videoSettings!.distanceHudSettings.x, y: resumedState.videoSettings!.distanceHudSettings.y },
        legacyDayKeys: new Set(deriveDayMarkers(saved.points, saved.dayMarkerNotes, saved.startDate)
          .filter((marker) => !saved.dayMarkerFramePositions?.[marker.date!]).map((marker) => marker.date!)),
      } });
      videoPlayer.reset();
      setWorkspaceView('map');
      initialGuideShownRef.current = false;
      setWorkspaceMode('timeline');
      setSelectedOutputDay(saved.selectedOutputDay ?? 'all');
      applyVideoSettings(saved.videoSettings ?? DEFAULT_VIDEO_SETTINGS);
      setStartDate(saved.startDate);
      setEndDate(saved.endDate);
      setFrom(saved.from);
      setTo(saved.to);
      setDayMarkerNotes(saved.dayMarkerNotes);
      setAnnotationStyle(saved.annotationStyle);
      setAnimationStartPointId(saved.animationStartPointId);
      setAnimationEndPointId(saved.animationEndPointId);
      // No source index belongs to the resumed work, even if the worker retains an older import.
      setDates([]);
      setFileName(file.name);
      setWorkSaveName(file.name);
      setRawPositions([]);
      setShowRaw(false);
      setSelectedRaw(null);
      setPlanDayStarts([]);
      setPlanDayNotes({});
      setSelectedPointId(null);
      setSelectionCandidateIds([]);
      setAnnotationLabel('');
      setDayMarkerNoteInput('');
      setRangeDeletePointIds([]);
      setRangeDeleteMode(false);
      setAddMode(false);
      setInsertMode(false);
      setOpenToolbarHelpKey(null);
      setMapMode('edit');
      clearGeneratedVideo();
      setMobileDayMarkerEditingScale(1);
      setError('');
      if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current);
      routeLoadedNoticeTimerRef.current = null;
      setNotice('作業データを復元しました。元のJSONファイルなしで編集を続けられます。測位データは含まれていません。');
      timelineBaselineRef.current = stableSerialize(resumedState);
      pendingExtractionSnapshotRef.current = null;
    } catch {
      setNotice('');
      setError(WORK_FILE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async () => {
    if (workspaceMode !== 'plan' || !points.length || busy || videoProgress || !canReplaceSession()) return;
    setBusy(true);
    try {
      const resolved = await ensureMarkerPositions();
      const stateAtSave: PlanState = { ...planState, ...resolved.positions };
      const baselineAtSave = stableSerialize(stateAtSave);
      const name = await downloadPlanFile(stateAtSave, planSaveName);
      if (name) {
        setPlanSaveName(name);
        planBaselineRef.current = baselineAtSave;
      }
      setError('');
    } catch (reason) {
      setError(saveErrorMessage(reason, '計画データを保存できませんでした。もう一度お試しください。'));
    } finally {
      setBusy(false);
    }
  };

  const loadPlan = async (file: File) => {
    if (workspaceMode !== 'plan' || busy || videoProgress || !canReplaceSession()) return;
    setBusy(true);
    try {
      const saved = parsePlanFile(await file.text());
      // A video export may have started while the file was being read.
      if (abortRef.current) {
        setError('動画生成が終了してから、作業を再開してください。');
        return;
      }
      if (!confirmDiscardCurrent()) return;
      const resumedState: PlanState = {
        ...saved, videoSettings: saved.videoSettings ?? DEFAULT_VIDEO_SETTINGS,
        annotationStyle: saved.annotationStyle ?? DEFAULT_ANNOTATION_STYLE,
        animationStartPointId: saved.animationStartPointId ?? null,
        animationEndPointId: saved.animationEndPointId ?? null,
        endpointMarkerPlacements: saved.endpointMarkerPlacements ?? {},
        dayMarkerFramePositions: saved.dayMarkerFramePositions ?? {}, endpointMarkerFramePositions: saved.endpointMarkerFramePositions ?? {},
      };
      applyVideoSettings(saved.videoSettings ?? DEFAULT_VIDEO_SETTINGS);
      setAnnotationStyle(saved.annotationStyle ?? DEFAULT_ANNOTATION_STYLE);
      videoPlayer.reset();
      setWorkspaceView('map');
      initialGuideShownRef.current = false;
      setWorkspaceMode('plan');
      setSelectedOutputDay('all');
      setInsertMode(false);
      dispatch({ type: 'load', points: saved.points, edit: {
        dayMarkerPlacements: saved.dayMarkerPlacements, endpointMarkerPlacements: saved.endpointMarkerPlacements ?? {},
        dayMarkerFramePositions: saved.dayMarkerFramePositions ?? {}, endpointMarkerFramePositions: saved.endpointMarkerFramePositions ?? {},
        distanceHudPlacement: { x: resumedState.videoSettings!.distanceHudSettings.x, y: resumedState.videoSettings!.distanceHudSettings.y },
        legacyDayKeys: new Set(derivePlanDayMarkers(saved.points, saved.planDayStarts, saved.planDayNotes)
          .filter((marker) => !saved.dayMarkerFramePositions?.[marker.pointId]).map((marker) => marker.pointId)),
      } });
      setPlanDayStarts(saved.planDayStarts);
      setPlanSaveName(file.name);
      setPlanDayNotes(saved.planDayNotes);
      setSelectedPointId(null);
      setSelectionCandidateIds([]);
      setSelectedRaw(null);
      setRangeDeletePointIds([]);
      setAnimationStartPointId(saved.animationStartPointId ?? null);
      setAnimationEndPointId(saved.animationEndPointId ?? null);
      clearGeneratedVideo();
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
      planBaselineRef.current = stableSerialize(resumedState);
    } catch {
      setError(PLAN_FILE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const commitAdd = (latitude: number, longitude: number) => {
    const id = `manual-${crypto.randomUUID()}`;
    let next;
    if (workspaceMode === 'plan') next = appendPlanPoint(points, latitude, longitude, id);
    else if (!outputDay) next = addPoint(points, latitude, longitude, id);
    else {
      if (!dayFilteredPoints.length) return;
      const edited = addPoint(dayFilteredPoints, latitude, longitude, id);
      const addedIndex = edited.findIndex((point) => point.id === id);
      const previousId = edited[addedIndex - 1]?.id;
      const insertionIndex = previousId
        ? points.findIndex((point) => point.id === previousId) + 1
        : points.findIndex((point) => point.id === dayFilteredPoints[0].id);
      next = [...points.slice(0, insertionIndex), edited[addedIndex], ...points.slice(insertionIndex)];
    }
    dispatch({ type: 'commit', points: next });
    setSelectedPointId(id);
  };

  const commitMovePoint = (id: string, latitude: number, longitude: number) => {
    const point = points.find((candidate) => candidate.id === id);
    if (!point || point.latitude === latitude && point.longitude === longitude) return;
    dispatch({ type: 'commit', points: movePoint(points, id, latitude, longitude) });
  };

  const commitInsert = (latitude: number, longitude: number) => {
    if (workspaceMode !== 'plan' || !editMode || !insertMode || addMode || rangeDeleteMode || busy || videoProgress) return;
    const id = `manual-${crypto.randomUUID()}`;
    const next = insertPlanPoint(points, planDayStarts, latitude, longitude, id);
    if (!next) {
      setError('途中追加できる同一DAY内の区間がありません。');
      return;
    }
    dispatch({ type: 'commit', points: next });
    setSelectedPointId(id);
    setSelectedRaw(null);
    setError('');
  };

  const toggleInsertMode = () => {
    if (workspaceMode !== 'plan' || points.length < 2) return;
    setAddMode(false);
    setInsertMode((current) => !current);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  };

  const selectEditTool = () => {
    setAddMode(false);
    setInsertMode(false);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  };

  const toggleAddMode = () => {
    setAddMode((current) => !current);
    setInsertMode(false);
    setRangeDeleteMode(false);
    setRangeDeletePointIds([]);
  };

  const toggleRangeDeleteMode = () => {
    setAddMode(false);
    setInsertMode(false);
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
    const selectedIndex = dayFilteredPoints.findIndex((point) => point.id === selectedPointId);
    const endIndex = animationEndPointId ? dayFilteredPoints.findIndex((point) => point.id === animationEndPointId) : dayFilteredPoints.length - 1;
    if (selectedIndex < 0 || selectedIndex >= endIndex) {
      setError('開始地点は終了地点より前のポイントを選択してください。');
      return;
    }
    setError('');
    setAnimationStartPointId(selectedPointId);
  };

  const setAnimationEnd = () => {
    if (!selectedPointId) return;
    const selectedIndex = dayFilteredPoints.findIndex((point) => point.id === selectedPointId);
    const startIndex = animationStartPointId ? dayFilteredPoints.findIndex((point) => point.id === animationStartPointId) : 0;
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

  const generateVideo = async () => {
    if (busy || videoProgress || abortRef.current || videoPlayer.isEditingBalloon()) return;
    setError('');
    setBusy(true);
    videoPlayer.pause();
    let output: VideoOutputOptions;
    let snapshot: string;
    try {
      const resolved = await ensureMarkerPositions();
      output = captureVideoOutputOptions(resolved.options);
      if (output.cameraMode === 'follow') output.followCameraPlan = buildFollowCameraPlan(output.points,
        output.followZoomPreset ?? 'standard', output.duration, output.followCustomZoom, output.followViewMode);
      snapshot = createVideoOutputSnapshot(output);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : 'ルート追従の準備に失敗しました。');
      return;
    }
    setBusy(false);
    const pauseTotal = totalPauseSeconds(balloonPauseSeconds(output.points, output.dayMarkers ?? [], output.routeMarkerMode ?? 'day', output.commonPauseSeconds ?? 0));
    setVideoProgress({ current: 0, total: outputVideoFrameCount(output.duration, pauseTotal, output.preRollSeconds, output.postRollSeconds), percent: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await stopVideoPreview();
      if (controller.signal.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const blob = await renderRouteVideo({ ...output, signal: controller.signal, onProgress: setVideoProgress });
      if (controller.signal.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const url = URL.createObjectURL(blob);
      videoBlobRef.current = blob;
      setGeneratedOutputSnapshot(snapshot);
      replaceVideoUrl(url);
      setNotice(snapshot === currentOutputSnapshotRef.current ? 'MP4を生成しました。端末へ保存できます。' : 'MP4を生成しました。制作内容が変更されているため再生成が必要です。');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setNotice('動画生成をキャンセルしました。');
      else setError(reason instanceof Error ? reason.message : '動画生成に失敗しました。');
    } finally {
      abortRef.current = null;
      setVideoProgress(null);
    }
  };

  const saveVideo = async () => {
    const blob = videoBlobRef.current;
    if (busy || videoProgress || videoPlayer.isEditingBalloon()) return;
    if (!blob || blob.size === 0 || blob.type !== 'video/mp4') {
      setError('保存できるMP4データがありません。MP4を生成し直してください。');
      return;
    }
    if (generatedOutputSnapshot !== currentOutputSnapshotRef.current) {
      setError('再生成が必要です。MP4を再生成してから保存してください。');
      return;
    }
    setBusy(true);
    try {
      await saveBlobWithPicker(blob, {
        suggestedName: `route-${startDate}${endDate !== startDate ? `-${endDate}` : ''}.mp4`,
        mimeType: 'video/mp4', extension: '.mp4',
      });
      setError('');
    } catch (reason) {
      setError(saveErrorMessage(reason, 'MP4を保存できませんでした。もう一度お試しください。'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header ref={topbarRef} className={`topbar${compactMobileHeader ? ' topbar--compact-mobile' : ''}`}>
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}journey-map-studio-logo.png`} alt="Journey Map Studio" />
        <div className="mobile-compact-header">
          <div className="mobile-brand-copy"><strong>Journey Map Studio</strong><span>{currentWorkspaceModeCopy.title}</span></div>
          <div className="mobile-mode-menu-wrap">
            <button className="mobile-mode-trigger" type="button" aria-expanded={mobileModeMenuOpen} aria-controls="mobile-mode-menu"
              onClick={() => setMobileModeMenuOpen((open) => !open)}>モード <span aria-hidden="true">{mobileModeMenuOpen ? '▴' : '▾'}</span></button>
            <HelpTip helpKey="mobileModeMenu" />
            {mobileModeMenuOpen && <div className="mobile-mode-menu" id="mobile-mode-menu" aria-label="制作モード">
              <button type="button" className="mobile-mode-option" aria-current={workspaceMode === 'timeline' ? 'page' : undefined}
                disabled={busy || !!videoProgress} onClick={() => { setMobileModeMenuOpen(false); fileInputRef.current?.click(); }}>
                <span>{WORKSPACE_MODE_COPY.timeline.title}</span><small>{WORKSPACE_MODE_COPY.timeline.description}</small>
              </button>
              <button type="button" className="mobile-mode-option" aria-current={workspaceMode === 'plan' ? 'page' : undefined}
                disabled={workspaceMode === 'plan' || busy || !!videoProgress} onClick={() => { setMobileModeMenuOpen(false); startPlanMode(); }}>
                <span>{WORKSPACE_MODE_COPY.plan.title}</span><small>{WORKSPACE_MODE_COPY.plan.description}</small>
              </button>
              <button type="button" className="mobile-mode-option" aria-current={workspaceMode === 'spot' ? 'page' : undefined}
                disabled={workspaceMode === 'spot' || busy || !!videoProgress} onClick={() => { setMobileModeMenuOpen(false); startSpotMode(); }}>
                <span>{WORKSPACE_MODE_COPY.spot.title}</span><small>{WORKSPACE_MODE_COPY.spot.description}</small>
              </button>
            </div>}
          </div>
        </div>
        <div className="topbar-actions">
          <button className="file-button" onClick={() => fileInputRef.current?.click()} disabled={busy || !!videoProgress}>
            <span>{WORKSPACE_MODE_COPY.timeline.title}</span><small>{WORKSPACE_MODE_COPY.timeline.description}</small>
          </button>
          <button className="file-button plan-button" onClick={startPlanMode} disabled={workspaceMode === 'plan' || busy || !!videoProgress}>
            <span>{WORKSPACE_MODE_COPY.plan.title}</span><small>{WORKSPACE_MODE_COPY.plan.description}</small>
          </button>
          <button className="file-button" onClick={startSpotMode} disabled={workspaceMode === 'spot' || busy || !!videoProgress}>
            <span>{WORKSPACE_MODE_COPY.spot.title}</span><small>{WORKSPACE_MODE_COPY.spot.description}</small>
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.currentTarget.value = ''; }} />
      </header>

      <section className="privacy-note"><span>●</span> 位置履歴JSONは端末内でのみ処理され、外部へ送信されません</section>

      {workspaceMode === 'spot' ? <SpotWorkspace onBusy={setBusy} onDirtyChange={setSpotHasUnsavedChanges} /> : <div className="workspace">
        <MobileBottomSheet resetKey={workspaceMode} steps={[workspaceMode === 'plan' ? '旅のルートを準備する' : '旅のデータを準備する', 'ルートや地点を編集する', '動画を確認・出力する']}>
          <section className="panel-section source-section" inert={busy || !!videoProgress}>
            {workspaceMode === 'timeline' ? <>
            <div className="section-heading"><span className="step">01</span><div><h2>旅のデータを準備する</h2><p>{fileName || 'GoogleマップからエクスポートしたJSONファイルを読み込んでください'}</p></div></div>
            <div className="date-grid">
              <label>開始日<input type="date" value={startDate} min={minAvailableDate} max={maxAvailableDate} disabled={!dates.length || busy} onChange={(event) => {
                const value = event.target.value;
                setStartDate(value);
                setEndDate(value);
              }} /></label>
              <label>終了日<input type="date" value={endDate} min={minAvailableDate} max={maxAvailableDate} disabled={!dates.length || busy} onChange={(event) => setEndDate(event.target.value)} /></label>
            </div>
            <div className="select-label">
              <div className="control-label-with-help"><label htmlFor="output-day">表示・出力する日程</label><HelpTip helpKey="outputDay" /></div>
              <select id="output-day" value={selectedOutputDay} disabled={!points.length || busy || !!videoProgress}
                onChange={(event) => changeOutputDay(event.currentTarget.value)}>
                <option value="all">全日程</option>
                {dayMarkers.filter((marker) => marker.date).map((marker) => <option key={marker.date} value={marker.date}>
                  Day {marker.dayNumber}（{marker.date!.replaceAll('-', '/')}）
                </option>)}
              </select>
            </div>
            <div className="time-grid">
              <label>From<input type="time" value={from} disabled={!dates.length || busy} onChange={(event) => setFrom(event.target.value)} /></label>
              <span className="time-arrow">→</span>
              <label>To<input type="time" value={to} disabled={!dates.length || busy} onChange={(event) => setTo(event.target.value)} /></label>
            </div>
            <div className="control-label-with-help range-help"><p className="range-note">※ 開始日のFromから、終了日のToまでを読み込みます。</p><HelpTip helpKey="timelineRange" /></div>
            <button className="secondary-button wide" disabled={!dates.length || !startDate || !endDate || busy} onClick={() => extract()}>この範囲を読み込む</button>
            <div className="control-label-with-help range-help"><p className="range-note">編集中の作業を保存・再開</p><HelpTip helpKey="timelineWork" /></div>
            <button className="secondary-button wide" disabled={!points.length || busy || !!videoProgress} onClick={saveWork}>作業を保存</button>
            <button className="secondary-button wide" disabled={busy || !!videoProgress} onClick={() => workFileInputRef.current?.click()}>作業を再開</button>
            <input ref={workFileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void loadWork(file);
            }} />
            </> : <>
              <div className="section-heading"><span className="step">01</span><div><h2>旅のルートを準備する</h2><p>地図をクリックした順にポイントを追加します</p></div></div>
              <p className="range-note">「編集」→「連続追加」で地点を追加できます。</p>
              <button className="secondary-button wide" disabled={!points.length || busy || !!videoProgress} onClick={savePlan}>作業を保存</button>
              <button className="secondary-button wide" disabled={busy || !!videoProgress} onClick={() => planFileInputRef.current?.click()}>作業を再開</button>
              <input ref={planFileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void loadPlan(file);
              }} />
            </>}
          </section>

          <section className="panel-section" inert={busy || !!videoProgress}>
            <div className="section-heading"><span className="step">02</span><div><h2>ルートや地点を編集する</h2><p>必要に応じて修正できます。{dayFilteredPoints.length ? `${dayFilteredPoints.length}ポイント · ${workspaceMode === 'plan' ? '約 ' : ''}${formatDistance(distance)}` : 'ルートは未選択です'}</p></div></div>
            <div className="control-label-with-help control-with-help">
              <div className="mode-switch">
                <button className={mapMode === 'display' ? 'active' : ''} disabled={!!videoPlayer.editingBalloonId} onClick={() => { if (videoPlayer.isEditingBalloon()) return; setWorkspaceView('map'); setMapMode('display'); setAddMode(false); setInsertMode(false); setRangeDeleteMode(false); setRangeDeletePointIds([]); }}>表示</button>
                <button className={editMode ? 'active' : ''} disabled={!!videoPlayer.editingBalloonId} onClick={() => { if (videoPlayer.isEditingBalloon()) return; setWorkspaceView('map'); setMapMode('edit'); }}>編集</button>
                <button className={animationRangeMode ? 'active' : ''} disabled={!!videoPlayer.editingBalloonId} onClick={() => { if (videoPlayer.isEditingBalloon()) return; setWorkspaceView('map'); setMapMode('animation-range'); setAddMode(false); setInsertMode(false); setRangeDeleteMode(false); setRangeDeletePointIds([]); }}>アニメ範囲</button>
              </div>
              <HelpTip helpKey="mapMode" />
            </div>
            {planDistances && <div className="detail-card">
              <strong>概算距離</strong>
              {planDistances.days.map((day) => <span key={day.pointId}>DAY {day.dayNumber}　約 {formatDistance(day.distanceMeters)}</span>)}
              <strong>合計　約 {formatDistance(planDistances.totalMeters)}</strong>
              <span>※ ポイント間の地表上の直線距離の合計です。道路に沿った走行距離ではありません。</span>
            </div>}
            {workspaceMode === 'timeline' && <div className="control-label-with-help control-label-with-help--toggle"><label className="toggle-row"><span><strong>測位データを表示</strong><small>ルート補正用の参考データ</small></span><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} /><i /></label><HelpTip helpKey="rawSignals" /></div>}
            {selectedPoint && <div className="detail-card"><strong>選択中のルートポイント</strong><span>全{points.length}点中 {selectedPointIndex + 1}番目</span><span>{selectedPoint.source === 'manual' ? '手動追加' : 'Googleマップから読み込み'}</span><code>{selectedPoint.latitude.toFixed(6)}, {selectedPoint.longitude.toFixed(6)}</code>{selectedPoint.timestamp && <time>{formatTimestamp(selectedPoint.timestamp)}</time>}
              {showSelectionCandidateSwitcher && <div className="selection-candidate-switcher">
                <button type="button" aria-label="前の候補" onClick={() => selectAdjacentCandidate(-1)}>‹</button>
                <span>候補 {selectionCandidateIndex + 1} / {selectionCandidateIds.length}</span>
                <button type="button" aria-label="次の候補" onClick={() => selectAdjacentCandidate(1)}>›</button>
              </div>}
              {editMode && <>
                {(selectedPoint.annotation?.placement || selectedPoint.annotation?.framePosition) && <button className="secondary-button" onClick={() => setAnnotationPlacement(selectedPoint.id)}>バルーン位置をリセット</button>}
                {selectedDayMarker?.placement && <button className="secondary-button" onClick={() => setDayPlacement(selectedPoint.id)}>DAY位置をリセット</button>}
                {selectedPoint.id === animationPoints[0]?.id && endpointMarkerPlacements.START && <button className="secondary-button" onClick={() => setEndpointPlacement('START')}>START位置をリセット</button>}
                {selectedPoint.id === animationPoints.at(-1)?.id && endpointMarkerPlacements.GOAL && <button className="secondary-button" onClick={() => setEndpointPlacement('GOAL')}>GOAL位置をリセット</button>}
              </>}
              {selectedPoint.annotation?.label && <div className="control-label-with-help">
                <button type="button" className="secondary-button" disabled={busy || !!videoProgress || !!videoPlayer.editingBalloonId} onClick={openSelectedBalloonInVideo}>映像で確認</button>
                <HelpTip helpKey="videoBalloonEditing" />
              </div>}
              {editMode && <div className="annotation-editor">
                <div className="control-label-with-help"><label htmlFor="annotation-label">地点ラベル（最大30文字）</label><HelpTip helpKey="pointLabel" /></div>
                <input id="annotation-label" type="text" value={annotationLabel} onChange={(event) => setAnnotationLabel(event.currentTarget.value)} onKeyDown={(event) => {
                  // Text editing keeps its own Undo/Redo instead of changing route history.
                  event.stopPropagation();
                }} placeholder="マップに表示する内容" />
                <button className="secondary-button" disabled={!annotationLabel.trim() || Array.from(annotationLabel.trim()).length > 30} onClick={saveAnnotation}>{selectedPoint.annotation ? '変更' : 'バルーンを設定'}</button>
                {selectedPoint.annotation && <button className="secondary-button" onClick={removeAnnotation}>バルーンを削除</button>}
              </div>}
              {workspaceMode === 'plan' && editMode && <div className="day-marker-editor plan-day-editor">
                <div className="control-label-with-help"><strong>計画DAY</strong><HelpTip helpKey="planDay" /></div>
                {!selectedDayMarker && <button className="secondary-button" onClick={() => setPlanDayStarts((current) => [...new Set([...current, selectedPoint.id])])}>ここからDAY {selectedPlanDayNumber}</button>}
                {selectedDayMarker && selectedPoint.id !== points[0]?.id && <button className="secondary-button" onClick={() => setPlanDayStarts((current) => current.filter((id) => id !== selectedPoint.id))}>DAY {selectedDayMarker.dayNumber}設定を解除</button>}
              </div>}
              {editMode && (workspaceMode === 'plan' || routeMarkerMode === 'day') && selectedDayMarker && <div className="day-marker-editor">
                <strong>DAY {selectedDayMarker.dayNumber}{selectedDayMarker.date && ` · ${selectedDayMarker.date.replaceAll('-', '.')}`}</strong>
                <div className="mobile-day-editing-size">
                  <div className="control-label-with-help">
                    <label htmlFor="day-editing-scale">DAY編集表示サイズ　{Math.round(mobileDayMarkerEditingScale * 100)}%</label>
                    <HelpTip helpKey="dayEditingScale" />
                  </div>
                  <input id="day-editing-scale" type="range" min="75" max="175" step="25"
                    value={mobileDayMarkerEditingScale * 100} disabled={!!videoProgress}
                    onChange={(event) => setMobileDayMarkerEditingScale(Number(event.target.value) / 100)} />
                  <small>編集画面のみ。動画サイズには影響しません</small>
                </div>
                <label htmlFor="day-marker-note">{workspaceMode === 'plan' ? 'DAY' : '日付'}マーカーの補足（最大40文字）</label>
                <input id="day-marker-note" type="text" value={dayMarkerNoteInput} onChange={(event) => setDayMarkerNoteInput(event.currentTarget.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="○○ホテル" />
                <button className="secondary-button" disabled={!dayMarkerNoteInput.trim() || Array.from(dayMarkerNoteInput.trim()).length > 40} onClick={saveDayMarkerNote}>{selectedDayMarker.note ? '変更' : '設定'}</button>
                {selectedDayMarker.note && <button className="secondary-button" onClick={removeDayMarkerNote}>削除</button>}
              </div>}
            </div>}
            {animationRangeMode && <div className="detail-card animation-range-card">
              <div className="control-label-with-help"><strong>アニメーション範囲</strong><HelpTip helpKey="animationRange" /></div>
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

          <section className="panel-section video-section"
            onFocusCapture={() => { if (showingVideo && videoPlayer.playbackStatus === 'playing') videoPlayer.pause(); }}
            onPointerDownCapture={() => { if (showingVideo && videoPlayer.playbackStatus === 'playing') videoPlayer.pause(); }}>
            <div className="section-heading"><span className="step">03</span><div><h2>動画を確認・出力する</h2><p>地図からそのままMP4を生成できます。FHD · 30fps · MP4（H.264）</p></div></div>
            <div className="video-camera-controls" inert={busy || !!videoProgress || !!videoPlayer.editingBalloonId}>
              <div className="control-label-with-help"><label>動画のカメラ</label><HelpTip helpKey="cameraMode" /></div>
              <div className="video-mode-options">
                <button className={cameraMode === 'overview' ? 'active' : ''} aria-pressed={cameraMode === 'overview'} disabled={!!videoProgress} onClick={() => setCameraMode('overview')}>全体表示</button>
                <button className={cameraMode === 'follow' ? 'active' : ''} aria-pressed={cameraMode === 'follow'} disabled={!!videoProgress} onClick={() => setCameraMode('follow')}>ルート追従</button>
              </div>
              {cameraMode === 'overview' && <>
                <div className="control-label-with-help"><label>表示範囲</label><HelpTip helpKey="overviewZoom" /></div>
                <div className="video-mode-options">
                  {(['auto', 'custom'] as const).map((mode) => <button key={mode} className={overviewZoomMode === mode ? 'active' : ''} aria-pressed={overviewZoomMode === mode} disabled={!!videoProgress} onClick={() => setOverviewZoomMode(mode)}>{mode === 'auto' ? '自動' : 'カスタム'}</button>)}
                </div>
              </>}
              {cameraMode === 'follow' && <>
                <div className="control-label-with-help"><label>追従視点</label><HelpTip helpKey="followView" /></div>
                <div className="video-mode-options">
                  {([['top', '真上'], ['oblique', '斜め']] as const).map(([mode, label]) => <button key={mode} className={followViewMode === mode ? 'active' : ''} aria-pressed={followViewMode === mode} disabled={!!videoProgress} onClick={() => setFollowViewMode(mode)}>{label}</button>)}
                </div>
                <div className="control-label-with-help"><label>表示範囲</label><HelpTip helpKey="followZoom" /></div>
                <div className="follow-zoom-options">
                  {([['wide', '広め'], ['standard', '標準'], ['close', '寄り'], ['custom', 'カスタム']] as const).map(([preset, label]) => <button key={preset} className={followZoomPreset === preset ? 'active' : ''} aria-pressed={followZoomPreset === preset} disabled={!!videoProgress} onClick={() => setFollowZoomPreset(preset)}>{label}</button>)}
                </div>
              </>}
              {((cameraMode === 'overview' && overviewZoomMode === 'custom') || (cameraMode === 'follow' && followZoomPreset === 'custom')) && <label className="custom-zoom-number">
                Zoom
                <input type="number" inputMode="decimal" min="4" max="16" step="0.1"
                  value={cameraMode === 'overview' ? overviewCustomZoomInput : followCustomZoomInput}
                  disabled={!!videoProgress}
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
              <div className="control-label-with-help"><label>地点マーカー</label><HelpTip helpKey="routeMarker" /></div>
              <div className="route-marker-options">
                {([['day', 'DAY'], ['start-goal', 'START / GOAL'], ['none', 'なし']] as const).map(([mode, label]) => <button key={mode} className={routeMarkerMode === mode ? 'active' : ''} aria-pressed={routeMarkerMode === mode} disabled={!!videoProgress} onClick={() => setRouteMarkerMode(mode)}>{label}</button>)}
              </div>
              <div className="control-label-with-help control-label-with-help--toggle">
                <label className="toggle-row"><span><strong>開始時ズーム</strong><small>MP4の冒頭で、広域表示から設定した画角へズームします。</small></span><input type="checkbox" checked={introZoomEnabled} disabled={!!videoProgress} onChange={(event) => setIntroZoomEnabled(event.target.checked)} /><i /></label>
                <HelpTip helpKey="introZoom" />
              </div>
              <p className="range-note">※ 開始時ズームはMP4出力時のみ反映されます。映像タブでは処理負荷を抑えるため、ズーム後の画角で静止表示します。</p>
              <div className="control-label-with-help control-label-with-help--toggle">
                <label className="toggle-row"><span><strong>DAYごとにルートを色分け</strong><small>ルート線・DAYマーカー・走行距離を同じ色で表示</small></span><input type="checkbox" checked={dayRouteColorsEnabled} disabled={!!videoProgress} onChange={(event) => setDayRouteColorsEnabled(event.target.checked)} /><i /></label>
                <HelpTip helpKey="dayRouteColors" />
              </div>
            </div>
            {recordedTimeAvailable && <div className="control-label-with-help control-label-with-help--toggle" inert={busy || !!videoProgress || !!videoPlayer.editingBalloonId}>
              <label className="toggle-row"><span><strong>実績時刻を表示</strong></span><input type="checkbox" checked={recordedTimeClockEnabled}
                disabled={!!videoProgress} onChange={(event) => setRecordedTimeClockEnabled(event.target.checked)} /><i /></label>
              <HelpTip helpKey="recordedTimeClock" />
            </div>}
            <div className="duration-controls" inert={busy || !!videoProgress || !!videoPlayer.editingBalloonId}>
              <div className="control-label-with-help"><label htmlFor="video-duration-range">移動時間</label><HelpTip helpKey="movementDuration" /></div>
              <input id="video-duration-range" type="range" min="5" max="120" step="1" value={duration} disabled={!!videoProgress} onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setDuration(value);
                setDurationInput(String(value));
              }} />
              <div className="duration-limits"><span>5秒</span><span>120秒</span></div>
              <label className="duration-number" htmlFor="video-duration-number">
                <input id="video-duration-number" aria-label="移動時間（秒）" type="number" inputMode="numeric" min="5" max="120" step="1" value={durationInput} disabled={!!videoProgress} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDurationInput(value);
                  if (value !== '' && Number.isFinite(Number(value))) setDuration(Math.min(120, Math.max(5, Math.round(Number(value)))));
                }} onBlur={() => setDurationInput(String(duration))} />
                秒
              </label>
              <div className="control-label-with-help"><label htmlFor="common-pause-seconds">バルーン表示時の停止</label><HelpTip helpKey="balloonPause" /></div>
              <label className="duration-number" htmlFor="common-pause-seconds">
                <input id="common-pause-seconds" type="number" inputMode="decimal" min="0" max="30" step="0.5"
                  value={commonPauseInput} disabled={!!videoProgress}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCommonPauseInput(value);
                    if (value.trim() && Number.isFinite(Number(value))) setCommonPauseSeconds(normalizePauseSeconds(Number(value)));
                  }} onBlur={() => setCommonPauseInput(commonPauseSeconds.toFixed(1))}
                  onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
                秒
              </label>
              <div className="control-label-with-help"><label htmlFor="pre-roll-seconds">開始前の時間</label><HelpTip helpKey="videoHoldTimes" /></div>
              <label className="duration-number" htmlFor="pre-roll-seconds">
                <input id="pre-roll-seconds" type="number" inputMode="decimal" min="0" max="30" step="0.5"
                  value={preRollInput} disabled={!!videoProgress}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setPreRollInput(value);
                    if (value.trim() && Number.isFinite(Number(value))) setPreRollSeconds(normalizePauseSeconds(Number(value)));
                  }} onBlur={() => setPreRollInput(preRollSeconds.toFixed(1))}
                  onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
                秒
              </label>
              <div className="control-label-with-help"><label htmlFor="post-roll-seconds">到着後の停止</label><HelpTip helpKey="videoHoldTimes" /></div>
              <label className="duration-number" htmlFor="post-roll-seconds">
                <input id="post-roll-seconds" type="number" inputMode="decimal" min="0" max="30" step="0.5"
                  value={postRollInput} disabled={!!videoProgress}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setPostRollInput(value);
                    if (value.trim() && Number.isFinite(Number(value))) setPostRollSeconds(normalizePauseSeconds(Number(value)));
                  }} onBlur={() => setPostRollInput(postRollSeconds.toFixed(1))}
                  onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
                秒
              </label>
              <div className="video-duration-note">
                <span>移動時間: {duration}秒</span>
                <span>地点停止: 合計{animationPauseSeconds}秒</span>
                <span>開始前: {preRollSeconds}秒</span>
                <span>到着後: {postRollSeconds}秒</span>
                <span>出力時間: {outputVideoDuration(duration, animationPauseSeconds, preRollSeconds, postRollSeconds)}秒</span>
                <span>※ 出力時間には、移動時間に加えて地点停止・開始前・到着後の時間が含まれます。</span>
              </div>
            </div>
            <div className="distance-hud-controls" inert={busy || !!videoProgress || !!videoPlayer.editingBalloonId}>
              <div className="control-label-with-help control-label-with-help--toggle">
                <label className="toggle-row"><span><strong>走行距離表示</strong></span><input type="checkbox" checked={distanceHudSettings.enabled}
                  disabled={!!videoProgress}
                  onChange={(event) => setDistanceHudOptions((current) => ({ ...current, enabled: event.target.checked }))} /><i /></label>
                <HelpTip helpKey="distanceHud" />
              </div>
              {distanceHudSettings.enabled && distanceHudModel && <>
                <label className="distance-hud-size">サイズ <span>{Math.round(distanceHudSettings.scale * 100)}%</span>
                  <input type="range" min="50" max="200" step="10" value={Math.round(distanceHudSettings.scale * 100)}
                    disabled={!!videoProgress}
                    onChange={(event) => setDistanceHudOptions((current) => ({ ...current, scale: Number(event.target.value) / 100 }))} />
                </label>
                <button className="secondary-button wide" disabled={!!videoProgress}
                  onClick={() => dispatch({ type: 'commit', edit: { distanceHudPlacement:
                    clampDistanceHudPlacement(DEFAULT_VIDEO_SETTINGS.distanceHudSettings, distanceHudLayout(distanceHudModel, distanceHudSettings.scale)) } })}>位置をリセット</button>
                <p className="range-note">地図上のHUDをドラッグして位置を変更できます。</p>
              </>}
            </div>
            <div className="annotation-style-controls" inert={busy || !!videoProgress || !!videoPlayer.editingBalloonId}>
              <h3>バルーン表示</h3>
              <div className="annotation-style-item">
                <div className="control-label-with-help">
                  <label htmlFor="annotation-font-scale">文字サイズ <span className="annotation-style-value">{Math.round(annotationStyle.fontScale * 100)}%</span></label>
                  <HelpTip helpKey="balloonFontScale" />
                </div>
                <input id="annotation-font-scale" type="range" min="50" max="200" step="10" value={Math.round(annotationStyle.fontScale * 100)} disabled={busy || !!videoProgress}
                  onChange={(event) => setAnnotationStyle((current) => ({ ...current, fontScale: Number(event.target.value) / 100 }))} />
              </div>
              <div className="annotation-style-item">
                <div className="control-label-with-help">
                  <label htmlFor="annotation-minimum-width">バルーンの最小幅 <span className="annotation-style-value">{annotationStyle.minimumWidth ?? DEFAULT_ANNOTATION_STYLE.minimumWidth}px</span></label>
                  <HelpTip helpKey="balloonMinimumWidth" />
                </div>
                <input id="annotation-minimum-width" type="range" min="160" max="440" step="10" value={annotationStyle.minimumWidth ?? DEFAULT_ANNOTATION_STYLE.minimumWidth} disabled={busy || !!videoProgress}
                  onChange={(event) => setAnnotationStyle((current) => ({ ...current, minimumWidth: Number(event.target.value) }))} />
                <div className="annotation-minimum-targets" role="group" aria-label="最小幅の適用対象">
                  <label><input type="checkbox" checked={annotationStyle.minimumWidthForDay ?? false} disabled={busy || !!videoProgress}
                    onChange={(event) => setAnnotationStyle((current) => ({ ...current, minimumWidthForDay: event.target.checked }))} />DAYマーカー</label>
                  <label><input type="checkbox" checked={annotationStyle.minimumWidthForBalloon ?? false} disabled={busy || !!videoProgress}
                    onChange={(event) => setAnnotationStyle((current) => ({ ...current, minimumWidthForBalloon: event.target.checked }))} />通常バルーン</label>
                </div>
              </div>
            </div>
            <button className="preview-button" disabled={busy || !!videoProgress || !!videoPlayer.editingBalloonId || animationPoints.length < 2} onClick={openVideoWorkspace}>映像で確認</button>
            <button className="generate-button" disabled={animationPoints.length < 2 || busy || !!videoProgress || !!videoPlayer.editingBalloonId} onClick={() => void generateVideo()}>{videoNeedsRegeneration ? 'MP4を再生成' : 'MP4を生成'}</button>
            {videoProgress && <div className="progress-card"><div><strong>動画生成中</strong><span>{videoProgress.current} / {videoProgress.total} frames</span></div><b>{videoProgress.percent}%</b><progress max="100" value={videoProgress.percent} /><button onClick={() => abortRef.current?.abort()}>キャンセル</button></div>}
            {videoNeedsRegeneration && <p className="range-note" role="status"><strong>再生成が必要</strong><br />制作内容が変更されました。MP4を再生成してください。</p>}
            {videoUrl && <button className="download-button" disabled={busy || !!videoProgress || !!videoPlayer.editingBalloonId || videoNeedsRegeneration} onClick={() => void saveVideo()}>MP4を保存</button>}
          </section>
        </MobileBottomSheet>

        <div className="map-area">
        {canShowVideo && <div className="workspace-view-bar">
          <div className="workspace-view-buttons" role="group" aria-label="作業画面">
            <button type="button" aria-pressed={!showingVideo} disabled={busy || !!videoProgress || !!videoPlayer.editingBalloonId}
              onClick={() => { if (videoPlayer.isEditingBalloon()) return; if (showingVideo) { void stopVideoPreview(); setWorkspaceView('map'); } }}>地図</button>
            <button type="button" aria-pressed={showingVideo} disabled={busy || !!videoProgress || !!videoPlayer.editingBalloonId}
              onClick={() => { if (videoPlayer.isEditingBalloon()) return; if (!showingVideo) openVideoWorkspace(); }}>映像</button>
          </div>
          <span className="workspace-view-role">{showingVideo ? '完成映像を確認・調整' : 'ルートと地点を編集'}</span>
          <HelpTip helpKey="workspaceView" />
        </div>}
        <div className="workspace-display">
        <div className={`map-edit-view${showingVideo ? ' map-edit-view--hidden' : ''}`} inert={showingVideo || busy || !!videoProgress} aria-hidden={showingVideo || undefined}>
        <div id="plan-coordinate-jump" />
        <section className="map-stage">
          <RouteMap onMarkerProjectorReady={onMarkerProjectorReady} balloonMigrationPoints={points} balloonFollowCameraPlan={balloonFollowCamera} onBalloonFramePosition={setBalloonFramePosition} onResolveBalloonPositions={resolveBalloonPositions} coordinateJumpEnabled={workspaceMode === 'plan'} coordinateJumpDisabled={busy || !!videoProgress} mobileDayMarkerEditingScale={mobileDayMarkerEditingScale} insertMode={workspaceMode === 'plan' && editMode && insertMode} onInsertPoint={commitInsert} distanceHud={distanceHud} distanceHudDraggable={!showingVideo && !videoProgress && !busy} distanceHudDragResetKey={history.present} onDistanceHudPlacement={(placement) => dispatch({ type: 'commit', edit: { distanceHudPlacement: placement } })} endpointMarkerPlacements={endpointMarkerPlacements} onAnnotationPlacement={setAnnotationPlacement} onDayPlacement={setDayPlacement} onEndpointPlacement={setEndpointPlacement} overviewCamera={overviewCamera} autoFitRouteChanges={workspaceMode === 'timeline'} annotationStyle={annotationStyle} dayMarkers={visibleDayMarkers} dayNumberByPointId={visibleDayNumbers} points={dayFilteredPoints} animationPoints={animationPoints} rawPositions={visibleRawPositions} showRaw={showRaw} editMode={editMode} animationRangeMode={animationRangeMode} addMode={addMode} rangeDeleteMode={rangeDeleteMode} rangeDeletePointIds={rangeDeletePointIds} routeMarkerMode={routeMarkerMode} selectedPointId={selectedPointId} cameraMode={cameraMode} onSelectPoint={(id) => { setSelectedPointId(id); setSelectedRaw(null); }} onSelectionCandidates={setSelectionCandidateIds} onSelectRaw={(point) => { setSelectedRaw(point); setSelectedPointId(null); setSelectionCandidateIds([]); }} onAddPoint={commitAdd} onMovePoint={commitMovePoint} onRangeDeleteSelection={setRangeDeletePointIds} onError={setError} />
          {workspaceMode === 'timeline' && !points.length && <div className="empty-map"><div className="empty-route-icon">⌁</div><h2>旅の道筋を、アニメーションに</h2><p>GoogleマップからエクスポートしたJSONファイルを読み込み、<br />移動履歴をアニメーションに。新しいルートの作成やスポット情報の画像作成も。</p><div className="empty-map-actions"><button className="empty-json-button" onClick={() => fileInputRef.current?.click()}>
  <span>{WORKSPACE_MODE_COPY.timeline.title}</span>
  <small>{WORKSPACE_MODE_COPY.timeline.description}</small>
</button><button className="plan-button" onClick={startPlanMode} disabled={busy || !!videoProgress}><span>{WORKSPACE_MODE_COPY.plan.title}</span><small>{WORKSPACE_MODE_COPY.plan.description}</small></button><button className="plan-button" onClick={startSpotMode} disabled={busy || !!videoProgress}><span>{WORKSPACE_MODE_COPY.spot.title}</span><small>{WORKSPACE_MODE_COPY.spot.description}</small></button></div></div>}
          {editMode && <nav className="edit-toolbar" aria-label="ルート編集">
            <span className="edit-toolbar-item"><button className={!addMode && !insertMode && !rangeDeleteMode ? 'active' : ''} onClick={selectEditTool}><span>⌖</span>選択</button>{workspaceMode === 'plan' && <HelpTip helpKey="planSelect" variant="toolbar" open={openToolbarHelpKey === 'planSelect'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planSelect' : null)} />}</span>
            <span className="edit-toolbar-item"><button className={addMode ? 'active' : ''} onClick={toggleAddMode}><span>＋</span>連続追加</button>{workspaceMode === 'plan' && <HelpTip helpKey="planAppend" variant="toolbar" open={openToolbarHelpKey === 'planAppend'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planAppend' : null)} />}</span>
            {workspaceMode === 'plan' && <span className="edit-toolbar-item"><button className={insertMode ? 'active' : ''} disabled={points.length < 2} onClick={toggleInsertMode}><span>⊕</span>途中追加</button><HelpTip helpKey="planInsert" variant="toolbar" open={openToolbarHelpKey === 'planInsert'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planInsert' : null)} /></span>}
            <span className="edit-toolbar-item"><button className={rangeDeleteMode ? 'active' : ''} onClick={toggleRangeDeleteMode}><span>▧</span>範囲削除</button>{workspaceMode === 'plan' && <HelpTip helpKey="planRangeDelete" variant="toolbar" open={openToolbarHelpKey === 'planRangeDelete'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planRangeDelete' : null)} />}</span>
            {rangeDeleteMode && <button disabled={!rangeDeletePointIds.length} onClick={commitRangeDelete}><span>⌫</span>{rangeDeletePointIds.length ? `${rangeDeletePointIds.length}点削除` : '選択を削除'}</button>}
            <span className="edit-toolbar-item"><button disabled={!selectedPoint} onClick={() => { if (selectedPointId) dispatch({ type: 'commit', points: deletePoint(points, selectedPointId) }); setSelectedPointId(null); setSelectionCandidateIds([]); }}><span>⌫</span>削除</button>{workspaceMode === 'plan' && <HelpTip helpKey="planDeletePoint" variant="toolbar" open={openToolbarHelpKey === 'planDeletePoint'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planDeletePoint' : null)} />}</span>
            <i />
            <span className="edit-toolbar-item"><button disabled={!history.past.length} onClick={() => { dispatch({ type: 'undo' }); setRangeDeletePointIds([]); }}><span>↶</span>元に戻す</button>{workspaceMode === 'plan' && <HelpTip helpKey="planUndo" variant="toolbar" open={openToolbarHelpKey === 'planUndo'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planUndo' : null)} />}</span>
            <span className="edit-toolbar-item"><button disabled={!history.future.length} onClick={() => { dispatch({ type: 'redo' }); setRangeDeletePointIds([]); }}><span>↷</span>やり直す</button>{workspaceMode === 'plan' && <HelpTip helpKey="planRedo" variant="toolbar" open={openToolbarHelpKey === 'planRedo'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planRedo' : null)} />}</span>
            <span className="edit-toolbar-item"><button disabled={workspaceMode === 'plan' ? !points.length : !history.initial.points.length} onClick={() => { dispatch({ type: 'reset' }); setSelectedPointId(null); setRangeDeletePointIds([]); }}><span>↺</span>初期状態</button>{workspaceMode === 'plan' && <HelpTip helpKey="planReset" variant="toolbar" open={openToolbarHelpKey === 'planReset'} onOpenChange={(open) => setOpenToolbarHelpKey(open ? 'planReset' : null)} />}</span>
          </nav>}
        </section>
        </div>
        {showingVideo && <VideoWorkspace player={videoPlayer} suspended={!!videoProgress} generationProgress={videoProgress} editingDisabled={busy || !!videoProgress}
          selectedPointId={selectedPointId} annotationStyle={annotationStyle} onSelectBalloon={selectVideoBalloon}
          onClearSelection={() => { setSelectedPointId(null); setSelectedRaw(null); setSelectionCandidateIds([]); }}
          onCommitBalloon={setBalloonFramePosition} onCommitMarker={commitVideoMarker}
          canUndo={!!history.past.length} canRedo={!!history.future.length}
          onUndo={() => { dispatch({ type: 'undo' }); setRangeDeletePointIds([]); }} onRedo={() => { dispatch({ type: 'redo' }); setRangeDeletePointIds([]); }} />}
        {busy && <div className="loading-overlay"><span className="spinner" />端末内で処理しています…</div>}
        {(error || notice) && <div className={`toast ${error ? 'toast--error' : ''}`} role="status"><span>{error ? '!' : '✓'}</span><p>{error || notice}</p><button aria-label="閉じる" onClick={() => { setError(''); setNotice(''); if (routeLoadedNoticeTimerRef.current !== null) window.clearTimeout(routeLoadedNoticeTimerRef.current); routeLoadedNoticeTimerRef.current = null; }}>×</button></div>}
        </div>
        </div>
      </div>}
    </main>
  );
}

function RawDetail({ point, onClose }: { point: RawPosition; onClose: () => void }) {
  return <div className="detail-card raw-detail"><button onClick={onClose} aria-label="閉じる">×</button><strong>参考測位点</strong><time>{formatTimestamp(point.timestamp)}</time>{point.source && <span>測位方法: {point.source}</span>}{point.accuracyMeters !== undefined && <span>測位精度: {point.accuracyMeters} m</span>}{point.altitudeMeters !== undefined && <span>高度: {point.altitudeMeters} m</span>}{point.speedMetersPerSecond !== undefined && <span>速度: {point.speedMetersPerSecond} m/s</span>}</div>;
}

function formatTimestamp(timestamp: string) { return timestamp.replace('T', ' ').replace(/\.\d{3}/, ''); }
