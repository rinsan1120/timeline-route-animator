export interface ReferencePosition { latitude: number; longitude: number }

// Keep the original decimal coordinate syntax, including signed and fractional values.
export function parseCoordinateInput(value: string): ReferencePosition | null {
  const decimal = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const match = value.trim().match(new RegExp(`^(${decimal})\\s*,\\s*(${decimal})$`));
  return match ? normalizePosition(match[1], match[2]) : null;
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
