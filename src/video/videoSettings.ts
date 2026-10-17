import type { RouteMarkerMode } from '../route/routeMarker';
import { DEFAULT_DISTANCE_HUD, type DistanceHudSettings } from './distanceHud';
import type { FollowViewMode, FollowZoomPreset, VideoCameraMode } from './followCamera';
import { VIDEO_VIEWPORT } from './overviewCamera';
import { DEFAULT_POST_ROLL_SECONDS, DEFAULT_PRE_ROLL_SECONDS } from './outputTiming';
import { MAX_POINT_PAUSE_SECONDS, POINT_PAUSE_STEP_SECONDS } from './playbackTimeline';

export interface VideoSettings {
  duration: number;
  commonPauseSeconds: number;
  preRollSeconds: number;
  postRollSeconds: number;
  cameraMode: VideoCameraMode;
  overviewZoomMode: 'auto' | 'custom';
  overviewCustomZoom: number;
  followZoomPreset: FollowZoomPreset;
  followCustomZoom: number;
  followViewMode: FollowViewMode;
  introZoomEnabled: boolean;
  routeMarkerMode: RouteMarkerMode;
  dayRouteColorsEnabled: boolean;
  recordedTimeClockEnabled: boolean;
  distanceHudSettings: DistanceHudSettings;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  duration: 10, commonPauseSeconds: 0,
  preRollSeconds: DEFAULT_PRE_ROLL_SECONDS, postRollSeconds: DEFAULT_POST_ROLL_SECONDS,
  cameraMode: 'overview', overviewZoomMode: 'auto', overviewCustomZoom: 10,
  followZoomPreset: 'standard', followCustomZoom: 10, followViewMode: 'top',
  introZoomEnabled: true, routeMarkerMode: 'day', dayRouteColorsEnabled: false,
  recordedTimeClockEnabled: false, distanceHudSettings: { ...DEFAULT_DISTANCE_HUD },
};

const SETTINGS_ERROR = '動画設定の形式が正しくありません。';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isPause = (value: unknown): value is number => inRange(value, 0, MAX_POINT_PAUSE_SECONDS) && Number.isInteger(value / POINT_PAUSE_STEP_SECONDS);
const isTenth = (value: number): boolean => Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;

// Absent settings are legacy data; a present object must contain valid settings.
// Return only known fields, with a fresh HUD object for editable React state.
export function parseVideoSettings(value: unknown): VideoSettings {
  if (value === undefined) return { ...DEFAULT_VIDEO_SETTINGS, distanceHudSettings: { ...DEFAULT_VIDEO_SETTINGS.distanceHudSettings } };
  if (!isRecord(value) || !inRange(value.duration, 5, 120) || !Number.isInteger(value.duration)
    || !isPause(value.commonPauseSeconds) || !isPause(value.preRollSeconds) || !isPause(value.postRollSeconds)
    || (value.cameraMode !== 'overview' && value.cameraMode !== 'follow')
    || (value.overviewZoomMode !== 'auto' && value.overviewZoomMode !== 'custom')
    || !inRange(value.overviewCustomZoom, 4, 16) || !inRange(value.followCustomZoom, 4, 16)
    || !isTenth(value.overviewCustomZoom) || !isTenth(value.followCustomZoom)
    || (value.followZoomPreset !== 'wide' && value.followZoomPreset !== 'standard' && value.followZoomPreset !== 'close' && value.followZoomPreset !== 'custom')
    || (value.followViewMode !== 'top' && value.followViewMode !== 'oblique')
    || (value.routeMarkerMode !== 'day' && value.routeMarkerMode !== 'start-goal' && value.routeMarkerMode !== 'none')
    || typeof value.introZoomEnabled !== 'boolean' || typeof value.dayRouteColorsEnabled !== 'boolean' || typeof value.recordedTimeClockEnabled !== 'boolean'
    || !isRecord(value.distanceHudSettings) || typeof value.distanceHudSettings.enabled !== 'boolean'
    || !inRange(value.distanceHudSettings.x, 0, VIDEO_VIEWPORT.width) || !inRange(value.distanceHudSettings.y, 0, VIDEO_VIEWPORT.height)
    || !inRange(value.distanceHudSettings.scale, 0.5, 2) || !isTenth(value.distanceHudSettings.scale)) throw new Error(SETTINGS_ERROR);
  return {
    duration: value.duration, commonPauseSeconds: value.commonPauseSeconds,
    preRollSeconds: value.preRollSeconds, postRollSeconds: value.postRollSeconds,
    cameraMode: value.cameraMode, overviewZoomMode: value.overviewZoomMode, overviewCustomZoom: value.overviewCustomZoom,
    followZoomPreset: value.followZoomPreset, followCustomZoom: value.followCustomZoom, followViewMode: value.followViewMode,
    introZoomEnabled: value.introZoomEnabled, routeMarkerMode: value.routeMarkerMode,
    dayRouteColorsEnabled: value.dayRouteColorsEnabled, recordedTimeClockEnabled: value.recordedTimeClockEnabled,
    distanceHudSettings: { enabled: value.distanceHudSettings.enabled, x: value.distanceHudSettings.x, y: value.distanceHudSettings.y, scale: value.distanceHudSettings.scale },
  };
}
