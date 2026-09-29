// アプリ独自のZoom設定。小さい値ほど広域、大きい値ほど拡大した表示を表す。
// タイルに対象地物が存在しないZoomでは、表示開始値を下げても表示できない。
// 公式レイヤのZoom帯は、下記で明示した上書き以外は維持する。
// ブラウザ地図左下の「Zoom x.x」を確認しながら調整する。
export const GSI_ZOOM_CONFIG = {
  source: {
    // 公式タイルが提供され始めるZoom。小さくしても未提供Zoomの情報は増えない。
    minZoom: 4,
    // 公式タイルの最大Zoom。これより拡大するとMapLibreが最大Zoomのタイルを拡大表示する。
    maxZoom: 16,
  },
  lowZoomLand: {
    // 補助レイヤを使用する最小Zoom。
    minZoom: 4,
    // このZoom未満で表示する。Zoom 8からはexperimental_bvmapだけへ戻す。
    maxZoom: 8,
  },
  terrain: {
    // DEMタイルの最小Zoom。下げても未提供の標高データは増えない。
    minZoom: 1,
    // DEMタイルの最大Zoom。これを超える拡大では最大Zoomのタイルを拡大表示する。
    maxZoom: 14,
  },
  transition: {
    // 地理院Vectorの広域用レイヤと詳細用レイヤの構成が切り替わるZoom。
    boundaryZoom: 8,
    // 境界で現れた詳細レイヤが通常の表示濃度へ戻るZoom。
    fadeEndZoom: 9,
  },
  labels: {
    // 国道番号の表示を開始するZoom。小さい値ほど広域表示から見える。
    // タイルに対象地物が含まれないZoomでは、この値を下げても表示されない。
    // ブラウザ地図左下の「Zoom x.x」を確認しながら調整する。
    nationalRouteNumber: 4,
    roadFacilities: {
      // インターチェンジ名称の表示開始Zoom。小さくすると広域から、大きくすると拡大時から表示する。
      // 対象Zoomのタイルに名称データがある場合のみ表示できる。
      interchange: 9.7,
      // スマートインターチェンジ名称の表示開始Zoom。小さくすると広域から、大きくすると拡大時から表示する。
      // 対象Zoomのタイルに名称データがある場合のみ表示できる。
      smartInterchange: 9.7,
      // ジャンクション名称の表示開始Zoom。小さくすると広域から、大きくすると拡大時から表示する。
      // 対象Zoomのタイルに名称データがある場合のみ表示できる。
      junction: 9.7,
      // サービスエリア名称の表示開始Zoom。小さくすると広域から、大きくすると拡大時から表示する。
      // 対象Zoomのタイルに名称データがある場合のみ表示できる。
      serviceArea: 9.7,
      // パーキングエリア名称の表示開始Zoom。小さくすると広域から、大きくすると拡大時から表示する。
      // 対象Zoomのタイルに名称データがある場合のみ表示できる。
      parkingArea: 9.7,
    },
  },
} as const;
