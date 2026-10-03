import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenPoiUrl, normalizeBounds, normalizePosition, normalizeSearchResponse, normalizeVocabulary, parseCoordinateInput, searchOpenPoi } from './openPoiSearch';

const facility = (index = 0) => ({ name: `施設 ${index}`, address: '架空の住所', lat: '35.5', lng: '139.5' });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OpenPOI query boundary', () => {
  it.each(['suggest', 'search'] as const)('builds only approved parameters for %s', (kind) => {
    const query = '草津温泉 & bbox=private? center=secret#radius=1';
    const url = buildOpenPoiUrl(query, kind);
    expect(url.origin).toBe('https://api.openpoiapi.com');
    expect(url.pathname).toBe(`/v1/${kind}`);
    expect(url.searchParams.get('q')).toBe(query);
    expect(Object.fromEntries(url.searchParams)).toEqual(kind === 'suggest'
      ? { q: query, limit: '5', fields: 'minimal' } : { q: query, limit: '15' });
    for (const name of ['bbox', 'center', 'radius']) expect(url.searchParams.has(name)).toBe(false);
  });
});

describe('local coordinate input compatibility', () => {
  it.each([
    ['35.681236, 139.767125', 35.681236, 139.767125],
    [' +.5 , -139. ', 0.5, -139], ['-90,180', -90, 180],
  ])('keeps valid decimal syntax: %s', (value, latitude, longitude) => {
    expect(parseCoordinateInput(String(value))).toEqual({ isCoordinate: true, position: { latitude, longitude } });
  });
  it.each(['91,139', '35,-181', '9999999999999999999999999999999999999999,139'])('never treats out-of-range coordinates as text: %s', (value) => {
    expect(parseCoordinateInput(value)).toEqual({ isCoordinate: true, position: null });
  });
  it.each(['小作', '草津温泉', '施設名,支店', '35,139 text', ''])('classifies ordinary text: %s', (value) => {
    expect(parseCoordinateInput(value)).toEqual({ isCoordinate: false, position: null });
  });
});

describe('OpenPOI response normalization', () => {
  it('accepts numeric and string coordinates', () => {
    expect(normalizePosition(35.5, 139.5)).toEqual({ latitude: 35.5, longitude: 139.5 });
    expect(normalizePosition('35.5', '139.5')).toEqual({ latitude: 35.5, longitude: 139.5 });
  });
  it.each([[NaN, 139], [35, Infinity], [91, 139], [35, -181], ['', 139], [null, 139], [true, 139], ['invalid', 139]])('rejects invalid coordinates %s, %s', (lat, lng) => {
    expect(normalizePosition(lat, lng)).toBeNull();
  });
  it('retains all 15 valid search results, including string coordinates', () => {
    const results = normalizeSearchResponse({ results: Array.from({ length: 15 }, (_, i) => facility(i)) }, 'search');
    expect(results).toHaveLength(15);
    expect(results[14]).toMatchObject({ label: '施設 14', position: { latitude: 35.5, longitude: 139.5 } });
  });
  it('retains all 13 valid results without truncating to five', () => {
    const results = [...Array.from({ length: 13 }, (_, i) => facility(i)), { lat: 91, lng: 139 }, { lat: 35, lng: 'invalid' }];
    expect(normalizeSearchResponse({ results }, 'search')).toHaveLength(13);
  });
  it('returns an empty list if no result has valid coordinates', () => {
    expect(normalizeSearchResponse({ results: [{ lat: null, lng: '' }, {}, null] }, 'search')).toEqual([]);
    expect(normalizeSearchResponse({ results: [] }, 'search')).toEqual([]);
  });
  it('keeps suggest and search response fields separate and limits suggestions to five', () => {
    expect(normalizeSearchResponse({ suggestions: Array.from({ length: 15 }, (_, i) => facility(i)) }, 'suggest')).toHaveLength(5);
    expect(normalizeSearchResponse({ suggestions: [facility()] }, 'search')).toEqual([]);
    expect(normalizeSearchResponse({ results: [facility()] }, 'suggest')).toEqual([]);
  });
  it('falls back to prefecture/city and preserves external markup as plain strings', () => {
    expect(normalizeSearchResponse({ results: [{ ...facility(), name: '<script>external</script>', address: '', prefecture: '架空県', city: '架空市' }] }, 'search')[0])
      .toMatchObject({ label: '<script>external</script>', address: '架空県 架空市' });
  });
  it('ignores missing arrays and unknown vocabulary types', () => {
    expect(normalizeSearchResponse(null, 'suggest')).toEqual([]);
    expect(normalizeSearchResponse({}, 'search')).toEqual([]);
    expect(normalizeVocabulary([null, { type: 'unknown', label: '未知' }])).toEqual([]);
  });
});

describe('OpenPOI vocabulary and MapLibre coordinate order', () => {
  it('keeps bbox and center in longitude, latitude order', () => {
    expect(normalizeBounds([138, 35, 140, 37])).toEqual([[138, 35], [140, 37]]);
    expect(normalizeVocabulary([{ type: 'place', label: '架空地域', bbox: [138, 35, 140, 37], center: [139, 36] }]))
      .toEqual([{ type: 'place', label: '架空地域', address: '', bounds: [[138, 35], [140, 37]], center: [139, 36] }]);
  });
  it.each([[140, 35, 138, 37], [138, 37, 140, 35], [181, 35, 182, 37], [138, -91, 140, 37], [138, 35, 140], [null, 35, 140, 37]].map((value) => [value]))('rejects invalid bbox %j', (value) => {
    expect(normalizeBounds(value)).toBeNull();
  });
  it('uses a valid center when bbox is invalid and drops invalid centers', () => {
    expect(normalizeVocabulary([{ type: 'place', label: '地域', bbox: [], center: [139, 35] }])[0])
      .toMatchObject({ bounds: null, center: [139, 35] });
    expect(normalizeVocabulary([{ type: 'place', label: '地域', center: [35, 139] }, { type: 'place', label: '地域', center: [null, 35] }])).toEqual([]);
  });
  it('retains category/brand queries for explicit search', () => {
    expect(normalizeVocabulary([{ type: 'category', label: 'ラーメン', query: '麺料理' }, { type: 'brand', label: 'ブランド', query: '店舗名' }]))
      .toEqual([{ type: 'category', label: 'ラーメン', address: '', query: '麺料理' }, { type: 'brand', label: 'ブランド', address: '', query: '店舗名' }]);
  });
});

describe('OpenPOI transport', () => {
  it('fetches short queries with no credentials, persistent cache or referrer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [facility()] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchOpenPoi('小作', 'search', new AbortController().signal)).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0].searchParams.get('q')).toBe('小作');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  });
  it('reports failed HTTP requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchOpenPoi('架空施設', 'search', new AbortController().signal)).rejects.toThrow();
  });
  it.each(['timeout', 'cancel'] as const)('aborts on %s', async (reason) => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options.signal;
      requestSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const controller = new AbortController();
    const request = searchOpenPoi('架空施設', 'suggest', controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(10_000); else controller.abort();
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
