// Acquisition classification is deliberately pure so it can be covered by tests.
export const getRarityOrder = (rarity: string) => ({
  '海上传奇': 7, '决战方案': 6, '超稀有': 5, '最高方案': 4, '精锐': 3, '稀有': 2, '普通': 1
}[rarity] ?? 0)

export const isMainFaction = (faction: string) => ['白鹰', '皇家', '重樱', '铁血', '东煌', '撒丁帝国', '北方联合', '自由鸢尾', '维希教廷', '郁金王国', '飓风'].includes(faction)
