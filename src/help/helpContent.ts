export const HELP_CONTENT = {
  timelineRange: {
    title: '読み込み範囲',
    body: '開始日のFromから終了日のToまでのTimelineデータを読み込みます。範囲外の位置情報は現在のルートには含まれません。',
  },
  mapMode: {
    title: '表示モード',
    body: '「表示」はルート確認、「編集」はポイントやDAYなどの変更、「アニメ範囲」は動画に使用する開始地点と終了地点の指定に使います。',
  },
  rawSignals: {
    title: '測位データ',
    body: 'Timeline JSON内のrawSignalsを補正時の参考として表示します。表示した測位点はルートへ自動追加されません。',
  },
  pointLabel: {
    title: '地点ラベル',
    body: '選択した地点に表示するバルーンの文字を設定します。プレビューと生成動画にも表示されます。',
  },
  pointPause: {
    title: '地点で停止',
    body: 'この地点へ到着したあと、指定した秒数だけ移動を停止します。停止時間は移動時間とは別に動画の出力時間へ追加されます。',
  },
  planDay: {
    title: 'DAY区切り',
    body: '選択した地点を新しいDAYの開始地点に設定します。DAY境界をまたぐ区間は走行距離へ加算されません。',
  },
  animationRange: {
    title: 'アニメーション範囲',
    body: 'プレビューと動画に使用するルートの開始地点と終了地点を指定します。指定しない場合はルート全体を使用します。',
  },
  cameraMode: {
    title: 'カメラ',
    body: '「全体表示」はルート全体を固定画角で表示し、「ルート追従」は移動マーカーを追いながらカメラを移動します。',
  },
  overviewZoom: {
    title: '全体表示のZoom',
    body: '「自動」はルート全体が動画内へ収まるよう調整します。「カスタム」では動画用のZoomを手動指定できます。',
  },
  followZoom: {
    title: '追従表示の表示範囲',
    body: 'ルート追従時の地図の広さを選択します。「広め」「標準」「寄り」またはカスタムZoomから選べます。',
  },
  routeMarker: {
    title: '地点マーカー',
    body: '動画上の地点表示をDAYマーカー、START / GOAL、または表示なしから選択します。',
  },
  introZoom: {
    title: '開始時ズーム',
    body: '動画開始時の3秒間で、広域表示から設定されたZoomまで徐々に拡大します。',
  },
  dayRouteColors: {
    title: 'DAYごとの色分け',
    body: '動画のルート線をDAYごとの固定色で表示します。走行距離表示を有効にしている場合は、各DAYの距離表示にも同じ色を使用します。',
  },
  movementDuration: {
    title: '移動時間',
    body: 'ルート上を移動する時間を設定します。地点の停止時間、開始前3秒、到着後3秒はこの時間とは別に追加されます。',
  },
  distanceHud: {
    title: '走行距離表示',
    body: 'DAYごとの概算走行距離とTOTALを動画上に表示します。計画したポイント間の地表上の直線距離を使用します。',
  },
  balloonScale: {
    title: 'バルーンサイズ',
    body: '地点ラベルのバルーン全体の大きさを調整します。',
  },
  balloonFontScale: {
    title: 'バルーン文字サイズ',
    body: '地点ラベル内の文字サイズを調整します。',
  },
} as const;

export type HelpKey = keyof typeof HELP_CONTENT;
