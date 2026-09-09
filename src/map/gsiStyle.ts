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

const { source, lowZoomLand, appearance, zoomTransition, colors, roads, lines, labels, visibility } = GSI_VECTOR_CONFIG;
const GSI_LOW_ZOOM_LAND_SOURCE_ID = 'gsi-optimal-lowzoom-land';
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

function isMunicipalityLabelLayer(layer: StyleLayer): boolean {
  return layer.type === 'symbol'
    && sourceLayerOf(layer) === 'label'
    && metadataPathOf(layer) === '注記-市区町村';
}

function isOverviewMajorRoadLayer(layer: StyleLayer): boolean {
  return sourceLayerOf(layer) === 'road' && metadataPathOf(layer) === '道路-主要な道路';
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

type ZoomInterpolationExpression<T extends number | string> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  number,
  T,
  number,
  T,
];

function zoomInterpolation<T extends number | string>(
  startZoom: number,
  startValue: T,
  endZoom: number,
  endValue: T,
): ZoomInterpolationExpression<T> {
  return ['interpolate', ['linear'], ['zoom'], startZoom, startValue, endZoom, endValue];
}

function applyOpacityFade(
  paint: Record<string, unknown>,
  property: string,
  opacityAtBoundary: number,
  fadeEndZoom: number = zoomTransition.fadeEndZoom,
) {
  const existingOpacity = paint[property];
  if (existingOpacity === undefined) {
    paint[property] = zoomInterpolation(
      zoomTransition.boundaryZoom,
      opacityAtBoundary,
      fadeEndZoom,
      1,
    );
  } else if (typeof existingOpacity === 'number') {
    paint[property] = zoomInterpolation(
      zoomTransition.boundaryZoom,
      existingOpacity * opacityAtBoundary,
      fadeEndZoom,
      existingOpacity,
    );
  }
}

function applyZoomTransition(layer: MutableLayer) {
  if (layer.minzoom !== zoomTransition.boundaryZoom) return;
  const sourceLayer = sourceLayerOf(layer);

  if (sourceLayer === 'road' && layer.type === 'line') {
    const paint = layer.paint ?? (layer.paint = {});
    applyOpacityFade(paint, 'line-opacity', zoomTransition.detailedRoadOpacityAtBoundary);
    if (typeof paint['line-width'] === 'number') {
      const width = paint['line-width'];
      paint['line-width'] = zoomInterpolation(
        zoomTransition.boundaryZoom,
        width * 0.75,
        zoomTransition.fadeEndZoom,
        width,
      );
    }

    const category = roadCategory(metadataPathOf(layer));
    if (category === 'motorway' || category === 'nationalRoad') {
      const outline = layer.metadata?.['line-role'] === 'outline';
      const targetColor = category === 'motorway'
        ? (outline ? colors.motorwayOutline : colors.motorway)
        : (outline ? colors.nationalRoadOutline : colors.nationalRoad);
      paint['line-color'] = zoomInterpolation(
        zoomTransition.boundaryZoom,
        outline ? colors.overviewMajorRoadOutline : colors.overviewMajorRoad,
        zoomTransition.fadeEndZoom,
        targetColor,
      );
    }
    return;
  }

  if (sourceLayer === 'railway' && layer.type === 'line') {
    const paint = layer.paint ?? (layer.paint = {});
    applyOpacityFade(paint, 'line-opacity', zoomTransition.detailedRailwayOpacityAtBoundary);
    return;
  }

  if ((sourceLayer === 'label' || sourceLayer === 'symbol') && layer.type === 'symbol') {
    const paint = layer.paint ?? (layer.paint = {});
    if (isMunicipalityLabelLayer(layer)) {
      applyOpacityFade(
        paint,
        'text-opacity',
        zoomTransition.municipalityOpacityAtBoundary,
        Math.min(zoomTransition.fadeEndZoom, zoomTransition.boundaryZoom + 0.5),
      );
    } else {
      applyOpacityFade(paint, 'text-opacity', zoomTransition.detailedLabelOpacityAtBoundary);
      applyOpacityFade(paint, 'icon-opacity', zoomTransition.detailedLabelOpacityAtBoundary);
    }
  }
}

function applyConfiguredAppearance(layer: StyleLayer): StyleLayer {
  const cloned = {
    ...layer,
    ...(layer.layout ? { layout: { ...layer.layout } } : {}),
    ...(layer.paint ? { paint: { ...layer.paint } } : {}),
  } as MutableLayer;
  const sourceLayer = sourceLayerOf(cloned);
  const path = metadataPathOf(cloned);

  if (sourceLayer === 'road') {
    const widthScale = isOverviewMajorRoadLayer(cloned) ? 1 : roads[roadCategory(path)].widthScale;
    scaleProperty(cloned.paint, 'line-width', widthScale);
  }
  if (sourceLayer === 'railway') scaleProperty(cloned.paint, 'line-width', lines.railwayWidthScale);
  if (sourceLayer === 'boundary') scaleProperty(cloned.paint, 'line-width', lines.boundaryWidthScale);
  if (sourceLayer && WATER_SOURCE_LAYERS.has(sourceLayer)) scaleProperty(cloned.paint, 'line-width', lines.waterWidthScale);
  scaleProperty(cloned.layout, 'text-size', labels.textSizeScale);
  if (isRouteNumberLayer(cloned, [2901, 2903, 2904])) {
    scaleProperty(cloned.layout, 'icon-size', labels.routeNumberIconScale);
  }
  if (isRouteNumberLayer(cloned, [2901])) {
    cloned.minzoom = Math.min(cloned.minzoom ?? labels.nationalRouteNumberMinZoom, labels.nationalRouteNumberMinZoom);
  }
  if (labels.prioritizeMunicipalityNames && isMunicipalityLabelLayer(cloned)) {
    cloned.layout = { ...cloned.layout, 'text-allow-overlap': true };
  }

  if (appearance.useCustomPalette && cloned.paint) {
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
      const roadOutlineColors = {
        motorway: colors.motorwayOutline,
        nationalRoad: colors.nationalRoadOutline,
        prefecturalRoad: colors.prefecturalRoadOutline,
        otherRoad: colors.otherRoadOutline,
      };
      paint['line-color'] = isOverviewMajorRoadLayer(cloned)
        ? (cloned.metadata?.['line-role'] === 'outline' ? colors.overviewMajorRoadOutline : colors.overviewMajorRoad)
        : cloned.metadata?.['line-role'] === 'outline'
          ? roadOutlineColors[category]
          : roadColors[category];
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
  }
  applyZoomTransition(cloned);
  return cloned;
}

function orderConfiguredLayers(layersToOrder: StyleLayer[]): StyleLayer[] {
  const otherLayers: StyleLayer[] = [];
  const municipalityLayers: StyleLayer[] = [];
  const routeNumberLayers: StyleLayer[] = [];

  for (const layer of layersToOrder) {
    if (isRouteNumberLayer(layer, [2901, 2903, 2904])) {
      routeNumberLayers.push(layer);
    } else if (labels.prioritizeMunicipalityNames && isMunicipalityLabelLayer(layer)) {
      municipalityLayers.push(layer);
    } else {
      otherLayers.push(layer);
    }
  }

  return [...otherLayers, ...municipalityLayers, ...routeNumberLayers];
}

const officialSource = GSI_OFFICIAL_STYLE.sources[GSI_OFFICIAL_SOURCE_ID];
if (!officialSource || officialSource.type !== 'vector') {
  throw new Error('地理院地図Vectorの公式ソース定義が見つかりません。');
}

export const GSI_ATTRIBUTION = source.attributionText;

const configuredLayers = orderConfiguredLayers(
  GSI_OFFICIAL_STYLE.layers.filter(shouldKeepLayer).map(applyConfiguredAppearance),
);

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
    ...(lowZoomLand.enabled ? {
      [GSI_LOW_ZOOM_LAND_SOURCE_ID]: {
        type: 'vector' as const,
        url: `pmtiles://${lowZoomLand.pmtilesUrl}`,
        minzoom: source.minZoom,
        maxzoom: source.maxZoom,
      },
    } : {}),
  },
  layers: [
    {
      id: 'gsi-background',
      type: 'background',
      paint: {
        'background-color': lowZoomLand.enabled
          ? ['step', ['zoom'], colors.background, lowZoomLand.minZoom, colors.water, lowZoomLand.maxZoom, colors.background]
          : colors.background,
      },
    },
    ...(lowZoomLand.enabled ? [{
      id: 'gsi-lowzoom-land',
      type: 'fill' as const,
      source: GSI_LOW_ZOOM_LAND_SOURCE_ID,
      'source-layer': lowZoomLand.sourceLayer,
      minzoom: lowZoomLand.minZoom,
      maxzoom: lowZoomLand.maxZoom,
      paint: { 'fill-color': colors.background },
    }] : []),
    ...configuredLayers,
  ],
};
