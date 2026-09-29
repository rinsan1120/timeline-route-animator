export const WORKSPACE_MODE_COPY = {
  timeline: {
    title: '移動実績参照モード',
    description: 'Googleマップのタイムラインからルートアニメを作成',
  },
  plan: {
    title: '計画モード',
    description: '地図上にポイントを配置して、ルートアニメを作成',
  },
  spot: {
    title: 'スポット画像モード',
    description: '地点情報などを配置した地図の画像を作成',
  },
} as const;
