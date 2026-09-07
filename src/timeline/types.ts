export interface RoutePoint {
  id: string;
  latitude: number;
  longitude: number;
  timestamp?: string;
  source: 'timelinePath' | 'manual';
  original: boolean;
  annotation?: { label: string };
}

export interface RawPosition {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracyMeters?: number;
  source?: string;
  altitudeMeters?: number;
  speedMetersPerSecond?: number;
}

export interface ExtractedTimeline {
  routePoints: RoutePoint[];
  rawPositions: RawPosition[];
}

export type WorkerRequest =
  | { type: 'load'; buffer: ArrayBuffer; fileName: string }
  | { type: 'extract'; date: string; from: string; to: string }
  | { type: 'extract-range'; startDate: string; endDate: string; from: string; to: string };

export type WorkerResponse =
  | { type: 'loaded'; dates: string[]; fileName: string }
  | ({ type: 'extracted' } & ExtractedTimeline)
  | { type: 'error'; message: string };
