import * as maplibregl from 'maplibre-gl';
import { GSI_STYLE, GSI_ATTRIBUTION } from '../map/gsiStyle';
import { installTerrainTintFallback, isTerrainTintError } from '../map/gsiTerrainTint';
import { waitForExportViewportReady } from '../map/exportViewportReady';
import { annotationLayout, drawAnnotation } from '../route/annotationCanvas';
import type { AnnotationStyle } from '../route/annotationStyle';
import type { RoutePoint } from '../timeline/types';
import { imageCamera, longitudeInBounds, SPOT_IMAGE_SIZE, spotsInBounds, type ImageBounds } from './imageBounds';

const IMAGE_MAP_ERROR = '画像用の地図データを完全に読み込めませんでした。通信状況を確認して、もう一度PNGを生成してください。';

export async function renderSpotImage(points: RoutePoint[], bounds: ImageBounds, style: AnnotationStyle): Promise<Blob> {
  const targets = spotsInBounds(points, bounds);
  if (!targets.length) throw new Error('指定範囲内にスポットがありません。');
  const { width, height } = SPOT_IMAGE_SIZE;
  const camera = imageCamera(bounds);
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', left: '-20000px', top: '0', width: `${width}px`, height: `${height}px`, pointerEvents: 'none' });
  document.body.appendChild(container);
  let map: maplibregl.Map | undefined;
  let mapError: Error | null = null;
  const onError = (event: maplibregl.ErrorEvent) => {
    if (!isTerrainTintError(event)) mapError = new Error(IMAGE_MAP_ERROR);
  };
  const disposeMap = () => {
    if (map) { map.off('error', onError); map.remove(); map = undefined; }
    mapError = null;
  };
  let zoom = camera.zoom;
  let attempts = 0;
  const prepareMap = async (): Promise<maplibregl.Map> => {
    while (map || attempts < 2) {
      try {
        if (!map) {
          attempts += 1;
          map = new maplibregl.Map({ container, style: GSI_STYLE, ...camera, zoom, maxZoom: 24, minZoom: -2,
            interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
          installTerrainTintFallback(map);
          map.on('error', onError);
        }
        await waitForExportViewportReady(map, 30_000, () => mapError, IMAGE_MAP_ERROR);
        return map;
      } catch (error) {
        disposeMap();
        if (attempts >= 2) throw new Error(IMAGE_MAP_ERROR, { cause: error });
      }
    }
    throw new Error(IMAGE_MAP_ERROR);
  };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('画像用Canvasを作成できませんでした。');
    await document.fonts.ready;
    let imageMap = await prepareMap();
    const annotations = () => targets.map((point) => {
      const annotation = { label: point.annotation?.label ?? '', placement: point.annotation?.placement,
        pixel: imageMap.project([longitudeInBounds(point.longitude, bounds), point.latitude]) };
      return { annotation, layout: annotationLayout(context, annotation, style, false) };
    });
    const fits = () => annotations().every(({ annotation, layout }) => {
      const { x, y } = annotation.pixel;
      if (x < 12 || x > width - 12 || y < 12 || y > height - 70) return false;
      if (!annotation.label) return true;
      // Reserve the same bottom attribution strip as MP4, including outline and shadow.
      const halo = 28 * style.balloonScale;
      return layout.left >= 24 + halo && layout.top >= 24 + halo
        && layout.left + layout.width <= width - 24 - halo
        && layout.top + layout.height + layout.pointerSize + halo + 8 * style.balloonScale <= height - 70;
    });
    if (!fits()) {
      let tooClose = zoom;
      let fitted = false;
      for (let i = 0; i < 48; i++) {
        zoom = Math.max(-2, zoom - 0.25);
        imageMap.jumpTo({ ...camera, zoom });
        if (fits()) { fitted = true; break; }
        tooClose = zoom;
        if (zoom === -2) break;
      }
      if (!fitted) throw new Error('バルーンを画像内に収められません。バルーンを地点に近づけるか、文字・バルーンサイズを小さくしてください。');
      // Find the smallest necessary zoom-out within the last quarter zoom step.
      for (let i = 0; i < 12; i++) {
        const candidate = (zoom + tooClose) / 2;
        imageMap.jumpTo({ ...camera, zoom: candidate });
        if (fits()) zoom = candidate; else tooClose = candidate;
      }
      imageMap.jumpTo({ ...camera, zoom });
    }
    imageMap = await prepareMap();
    context.drawImage(imageMap.getCanvas(), 0, 0, width, height);
    for (const { annotation, layout } of annotations()) {
      if (annotation.label) drawAnnotation(context, annotation, style, layout);
      context.beginPath(); context.arc(annotation.pixel.x, annotation.pixel.y, 23, 0, Math.PI * 2);
      context.fillStyle = '#ff5d37'; context.fill(); context.lineWidth = 6; context.strokeStyle = '#000000'; context.stroke();
    }
    context.fillStyle = 'rgba(255,255,255,.9)'; context.fillRect(24, height - 50, 520, 34);
    context.fillStyle = '#27364a'; context.font = '22px system-ui, sans-serif'; context.fillText(GSI_ATTRIBUTION, 34, height - 25);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('地図画像を生成できませんでした。')), 'image/png'));
  } finally { disposeMap(); container.remove(); }
}
