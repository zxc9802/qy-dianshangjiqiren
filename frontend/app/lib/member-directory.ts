export const FIXED_MEMBER_NAMES = [
    '任亚琴',
    '黄小星',
    '何盈盈',
    '王凯',
    '李梦思',
    '王欣',
    '玛莉',
    '张亦淳',
    '李帅',
    '朱本徐',
    '姜望',
    '熊柳',
    '谷丹丹',
    '杨博',
    '王星',
    '李中淼',
    '李丽',
    '周正',
    '岳淑媛',
    '李玲',
    '邓子奕',
    '康志华',
    '庄凯钧',
    '陈倩',
    '陈巍',
    '黎清海',
    '牟芯谊',
    '陈梦迪',
    '冉江龙',
    '罗嘉俊',
] as const;

export const FIXED_GROUP_NAMES = [
    '视频组',
    '技术组',
    '运营组',
    '产品开发组',
    '商务组',
    '设计组',
    '客服组',
    '人事部',
    '其他',
] as const;

const MEMBER_NAME_SET = new Set<string>(FIXED_MEMBER_NAMES);
const GROUP_NAME_SET = new Set<string>(FIXED_GROUP_NAMES);

export function isAllowedMemberName(value: string): boolean {
    return MEMBER_NAME_SET.has(value.trim());
}

export function isAllowedGroupName(value: string): boolean {
    return GROUP_NAME_SET.has(value.trim());
}
