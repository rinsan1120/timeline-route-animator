import type { StyleSpecification } from 'maplibre-gl';
import { GSI_VECTOR_CONFIG } from './gsiVectorConfig';

const SOURCE_ID = 'gsi';
const { source, colors, roads, lines, features, labels, visibility } = GSI_VECTOR_CONFIG;

const lineWidth = (minZoom: number, widthAtMinZoom: number, widthAtZoom18: number) => [
  'interpolate', ['linear'], ['zoom'], minZoom, widthAtMinZoom, 18, widthAtZoom18,
];

const pointLabelLayer = (
  id: string,
  minzoom: number,
  annotationCategories: number[],
  color: string,
  textSize: number,
) => ({
  id,
  type: 'symbol' as const,
  source: SOURCE_ID,
  'source-layer': 'label',
  minzoom,
  filter: ['all', ['in', 'ftCode', 100, 50100], ['in', 'annoCtg', ...annotationCategories]],
  layout: {
    'text-field': ['get', 'knj'],
    'text-font': ['NotoSansCJKjp-Regular'],
    'text-size': textSize,
    'text-allow-overlap': false,
    'text-keep-upright': true,
    'symbol-placement': 'point' as const,
  },
  paint: {
    'text-color': color,
    'text-halo-color': colors.labelHalo,
    'text-halo-width': 1,
  },
});

const routeNumberLayer = (
  id: string,
  minzoom: number,
  featureCode: 2901 | 2903 | 2904,
  iconImage: string,
  numberProperty: 'nRNo' | 'uRNo',
) => ({
  id,
  type: 'symbol' as const,
  source: SOURCE_ID,
  'source-layer': 'transp',
  minzoom,
  filter: ['all', ['in', 'ftCode', featureCode]],
  layout: {
    'icon-image': iconImage,
    'icon-size': labels.routeNumberIconScale,
    'icon-allow-overlap': true,
    'icon-pitch-alignment': 'viewport' as const,
    'icon-rotation-alignment': 'viewport' as const,
    'text-field': ['get', numberProperty],
    'text-font': ['NotoSansCJKjp-Regular'],
    'text-size': labels.routeNumberTextSize,
    'text-offset': [0, -0.15],
    'text-allow-overlap': false,
    'text-keep-upright': true,
    'text-pitch-alignment': 'viewport' as const,
    'text-rotation-alignment': 'viewport' as const,
    'symbol-placement': 'point' as const,
  },
  paint: { 'text-color': colors.routeNumberText },
});

const styleLayers = [
  {
    id: 'gsi-background',
    type: 'background' as const,
    paint: { 'background-color': colors.background },
  },

  ...(visibility.water ? [
    {
      id: 'gsi-water-area',
      type: 'fill' as const,
      source: SOURCE_ID,
      'source-layer': 'waterarea',
      minzoom: features.waterMinZoom,
      filter: ['all', ['in', 'ftCode', 55000, 5000]],
      paint: { 'fill-color': colors.water },
    },
    {
      id: 'gsi-river',
      type: 'line' as const,
      source: SOURCE_ID,
      'source-layer': 'river',
      minzoom: features.waterMinZoom,
      filter: ['all', ['in', 'ftCode', 55301, 55302, 55303, 55304, 5301, 5302, 5201, 5203, 5322]],
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
      paint: { 'line-color': colors.water, 'line-width': lines.riverWidth },
    },
    {
      id: 'gsi-lake-outline',
      type: 'line' as const,
      source: SOURCE_ID,
      'source-layer': 'lake',
      minzoom: features.waterMinZoom,
      filter: ['all', ['in', 'ftCode', 5231, 5233]],
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
      paint: { 'line-color': colors.water, 'line-width': lines.riverWidth },
    },
    {
      id: 'gsi-coastline',
      type: 'line' as const,
      source: SOURCE_ID,
      'source-layer': 'coastline',
      minzoom: features.waterMinZoom,
      filter: ['all', ['in', 'ftCode', 55101, 5101, 5103]],
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
      paint: { 'line-color': colors.coastline, 'line-width': lines.coastlineWidth },
    },
  ] : []),

  ...(visibility.buildings ? [{
    id: 'gsi-buildings',
    type: 'fill' as const,
    source: SOURCE_ID,
    'source-layer': 'building',
    minzoom: features.buildingMinZoom,
    paint: { 'fill-color': colors.building, 'fill-opacity': 0.65 },
  }] : []),

  ...(visibility.contours ? [{
    id: 'gsi-contours',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'contour',
    minzoom: features.contourMinZoom,
    paint: { 'line-color': colors.contour, 'line-width': lines.contourWidth },
  }] : []),

  ...(visibility.elevation ? [{
    id: 'gsi-elevation',
    type: 'symbol' as const,
    source: SOURCE_ID,
    'source-layer': 'elevation',
    minzoom: features.elevationMinZoom,
    layout: {
      'text-field': ['to-string', ['get', 'alti']],
      'text-font': ['NotoSansCJKjp-Regular'],
      'text-size': labels.generalTextSize,
      'symbol-placement': 'point' as const,
    },
    paint: {
      'text-color': colors.elevation,
      'text-halo-color': colors.labelHalo,
      'text-halo-width': 1,
    },
  }] : []),

  ...(visibility.boundaries ? [
    {
      id: 'gsi-prefecture-boundary',
      type: 'line' as const,
      source: SOURCE_ID,
      'source-layer': 'boundary',
      minzoom: features.prefectureBoundaryMinZoom,
      filter: ['all', ['in', 'ftCode', 1211, 51212]],
      paint: { 'line-color': colors.boundary, 'line-width': lines.prefectureBoundaryWidth, 'line-dasharray': [5, 2] },
    },
    {
      id: 'gsi-municipality-boundary',
      type: 'line' as const,
      source: SOURCE_ID,
      'source-layer': 'boundary',
      minzoom: features.municipalityBoundaryMinZoom,
      filter: ['all', ['in', 'ftCode', 1212]],
      paint: { 'line-color': colors.boundary, 'line-width': lines.municipalityBoundaryWidth, 'line-dasharray': [2, 2] },
    },
  ] : []),

  {
    id: 'gsi-overview-major-roads',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.motorway.minZoom,
    maxzoom: roads.nationalRoad.minZoom,
    filter: ['all', ['in', 'ftCode', 52701]],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.nationalRoad,
      'line-width': lineWidth(roads.motorway.minZoom, roads.motorway.widthAtMinZoom, roads.nationalRoad.widthAtZoom18),
    },
  },
  {
    id: 'gsi-overview-motorways',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.motorway.minZoom,
    maxzoom: roads.nationalRoad.minZoom,
    filter: ['all', ['in', 'ftCode', 52703, 52704]],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.motorway,
      'line-width': lineWidth(roads.motorway.minZoom, roads.motorway.widthAtMinZoom, roads.motorway.widthAtZoom18),
    },
  },
  {
    id: 'gsi-other-roads',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.otherRoad.minZoom,
    filter: [
      'all',
      ['in', 'ftCode', 2701, 2702, 2703, 2704, 2711, 2712, 2713, 2714, 2721, 2722, 2723, 2724],
      ['!=', 'rdCtg', 0],
      ['!=', 'rdCtg', 1],
      ['!=', 'rdCtg', 3],
      ['!=', 'motorway', 1],
      ['in', 'rnkWidth', 2, 3, 4],
    ],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.otherRoad,
      'line-width': lineWidth(roads.otherRoad.minZoom, roads.otherRoad.widthAtMinZoom, roads.otherRoad.widthAtZoom18),
    },
  },
  {
    id: 'gsi-fine-streets',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.fineStreet.minZoom,
    filter: [
      'all',
      ['in', 'ftCode', 2701, 2702, 2703, 2704, 2711, 2712, 2713, 2714, 2721, 2722, 2723, 2724],
      ['!=', 'rdCtg', 0],
      ['!=', 'rdCtg', 1],
      ['!=', 'rdCtg', 3],
      ['!=', 'motorway', 1],
      ['in', 'rnkWidth', 0, 1, 5, 6, 7],
    ],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.otherRoad,
      'line-width': lineWidth(roads.fineStreet.minZoom, roads.fineStreet.widthAtMinZoom, roads.fineStreet.widthAtZoom18),
    },
  },
  {
    id: 'gsi-prefectural-roads',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.prefecturalRoad.minZoom,
    filter: ['all', ['in', 'ftCode', 2701, 2702, 2703, 2704, 2721, 2722, 2723, 2724], ['==', 'rdCtg', 1], ['!=', 'motorway', 1]],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.prefecturalRoad,
      'line-width': lineWidth(roads.prefecturalRoad.minZoom, roads.prefecturalRoad.widthAtMinZoom, roads.prefecturalRoad.widthAtZoom18),
    },
  },
  {
    id: 'gsi-national-roads',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.nationalRoad.minZoom,
    filter: ['all', ['in', 'ftCode', 2701, 2702, 2703, 2704, 2721, 2722, 2723, 2724], ['==', 'rdCtg', 0], ['!=', 'motorway', 1]],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.nationalRoad,
      'line-width': lineWidth(roads.nationalRoad.minZoom, roads.nationalRoad.widthAtMinZoom, roads.nationalRoad.widthAtZoom18),
    },
  },
  {
    id: 'gsi-motorways',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'road',
    minzoom: roads.nationalRoad.minZoom,
    filter: ['all', ['in', 'ftCode', 2701, 2702, 2703, 2704], ['==', 'motorway', 1]],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.motorway,
      'line-width': lineWidth(roads.motorway.minZoom, roads.motorway.widthAtMinZoom, roads.motorway.widthAtZoom18),
    },
  },

  ...(visibility.railways ? [{
    id: 'gsi-railways',
    type: 'line' as const,
    source: SOURCE_ID,
    'source-layer': 'railway',
    minzoom: features.railwayMinZoom,
    filter: ['all', ['in', 'ftCode', 58201, 58203, 58204, 8201, 2801, 2803, 2804, 2806, 2811, 2813, 2821, 2831, 2841, 2843]],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': colors.railway,
      'line-width': lineWidth(features.railwayMinZoom, lines.railwayWidthAtMinZoom, lines.railwayWidthAtZoom18),
      'line-opacity': 0.75,
    },
  }] : []),

  ...(labels.showNaturalNames ? [pointLabelLayer('gsi-natural-place-labels', labels.naturalNameMinZoom, [311, 312, 314, 315, 316, 321, 322, 333, 341, 344, 345, 348], colors.naturalLabel, labels.generalTextSize)] : []),
  ...(labels.showPrefectureNames ? [pointLabelLayer('gsi-prefecture-labels', labels.prefectureNameMinZoom, [140], colors.placeLabel, labels.prefectureTextSize)] : []),
  ...(labels.showMunicipalityNames ? [pointLabelLayer('gsi-municipality-labels', labels.municipalityNameMinZoom, [110], colors.placeLabel, labels.municipalityTextSize)] : []),
  ...(labels.showMajorPlaceNames ? [pointLabelLayer('gsi-major-place-labels', labels.majorPlaceNameMinZoom, [210, 220, 800], colors.placeLabel, labels.generalTextSize)] : []),
  ...(labels.showRoadNames ? [pointLabelLayer('gsi-road-labels', labels.roadNameMinZoom, [411], colors.transportLabel, labels.generalTextSize)] : []),
  ...(labels.showRailwayNames ? [pointLabelLayer('gsi-railway-labels', labels.railwayNameMinZoom, [421, 422], colors.transportLabel, labels.generalTextSize)] : []),

  ...(visibility.nationalRouteNumbers && labels.showNationalRouteNumbers ? [routeNumberLayer('gsi-national-route-numbers', labels.nationalRouteNumberMinZoom, 2901, '国道番号-20', 'nRNo')] : []),
  ...(visibility.expresswayRouteNumbers && labels.showExpresswayRouteNumbers ? [
    routeNumberLayer('gsi-urban-expressway-route-numbers', labels.expresswayRouteNumberMinZoom, 2903, '都市高速道路番号-20', 'uRNo'),
    routeNumberLayer('gsi-expressway-route-numbers', labels.expresswayRouteNumberMinZoom, 2904, '高速道路番号-20', 'nRNo'),
  ] : []),
] as StyleSpecification['layers'];

export const GSI_ATTRIBUTION = source.attributionText;

export const GSI_STYLE: StyleSpecification = {
  version: 8,
  glyphs: source.glyphsUrl,
  sprite: source.spriteUrl,
  sources: {
    [SOURCE_ID]: {
      type: 'vector',
      tiles: [source.vectorTileUrl],
      minzoom: source.minZoom,
      maxzoom: source.maxZoom,
      attribution: source.attributionHtml,
    },
  },
  layers: styleLayers,
};
