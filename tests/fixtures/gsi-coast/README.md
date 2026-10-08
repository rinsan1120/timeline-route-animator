# Public GSI coastline fixtures

国土地理院最適化ベクトルタイルの公開地図データ（2026-10-08取得）。
ファイル名は `z-x-y.pbf`。PMTilesから展開したタイルをそのまま収録。
利用者のTimeline・旅行ルート・位置記録は含まない。

- 出典：国土地理院最適化ベクトルタイル
- 配信元：https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles
- データ仕様・利用規約：https://github.com/gsi-cyberjapan/optimal_bvmap

北海道北部の海岸・島と、Zoom 7 / 8 / 14で変わる陸海面の構成を固定し、
通信を必要としない回帰テストで海岸の精度・島の穴・タイル境界を検証する。
