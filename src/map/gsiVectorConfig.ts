/*
 * 地理院地図Vectorの凡例
 *
 * 地理院Vector道路分類:
 * - motorway === 1 : 高速道路
 * - rdCtg === 0    : 国道
 * - rdCtg === 1    : 都道府県道
 * - その他         : 市区町村道等
 *
 * 主要source-layer:
 * - road      : 道路
 * - railway   : 鉄道
 * - boundary  : 行政界
 * - contour   : 等高線・等深線
 * - elevation : 標高・水深情報
 * - transp    : 国道番号・高速道路番号等
 * - label     : 都道府県名、市区町村名、自然地名等の注記
 *
 * 主要交通記号:
 * - ftCode 2901 : 国道番号（nRNoが表示番号）
 * - ftCode 2903 : 都市高速道路番号（uRNoが表示番号）
 * - ftCode 2904 : 高速道路番号（nRNoまたはuRNoが表示番号）
 *
 * Zoom:
 * - 数値が小さいほど広域表示
 * - 数値が大きいほど拡大表示
 * - 公式スタイルは同じ種類の地物もZoom帯ごとに複数レイヤに分割されている
 * - カテゴリ全体を単一のminZoomで制御せず、公式のminzoom / maxzoomを維持する
 * - ブラウザ地図左下の「Zoom x.x」を確認しながら調整できる
 */

export const GSI_VECTOR_CONFIG = {
  source: {
    // 地理院地図Vectorの公式ベクトルタイル。URLを変えると全背景地図の供給元が変わる。
    vectorTileUrl: 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf',
    // 公式タイルが提供され始めるZoom。小さくしても未提供Zoomの情報は増えない。
    minZoom: 4,
    // 公式タイルの最大Zoom。これより拡大するとMapLibreが最大Zoomのタイルを拡大表示する。
    maxZoom: 16,
    // 日本語注記用の公式Noto CJK glyphs。変更すると地名等の文字描画元が変わる。
    glyphsUrl: 'https://maps.gsi.go.jp/xyz/noto-jp/{fontstack}/{range}.pbf',
    // 国道・高速道路番号記号に使う公式sprite。変更すると道路番号アイコンの外観が変わる。
    spriteUrl: 'https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/sprite/std',
    // MapLibreの出典コントロールに表示するHTML。地図データの提供元を示す。
    attributionHtml: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    // MP4左下へ描画する短い出典文字列。CanvasではHTMLを使用しない。
    attributionText: '国土地理院',
  },

  lowZoomLand: {
    // trueで低Zoomの海背景と陸地面の補完を有効にする。
    enabled: true,
    // Zoom 8未満の陸地面だけを補完する国土地理院optimal_bvmap PMTiles。
    pmtilesUrl: 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles',
    // optimal_bvmapで行政区画面を格納しているsource-layer。
    sourceLayer: 'AdmArea',
    // 補助レイヤを使用する最小Zoom。
    minZoom: 4,
    // このZoom未満で表示する。Zoom 8からはexperimental_bvmapだけへ戻す。
    maxZoom: 8,
  },

  appearance: {
    // falseで公式std.jsonの色をそのまま使う。trueで下のcolorsを安全に分類できるレイヤだけへ適用する。
    // アプリのルート表示と調和する配色を使うため、カスタムパレットを有効にする。
    useCustomPalette: true,
  },

  zoomTransition: {
    // 地理院Vectorの広域用レイヤと詳細用レイヤの構成が切り替わるZoom。
    boundaryZoom: 8,
    // 境界で現れた詳細レイヤが通常の表示濃度へ戻るZoom。
    fadeEndZoom: 9,
    // 境界Zoomで新しく現れる詳細道路の初期opacity。
    detailedRoadOpacityAtBoundary: 0.7,
    // 境界Zoomで新しく現れる鉄道の初期opacity。
    detailedRailwayOpacityAtBoundary: 0.4,
    // 境界Zoomで新しく現れる一般注記の初期opacity。
    detailedLabelOpacityAtBoundary: 0.45,
    // 市区町村名は位置把握に重要なため、境界Zoomでも一般注記より強く残す。
    municipalityOpacityAtBoundary: 0.9,
  },

  colors: {
    // 地図全体の背景色。明るくするとアプリのオレンジ色ルートが相対的に目立つ。
    background: '#F5F3F2',
    // 海・湖・河川を動画内でも判別しやすくするため、背景より明確に青みを持たせた淡い水色。
    water: '#90D9ED',
    // 水域との境界を動画内でも認識しやすくするため、waterより一段濃い青灰色。
    coastline: '#90beed',
    // Zoom 8未満の「道路-主要な道路」専用色。詳細側との色差を小さくする中間的な青灰色。
    overviewMajorRoad: '#AAB8C4',
    // 「道路-主要な道路」に公式outlineがある場合だけ使う輪郭色。独自outlineは生成しない。
    overviewMajorRoadOutline: '#95A6B4',
    // road source-layerのmotorway === 1に使う高速道路色。道路網の骨格になる落ち着いた青灰色とする。
    motorway: '#879FBA',
    // road source-layerのrdCtg === 0に使う一般国道色。オレンジ色ルートと混同しにくい淡いベージュとする。
    nationalRoad: '#eccd7f',
    // road source-layerのrdCtg === 1に使う都道府県道色。道路網を主張させない淡い青灰色とする。
    prefecturalRoad: '#cfdbe4',
    // road source-layerのその他道路に使う線色。市区町村道や細街路を背景へ溶け込ませる。
    otherRoad: '#E4E8EB',
    // 高速道路のoutline色。道路本体より一段濃い青灰色とする。
    motorwayOutline: '#718CA5',
    // 国道のoutline色。道路本体より一段濃いベージュとする。
    nationalRoadOutline: '#D1C6AC',
    // 都道府県道のoutline色。道路本体を穏やかに縁取る淡い青灰色とする。
    prefecturalRoadOutline: '#C5CED5',
    // その他道路のoutline色。細街路を強調しすぎない淡い灰色とする。
    otherRoadOutline: '#D5DBDF',
    // railway source-layerの線色。濃くすると鉄道が道路より強く見えるため控えめにする。
    railway: '#929AA1',
    // boundary source-layerの行政界色。濃くすると都道府県界・市区町村界が目立つ。
    boundary: '#9da5ad',
    // label source-layerの都道府県名・市区町村名・主要地名の文字色。
    placeLabel: '#596168',
    // label source-layerの山・湖・河川・海等の自然地名の文字色。
    naturalLabel: '#637783',
    // 道路名・鉄道路線名等の交通注記に使う文字色。
    transportLabel: '#687078',
    // 注記の縁取り色。背景に近づけるほど地名の文字を柔らかく見せられる。
    labelHalo: '#FFFFFF',
    // transp source-layerの国道・高速道路番号記号内に使う文字色。spriteの濃い背景上で読める白とする。
    routeNumberText: '#ffffff',
    // visibility.buildingsを有効にした場合のbuilding source-layerの面色。
    building: '#e3e4e2',
    // visibility.contoursを有効にした場合のcontour source-layerの線色。
    contour: '#c8bda8',
    // visibility.elevationを有効にした場合のelevation source-layerの文字色。
    elevation: '#786f65',
  },

  roads: {
    motorway: {
      // 公式スタイルの高速道路線幅倍率。1で公式値、大きくすると各Zoom帯の相対関係を保ったまま太くなる。
      widthScale: 1,
    },
    nationalRoad: {
      // roadの国道レイヤ群に対する線幅倍率。公式のZoom分割と幅員別の差は変更しない。
      widthScale: 0.9,
    },
    prefecturalRoad: {
      // roadの都道府県道レイヤ群に対する線幅倍率。1より小さくすると国道よりさらに控えめになる。
      widthScale: 0.65,
    },
    otherRoad: {
      // 市区町村道・細街路等の公式レイヤ群に対する線幅倍率。Zoomごとの出し分けは公式定義を維持する。
      widthScale: 0.55,
    },
  },

  lines: {
    // river / lake / coastlineの公式線幅倍率。大きくすると水系の線が全Zoom帯で太くなる。
    waterWidthScale: 0.1,
    // railway source-layerの公式線幅倍率。大きくすると公式の複線・トンネル等の構成を保ったまま太くなる。
    railwayWidthScale: 0.8,
    // boundary source-layerの公式線幅倍率。大きくすると都道府県界・市区町村界が強くなる。
    boundaryWidthScale: 1,
  },

  labels: {
    // 国道番号（transp.ftCode === 2901）の公式レイヤ群を表示するか。Zoom帯・text-field・icon-imageは公式定義を維持する。
    showNationalRouteNumbers: true,
    // 国道番号の表示を開始するZoom。小さい値ほど広域表示から見える。
    // タイルに対象地物が含まれないZoomでは、この値を下げても表示されない。
    // ブラウザ地図左下の「Zoom x.x」を確認しながら調整する。
    nationalRouteNumberMinZoom: 4,
    // 高速道路・都市高速道路番号（transp.ftCode === 2903/2904）の公式レイヤ群を表示するか。
    showExpresswayRouteNumbers: true,
    // 公式spriteの道路番号icon-size倍率。1で公式値、大きくすると各Zoom帯の差を保ったまま大きくなる。
    routeNumberIconScale: 1,
    // 公式注記のtext-size倍率。1で公式値。大きくすると地名・道路番号等が全体に大きくなる。
    textSizeScale: 1,
    // 都道府県名の公式注記レイヤを表示するか。falseでmetadata.pathが明確に都道府県注記のレイヤだけを除外する。
    showPrefectureNames: true,
    // 市区町村名の公式注記レイヤを表示するか。Zoom別の注記構成は変更しない。
    showMunicipalityNames: true,
    // 市区町村名を一般注記より前面へ配置し、伊勢崎市などの自治体名を優先表示する。
    // タイルに存在しない市区町村名を新たに生成するものではない。
    prioritizeMunicipalityNames: true,
    // 公称町字名・集落名等の公式注記レイヤを表示するか。
    showMajorPlaceNames: true,
    // 山・湖・河川・海等の公式注記レイヤを表示するか。
    showNaturalNames: true,
    // 道路名の公式注記レイヤを表示するか。falseでも道路番号は別設定で残せる。
    showRoadNames: true,
    // 鉄道路線名・駅名の公式注記レイヤを表示するか。
    showRailwayNames: false,
  },

  visibility: {
    // contour source-layer全体の表示。falseで等高線・等深線・数値・崖部をまとめて除外する。
    contours: false,
    // elevation source-layer全体の表示。falseで標高点・水面標高・水深・火山標高をまとめて除外する。
    elevation: false,
    // building source-layer全体の表示。falseで個々の建物ポリゴンと外形線を除外する。
    buildings: false,
    // landforma/landforml/landformp等の細かな地形表現。falseで湿地・砂礫地・岩・崖等を除外する。
    detailedLandforms: false,
    // symbol source-layerのうち、ftCodeで明確に識別できる三角点・水準点・電子基準点の表示。
    // falseでもsource-layer "symbol"全体は消さず、低Zoomの主要都市等は公式のまま残す。
    mapSymbols: false,
    // railway source-layerの表示。falseで鉄道路線を背景地図から除外する。
    railways: true,
    // waterarea・river・lake・coastlineの表示。falseで水域と水系を除外する。
    water: true,
    // boundary source-layerの表示。falseで都道府県界・市区町村界を除外する。
    boundaries: false,
    // transp.ftCode === 2901の国道番号表示。falseで国道番号記号を除外する。
    nationalRouteNumbers: true,
    // transp.ftCode === 2903/2904の高速道路番号表示。falseで高速道路番号記号を除外する。
    expresswayRouteNumbers: true,
  },
} as const;
