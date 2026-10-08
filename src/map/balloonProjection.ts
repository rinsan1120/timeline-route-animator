import { LngLat, type Map as MapLibreMap } from 'maplibre-gl';
import { VIDEO_CAMERA_FOV, VIDEO_VIEWPORT, type VideoCamera } from '../video/overviewCamera';
import type { RoutePoint } from '../timeline/types';

// Clone MapLibre's projection so migration never moves the visible map, requests
// tiles, or depends on desktop/mobile viewport dimensions.
export function createBalloonReferenceProjector(map: MapLibreMap) {
  const transform = map._camera.transform.clone();
  transform.setConstrainOverride((center, zoom) => ({ center, zoom }));
  transform.setFov(VIDEO_CAMERA_FOV);
  transform.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
  transform.resize(VIDEO_VIEWPORT.width, VIDEO_VIEWPORT.height, false);
  return (point: RoutePoint, camera: VideoCamera) => {
    transform.setZoom(camera.zoom);
    transform.setCenter(new LngLat(camera.longitude, camera.latitude));
    transform.setBearing(camera.bearing);
    transform.setPitch(camera.pitch);
    return transform.locationToScreenPoint(new LngLat(point.longitude, point.latitude));
  };
}
