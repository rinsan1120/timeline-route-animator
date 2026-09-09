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
 * - minZoomを大きくすると、より拡大するまで表示されなくなる
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

  colors: {
    // 地図全体の背景色。明るくするとアプリのオレンジ色ルートが相対的に目立つ。
    background: '#f7f8f7',
    // waterarea・river・lakeに使う水域色。濃くすると海・河川・湖が強調される。
    water: '#dcecf5',
    // coastlineの線色。濃くすると海岸線の輪郭が強く見える。
    coastline: '#a8c8d8',
    // road source-layerのmotorway === 1に使う高速道路色。ルート線より控えめな緑系とする。
    motorway: '#8eb59a',
    // road source-layerのrdCtg === 0に使う一般国道色。オレンジ色ルートと混同しにくい淡い赤系とする。
    nationalRoad: '#d9a0a5',
    // road source-layerのrdCtg === 1に使う都道府県道色。国道より一段弱い色にする。
    prefecturalRoad: '#c8b98c',
    // road source-layerのその他道路に使う線色。濃くすると市区町村道や細街路が目立つ。
    otherRoad: '#cbd0d4',
    // railway source-layerの線色。濃くすると鉄道が道路より強く見えるため控えめにする。
    railway: '#929ba3',
    // boundary source-layerの行政界色。濃くすると都道府県界・市区町村界が目立つ。
    boundary: '#9da5ad',
    // label source-layerの都道府県名・市区町村名・主要地名の文字色。
    placeLabel: '#4c5864',
    // label source-layerの山・湖・河川・海等の自然地名の文字色。
    naturalLabel: '#637783',
    // 道路名・鉄道路線名等の交通注記に使う文字色。
    transportLabel: '#68727c',
    // 注記の縁取り色。背景に近づけるほど地名の文字を柔らかく見せられる。
    labelHalo: '#ffffff',
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
      // 高速道路を表示し始めるZoom。大きくすると、より拡大するまで高速道路が表示されない。
      minZoom: 4,
      // 高速道路の広域時の線幅。大きくすると低Zoomでも高速道路が太く見える。
      widthAtMinZoom: 1.0,
      // 高速道路のZoom 18時の線幅。大きくすると拡大時の高速道路が太く見える。
      widthAtZoom18: 5.0,
    },
    nationalRoad: {
      // 国道（road.rdCtg === 0）を表示し始めるZoom。大きくすると国道の表示開始が遅くなる。
      minZoom: 8,
      // 国道の表示開始Zoom時の線幅。大きくすると国道が一般道より目立つ。
      widthAtMinZoom: 1.5,
      // 国道のZoom 18時の線幅。大きくすると拡大時の国道が太く見える。
      widthAtZoom18: 4.5,
    },
    prefecturalRoad: {
      // 都道府県道（road.rdCtg === 1）を表示し始めるZoom。大きくすると広域地図が簡潔になる。
      minZoom: 10,
      // 都道府県道の表示開始Zoom時の線幅。国道より細くして優先度を一段下げる。
      widthAtMinZoom: 1.0,
      // 都道府県道のZoom 18時の線幅。大きくすると拡大時の県道が太く見える。
      widthAtZoom18: 3.5,
    },
    otherRoad: {
      // 幅員が比較的大きい市区町村道等を表示し始めるZoom。大きくすると背景が簡潔になる。
      minZoom: 13,
      // その他道路の表示開始Zoom時の線幅。大きくすると一般道が強く見える。
      widthAtMinZoom: 0.7,
      // その他道路のZoom 18時の線幅。大きくすると拡大時の一般道が太く見える。
      widthAtZoom18: 2.5,
    },
    fineStreet: {
      // 細街路（road.rnkWidthが小さい道路）を表示し始めるZoom。大きくすると、より拡大するまで表示されない。
      minZoom: 15,
      // 細街路の表示開始Zoom時の線幅。大きくすると細街路の密度感が強くなる。
      widthAtMinZoom: 0.5,
      // 細街路のZoom 18時の線幅。大きくすると最大拡大付近で細街路が太くなる。
      widthAtZoom18: 1.5,
    },
  },

  lines: {
    // river source-layerの線幅。大きくすると河川が背景上で強く見える。
    riverWidth: 1.2,
    // coastline source-layerの線幅。大きくすると海岸線が強調される。
    coastlineWidth: 1.0,
    // railway source-layerの表示開始時の線幅。大きくすると鉄道が道路より目立ちやすくなる。
    railwayWidthAtMinZoom: 0.8,
    // railway source-layerのZoom 18時の線幅。大きくすると拡大時の鉄道が太くなる。
    railwayWidthAtZoom18: 2.0,
    // 都道府県界の線幅。大きくすると都道府県境が強く見える。
    prefectureBoundaryWidth: 1.2,
    // 市区町村界の線幅。大きくすると市区町村境が強く見える。
    municipalityBoundaryWidth: 0.8,
    // visibility.contoursを有効にした場合の等高線・等深線の線幅。
    contourWidth: 0.7,
  },

  features: {
    // waterarea・river・lake・coastlineを表示し始めるZoom。大きくすると広域時の水系表示が減る。
    waterMinZoom: 4,
    // railway source-layerを表示し始めるZoom。大きくすると、より拡大するまで鉄道が表示されない。
    railwayMinZoom: 6,
    // 都道府県界（boundary.ftCode === 1211/51212）を表示し始めるZoom。
    prefectureBoundaryMinZoom: 6,
    // 市区町村界（boundary.ftCode === 1212）を表示し始めるZoom。大きくすると行政界表示が簡潔になる。
    municipalityBoundaryMinZoom: 11,
    // contour source-layerを表示し始めるZoom。visibility.contoursがfalseの間は表示されない。
    contourMinZoom: 8,
    // elevation source-layerを表示し始めるZoom。visibility.elevationがfalseの間は表示されない。
    elevationMinZoom: 6,
    // building source-layerを表示し始めるZoom。visibility.buildingsがfalseの間は表示されない。
    buildingMinZoom: 13,
  },

  labels: {
    // 国道番号（transp.ftCode === 2901）を表示するか。falseで国道番号記号をすべて隠す。
    showNationalRouteNumbers: true,
    // 国道番号を表示し始めるZoom。大きくすると、より拡大するまで番号が表示されない。
    nationalRouteNumberMinZoom: 9,
    // 高速道路・都市高速道路番号（transp.ftCode === 2903/2904）を表示するか。
    showExpresswayRouteNumbers: true,
    // 高速道路番号を表示し始めるZoom。大きくすると広域表示で番号が減る。
    expresswayRouteNumberMinZoom: 8,
    // 道路番号spriteの表示倍率。大きくすると国道・高速道路番号の記号が大きくなる。
    routeNumberIconScale: 0.55,
    // 道路番号内の文字サイズ。大きくすると番号を読み取りやすいが地図を覆いやすくなる。
    routeNumberTextSize: 10,
    // 都道府県名（label.annoCtg === 140）を表示するか。falseで都道府県注記を隠す。
    showPrefectureNames: true,
    // 都道府県名を表示し始めるZoom。大きくすると広域時の都道府県名が減る。
    prefectureNameMinZoom: 8,
    // 市区町村名（label.annoCtg === 110）を表示するか。falseで市区町村注記を隠す。
    showMunicipalityNames: true,
    // 市区町村名を表示し始めるZoom。大きくすると、より拡大するまで表示されない。
    municipalityNameMinZoom: 8,
    // 公称町字名・集落名（label.annoCtg === 210/220/800）を表示するか。
    showMajorPlaceNames: true,
    // 主要居住地名を表示し始めるZoom。大きくすると背景の地名密度が下がる。
    majorPlaceNameMinZoom: 13,
    // 山・湖・河川・海等の主要自然地名を表示するか。falseで自然地名を隠す。
    showNaturalNames: true,
    // 主要自然地名を表示し始めるZoom。小さくすると広域地図にも自然地名が増える。
    naturalNameMinZoom: 6,
    // 道路名（label.annoCtg === 411）を表示するか。falseでも道路番号は別設定で残せる。
    showRoadNames: true,
    // 道路名を表示し始めるZoom。大きくすると細かな道路名の表示が遅くなる。
    roadNameMinZoom: 11,
    // 鉄道路線名・駅名（label.annoCtg === 421/422）を表示するか。
    showRailwayNames: true,
    // 鉄道注記を表示し始めるZoom。大きくすると広域時の鉄道名が減る。
    railwayNameMinZoom: 11,
    // 都道府県名の文字サイズ。大きくすると広域地図上で都道府県名が目立つ。
    prefectureTextSize: 15,
    // 市区町村名の文字サイズ。大きくすると市区町村名が読みやすくなる。
    municipalityTextSize: 13,
    // 主要地名・自然地名・交通注記の基本文字サイズ。大きくすると注記全体が目立つ。
    generalTextSize: 12,
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
    // symbol source-layerの専門的地図記号。falseで三角点等、経路把握に不要な記号を除外する。
    mapSymbols: false,
    // railway source-layerの表示。falseで鉄道路線を背景地図から除外する。
    railways: true,
    // waterarea・river・lake・coastlineの表示。falseで水域と水系を除外する。
    water: true,
    // boundary source-layerの表示。falseで都道府県界・市区町村界を除外する。
    boundaries: true,
    // transp.ftCode === 2901の国道番号表示。falseで国道番号記号を除外する。
    nationalRouteNumbers: true,
    // transp.ftCode === 2903/2904の高速道路番号表示。falseで高速道路番号記号を除外する。
    expresswayRouteNumbers: true,
  },
} as const;
