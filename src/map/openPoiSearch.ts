export interface ReferencePosition { latitude: number; longitude: number }
export type SearchKind = 'suggest' | 'search';
type LngLat = [number, number];
type Bounds = [LngLat, LngLat];
export type PlaceSearchItem =
  | { type: 'facility'; label: string; address: string; position: ReferencePosition }
  | { type: 'place'; label: string; address: string; bounds: Bounds | null; center: LngLat | null }
  | { type: 'category' | 'brand'; label: string; address: string; query: string };

// Keep the original decimal coordinate syntax, including signed and fractional values.
export function parseCoordinateInput(value: string): { isCoordinate: boolean; position: ReferencePosition | null } {
  const decimal = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const match = value.trim().match(new RegExp(`^(${decimal})\\s*,\\s*(${decimal})$`));
  return { isCoordinate: !!match, position: match ? normalizePosition(match[1], match[2]) : null };
}

function coordinateNumber(value: unknown): number {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
}

export function normalizePosition(lat: unknown, lng: unknown): ReferencePosition | null {
  const latitude = coordinateNumber(lat);
  const longitude = coordinateNumber(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

function normalizeCenter(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const position = normalizePosition(value[1], value[0]);
  return position ? [position.longitude, position.latitude] : null;
}

export function normalizeBounds(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const southwest = normalizeCenter(value.slice(0, 2));
  const northeast = normalizeCenter(value.slice(2, 4));
  return southwest && northeast && southwest[0] <= northeast[0] && southwest[1] <= northeast[1]
    ? [southwest, northeast] : null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function normalizeFacilities(value: unknown): PlaceSearchItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PlaceSearchItem[] => {
    const item = record(entry);
    const position = normalizePosition(item.lat, item.lng);
    if (!position) return [];
    return [{ type: 'facility', label: text(item.name) || '名称なし',
      address: text(item.address) || [text(item.prefecture), text(item.city)].filter(Boolean).join(' '), position }];
  });
}

export function normalizeVocabulary(value: unknown): PlaceSearchItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PlaceSearchItem[] => {
    const item = record(entry);
    const label = text(item.label);
    if (!label) return [];
    if (item.type === 'place') {
      const bounds = normalizeBounds(item.bbox);
      const center = normalizeCenter(item.center);
      return bounds || center ? [{ type: 'place', label, address: '', bounds, center }] : [];
    }
    if (item.type === 'category' || item.type === 'brand') {
      const query = text(item.query);
      return query ? [{ type: item.type, label, address: '', query }] : [];
    }
    return [];
  });
}

export function normalizeSearchResponse(value: unknown, kind: SearchKind): PlaceSearchItem[] {
  const response = record(value);
  if (kind === 'search') return normalizeFacilities(response.results).slice(0, 15);
  return [...normalizeVocabulary(response.vocabulary), ...normalizeFacilities(response.suggestions)].slice(0, 5);
}

// This boundary accepts only a query; map and route coordinates cannot become request parameters.
export function buildOpenPoiUrl(query: string, kind: SearchKind): URL {
  const url = new URL(`/v1/${kind}`, 'https://api.openpoiapi.com');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', kind === 'suggest' ? '5' : '15');
  if (kind === 'suggest') url.searchParams.set('fields', 'minimal');
  return url;
}

export async function searchOpenPoi(query: string, kind: SearchKind, signal: AbortSignal): Promise<PlaceSearchItem[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 10_000);
  try {
    const response = await fetch(buildOpenPoiUrl(query, kind), {
      signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error('OpenPOI request failed');
    return normalizeSearchResponse(await response.json(), kind);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
