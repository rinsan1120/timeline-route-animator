import type { StyleSpecification } from 'maplibre-gl';
import { GSI_OFFICIAL_SOURCE_ID, GSI_OFFICIAL_STYLE } from './gsiOfficialStyle';
import { GSI_VECTOR_CONFIG } from './gsiVectorConfig';

type StyleLayer = StyleSpecification['layers'][number];
type MutableLayer = StyleLayer & {
  filter?: unknown;
  layout?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  'source-layer'?: string;
};

const { source, appearance, colors, roads, lines, labels, visibility } = GSI_VECTOR_CONFIG;
const WATER_SOURCE_LAYERS = new Set(['waterarea', 'river', 'lake', 'coastline']);
const DETAILED_LANDFORM_SOURCE_LAYERS = new Set(['landforma', 'landforml', 'landformp']);
const GEODETIC_POINT_CODES = new Set([7101, 7102, 7103]);
const NATURAL_LABEL_PATH = /山|岳|峰|山脈|山地|平原|平野|盆地|高原|湿原|河川|湖|沼|池|海|湾|灘|島|岬|崎|半島|峠|滝|岩|洞窟/;

function sourceLayerOf(layer: StyleLayer): string | undefined {
  return (layer as MutableLayer)['source-layer'];
}

function metadataPathOf(layer: StyleLayer): string {
  const path = (layer as MutableLayer).metadata?.path;
  return typeof path === 'string' ? path : '';
}

function filterContainsValue(filter: unknown, property: string, values: Set<number>): boolean {
  if (!Array.isArray(filter)) return false;
  if ((filter[0] === 'in' || filter[0] === '==') && filter[1] === property) {
    return filter.slice(2).some((value) => typeof value === 'number' && values.has(value));
  }
  return filter.some((part) => filterContainsValue(part, property, values));
}

function isRouteNumberLayer(layer: StyleLayer, codes: number[]): boolean {
  return sourceLayerOf(layer) === 'transp'
    && filterContainsValue((layer as MutableLayer).filter, 'ftCode', new Set(codes));
}

function shouldKeepLayer(layer: StyleLayer): boolean {
  const sourceLayer = sourceLayerOf(layer);
  if (sourceLayer === 'contour' && !visibility.contours) return false;
  if (sourceLayer === 'elevation' && !visibility.elevation) return false;
  if (sourceLayer === 'building' && !visibility.buildings) return false;
  if (sourceLayer && DETAILED_LANDFORM_SOURCE_LAYERS.has(sourceLayer) && !visibility.detailedLandforms) return false;
  if (sourceLayer === 'railway' && !visibility.railways) return false;
  if (sourceLayer && WATER_SOURCE_LAYERS.has(sourceLayer) && !visibility.water) return false;
  if (sourceLayer === 'boundary' && !visibility.boundaries) return false;
  if (isRouteNumberLayer(layer, [2901]) && (!visibility.nationalRouteNumbers || !labels.showNationalRouteNumbers)) return false;
  if (isRouteNumberLayer(layer, [2903, 2904]) && (!visibility.expresswayRouteNumbers || !labels.showExpresswayRouteNumbers)) return false;

  // symbol全体は主要都市等も含むため消さず、明確に測量基準点と分かる記号だけを除外する。
  if (sourceLayer === 'symbol' && !visibility.mapSymbols
    && filterContainsValue((layer as MutableLayer).filter, 'ftCode', GEODETIC_POINT_CODES)) return false;

  const path = metadataPathOf(layer);
  if (!labels.showPrefectureNames && path === '注記-都道府県') return false;
  if (!labels.showMunicipalityNames && path === '注記-市区町村') return false;
  if (!labels.showMajorPlaceNames && /^(?:注記-(?:公称|居住地名|集落名称)|記号-人口)/.test(path)) return false;
  if (!labels.showNaturalNames && sourceLayer === 'label' && NATURAL_LABEL_PATH.test(path)) return false;
  if (!labels.showRoadNames && path === '注記-道路名') return false;
  if (!labels.showRailwayNames && (path === '注記-鉄道路線名' || path === '注記-鉄道駅名')) return false;
  return true;
}

function scaleStyleValue(value: unknown, scale: number): unknown {
  if (scale === 1 || value === undefined) return value;
  if (typeof value === 'number') return value * scale;
  if (Array.isArray(value)) return ['*', value, scale];
  if (value && typeof value === 'object' && Array.isArray((value as { stops?: unknown }).stops)) {
    const styleFunction = value as { stops: unknown[][]; [key: string]: unknown };
    return {
      ...styleFunction,
      stops: styleFunction.stops.map(([zoom, output]) => [zoom, typeof output === 'number' ? output * scale : output]),
    };
  }
  return value;
}

function scaleProperty(target: Record<string, unknown> | undefined, property: string, scale: number) {
  if (!target || !(property in target)) return;
  target[property] = scaleStyleValue(target[property], scale);
}

function roadCategory(path: string): keyof typeof roads {
  if (path.includes('高速')) return 'motorway';
  if (path.includes('国道')) return 'nationalRoad';
  if (path.includes('都道府県道')) return 'prefecturalRoad';
  return 'otherRoad';
}

function applyConfiguredAppearance(layer: StyleLayer): StyleLayer {
  const cloned = {
    ...layer,
    ...(layer.layout ? { layout: { ...layer.layout } } : {}),
    ...(layer.paint ? { paint: { ...layer.paint } } : {}),
  } as MutableLayer;
  const sourceLayer = sourceLayerOf(cloned);
  const path = metadataPathOf(cloned);

  if (sourceLayer === 'road') scaleProperty(cloned.paint, 'line-width', roads[roadCategory(path)].widthScale);
  if (sourceLayer === 'railway') scaleProperty(cloned.paint, 'line-width', lines.railwayWidthScale);
  if (sourceLayer === 'boundary') scaleProperty(cloned.paint, 'line-width', lines.boundaryWidthScale);
  if (sourceLayer && WATER_SOURCE_LAYERS.has(sourceLayer)) scaleProperty(cloned.paint, 'line-width', lines.waterWidthScale);
  scaleProperty(cloned.layout, 'text-size', labels.textSizeScale);
  if (isRouteNumberLayer(cloned, [2901, 2903, 2904])) {
    scaleProperty(cloned.layout, 'icon-size', labels.routeNumberIconScale);
  }

  if (!appearance.useCustomPalette || !cloned.paint) return cloned;
  const paint = cloned.paint;
  if (sourceLayer === 'waterarea' && cloned.type === 'fill') paint['fill-color'] = colors.water;
  if ((sourceLayer === 'river' || sourceLayer === 'lake') && cloned.type === 'line') paint['line-color'] = colors.water;
  if (sourceLayer === 'coastline' && cloned.type === 'line') paint['line-color'] = colors.coastline;
  if (sourceLayer === 'building' && cloned.type === 'fill') paint['fill-color'] = colors.building;
  if (sourceLayer === 'building' && cloned.type === 'line') paint['line-color'] = colors.building;
  if (sourceLayer === 'contour' && cloned.type === 'line') paint['line-color'] = colors.contour;
  if (sourceLayer === 'contour' && cloned.type === 'symbol' && paint['text-color']) paint['text-color'] = colors.contour;
  if (sourceLayer === 'elevation' && cloned.type === 'symbol' && paint['text-color']) paint['text-color'] = colors.elevation;
  if (sourceLayer === 'railway' && cloned.type === 'line') paint['line-color'] = colors.railway;
  if (sourceLayer === 'boundary' && cloned.type === 'line') paint['line-color'] = colors.boundary;
  if (sourceLayer === 'road' && cloned.type === 'line') {
    const category = roadCategory(path);
    const roadColors = {
      motorway: colors.motorway,
      nationalRoad: colors.nationalRoad,
      prefecturalRoad: colors.prefecturalRoad,
      otherRoad: colors.otherRoad,
    };
    paint['line-color'] = roadColors[category];
  }
  if ((sourceLayer === 'label' || sourceLayer === 'symbol') && cloned.type === 'symbol' && paint['text-color']) {
    paint['text-color'] = NATURAL_LABEL_PATH.test(path)
      ? colors.naturalLabel
      : /(?:道路|鉄道)/.test(path) ? colors.transportLabel : colors.placeLabel;
    if ('text-halo-color' in paint) paint['text-halo-color'] = colors.labelHalo;
  }
  if (sourceLayer === 'transp' && cloned.type === 'symbol' && paint['text-color']) {
    paint['text-color'] = colors.routeNumberText;
  }
  return cloned;
}

const officialSource = GSI_OFFICIAL_STYLE.sources[GSI_OFFICIAL_SOURCE_ID];
if (!officialSource || officialSource.type !== 'vector') {
  throw new Error('地理院地図Vectorの公式ソース定義が見つかりません。');
}

export const GSI_ATTRIBUTION = source.attributionText;

export const GSI_STYLE: StyleSpecification = {
  ...GSI_OFFICIAL_STYLE,
  glyphs: source.glyphsUrl,
  sprite: source.spriteUrl,
  sources: {
    ...GSI_OFFICIAL_STYLE.sources,
    [GSI_OFFICIAL_SOURCE_ID]: {
      ...officialSource,
      tiles: [source.vectorTileUrl],
      minzoom: source.minZoom,
      maxzoom: source.maxZoom,
      attribution: source.attributionHtml,
    },
  },
  layers: [
    { id: 'gsi-background', type: 'background', paint: { 'background-color': colors.background } },
    ...GSI_OFFICIAL_STYLE.layers.filter(shouldKeepLayer).map(applyConfiguredAppearance),
  ],
};
