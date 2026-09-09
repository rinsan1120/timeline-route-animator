import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { addProtocol, setWorkerUrl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';

const pmtilesProtocol = new Protocol();
addProtocol('pmtiles', pmtilesProtocol.tile);

setWorkerUrl(workerUrl);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
