// 背景地図の配色。公式スタイル由来の施設名称色等はそのまま維持する。
export const GSI_COLOR_CONFIG = {
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
  // road source-layerのmotorway === 1に使う高速道路色。オレンジ色ルートと識別しやすい緑色とする。
  motorway: '#0e8536',
  // road source-layerのrdCtg === 0に使う一般国道色。オレンジ色ルートと混同しにくい淡いベージュとする。
  nationalRoad: '#eccd7f',
  // road source-layerのrdCtg === 1に使う都道府県道色。道路網を主張させない淡い青灰色とする。
  prefecturalRoad: '#cfdbe4',
  // road source-layerのその他道路に使う線色。市区町村道や細街路を背景へ溶け込ませる。
  otherRoad: '#E4E8EB',
  // 高速道路の外周線色。緑の道路本体を青灰色で縁取る。
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

  terrain: {
    // DEM標高着色の不透明度。1に近いほど標高色が強く、0に近いほど下地が見える。
    opacity: 0.85,
    // [標高m, 色] の順。標高帯の間は線形補間し、平地から山地への色変化を作る。
    stops: [
[0,   '#EEF4EA'],
[50,  '#E8F3E5'],
[150, '#E0F1DE'],
      [300, '#D4F2DF'],
      [600, '#C8EDD5'],
      [1000, '#BDE8CC'],
      [1500, '#B5E2C4'],
      [2000, '#B9DDBF'],
      [3000, '#CDD9BE'],
      [4000, '#DEDCC8'],
    ],
  },
} as const;
