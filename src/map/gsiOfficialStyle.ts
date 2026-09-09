import type { StyleSpecification } from 'maplibre-gl';
import officialStyle from './gsiOfficialStyle.json';

/**
 * 国土地理院公式の標準スタイルを、アプリ内で使うための未加工ベースとして公開する。
 * 取得元: https://raw.githubusercontent.com/gsi-cyberjapan/gsivectortile-mapbox-gl-js/master/std.json
 *
 * レイヤー順・filter・Zoom分割・注記・道路番号を正しく保つため、このデータを
 * 不用意に手編集しないこと。除外や見た目の調整は gsiStyle.ts と
 * gsiVectorConfig.ts で行う。
 */
export const GSI_OFFICIAL_STYLE = officialStyle as unknown as StyleSpecification;

export const GSI_OFFICIAL_SOURCE_ID = 'gsibv-vectortile-source-1-4-16';
