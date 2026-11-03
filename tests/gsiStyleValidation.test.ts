import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { GSI_STYLE } from '../src/map/gsiStyle';

describe('GSI style', () => {
  it('passes MapLibre style validation', () => {
    expect(validateStyleMin(GSI_STYLE)).toEqual([]);
  });
});
