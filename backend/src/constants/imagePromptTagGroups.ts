export const IMAGE_PROMPT_TAG_GROUPS = [
    { key: 'platform', title: '平台定位' },
    { key: 'category', title: '商品类目' },
    { key: 'composition', title: '构图方式' },
    { key: 'camera', title: '镜头视角' },
    { key: 'style', title: '风格模板' },
    { key: 'background', title: '背景样式' },
    { key: 'lighting', title: '光线风格' },
    { key: 'material', title: '材质表现' },
    { key: 'colorMood', title: '色彩氛围' },
    { key: 'scene', title: '场景类型' },
    { key: 'model', title: '人群模特' },
    { key: 'action', title: '动作状态' },
    { key: 'sellingPoint', title: '卖点强化' },
    { key: 'copyLayout', title: '文案版式' },
    { key: 'props', title: '道具元素' },
    { key: 'brandTone', title: '品牌调性' },
    { key: 'campaign', title: '营销节点' },
    { key: 'output', title: '输出质量与约束' },
] as const;

export type ImagePromptTagGroupKey = (typeof IMAGE_PROMPT_TAG_GROUPS)[number]['key'];

export const IMAGE_PROMPT_TAG_GROUP_KEY_SET = new Set<string>(IMAGE_PROMPT_TAG_GROUPS.map((group) => group.key));
