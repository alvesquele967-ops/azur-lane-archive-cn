export type Availability = '常驻' | '限时' | '活动限定' | '联动限定' | '科研常驻' | '暂不可获取' | '未知'

export interface Ship {
  id: string
  name: string
  displayName: string
  number: string
  rarity: string
  type: string
  faction: string
  group: string
  specialGroup: string
  isRetrofit?: boolean
  baseShipName?: string
  acquisition: string[]
  availability: Availability
  acquisitionText: string
  acquisitionGroups?: AcquisitionGroup[]
  dropLocations: string
  buildTime: string
  releaseDate: string
  cv: string
  artist: string
  avatarUrl: string
  artUrl: string
  wikiUrl: string
  officialSearchUrl: string
  syncedAt: string
  owned: boolean
  collectionStars?: number
  profile?: ShipProfile
}

export interface ShipSkill { name: string; description: string; retrofit?: boolean }
export interface ShipEquipmentSlot { type: string; initial: string; efficiencyInitial: string; efficiencyMax: string }
export interface ShipProfile {
  model: string
  englishName: string
  japaneseName: string
  armor: string
  initialStars: string
  statsInitial: Record<string, string>
  statsMax: Record<string, string>
  statsRetrofit: Record<string, string>
  ratings: Record<string, string>
  skills: ShipSkill[]
  equipmentSlots: ShipEquipmentSlot[]
  technology: Record<string, string>
  character: Record<string, string>
  lines: Record<string, string>
  evaluation: string
  retrofitDate: string
  retrofitRequirements: string
  rawUpdatedAt: string
}

export interface AcquisitionGroup {
  key: string
  label: string
  kind: '活动' | '关卡' | '同期实装' | '来源'
}

export interface Skin {
  id: string
  shipName: string
  name: string
  tag: string
  type: string
  faction: string
  theme: string
  price: string
  acquisition: string
  expression: string
  artType: string
  backgroundType: string
  accessory: string
  note: string
  releaseDate: string
  imageUrl: string
  wikiUrl: string
  syncedAt: string
  owned: boolean
}

export interface CollectionReward {
  stars: number
  label: string
}

export interface CollectionGroup {
  id: string
  name: string
  shipNames: string[]
  rewards: CollectionReward[]
  wikiUrl: string
}

export interface AppMeta {
  lastSync: string
  dataVersion: string
  sourceLabel: string
}

export type WikiModule = 'equipment' | 'augment' | 'maps' | 'news'

export interface WikiRecord {
  id: string
  module: WikiModule
  name: string
  category: string
  rarity: string
  faction: string
  description: string
  acquisition: string
  stats: Record<string, string>
  imageUrl: string
  wikiUrl: string
  updatedAt: string
}

export interface NewsItem {
  id: string
  title: string
  category: '公告' | '活动' | '新闻' | '攻略'
  summary: string
  publishedAt: string
  source: '国服官方' | 'BWIKI'
  url: string
  read: boolean
  favorite: boolean
}

export interface UpdateHistory {
  id: number
  module: WikiModule | 'ships' | 'skins' | 'all'
  added: number
  changed: number
  message: string
  createdAt: string
}

export interface EquipmentSlot {
  id: string
  name: string
  equipmentId: string
  equipmentName?: string
  iconUrl?: string
  enhancement?: number
  level?: number
  appearance?: string
  customStats: string
}

export interface EquipmentPreset {
  id: string
  shipId: string
  name: string
  slots: EquipmentSlot[]
  notes: string
  updatedAt: string
}

export interface FleetShipSlot {
  position: string
  shipId: string
  level: number
  limitBreak: number
  enhancement: string
  equipmentPresetId: string
  customStats: string
}

export interface FleetPreset {
  id: string
  name: string
  front: FleetShipSlot[]
  back: FleetShipSlot[]
  notes: string
  updatedAt: string
}

export interface HomeConfig {
  shipId: string
  skinId: string
  scale: number
  offsetX: number
  offsetY: number
}

export interface AppSettings {
  nameMode: 'cn' | 'original'
  autoRefresh: boolean
  refreshHour: number
  refreshMinute: number
  backgroundMode: boolean
  notifications: boolean
  lastAutoRefresh: string
  home: HomeConfig
}

export interface AppMail {
  id: number
  title: string
  category: string
  body: string
  createdAt: string
  read: boolean
}

export interface AppData {
  ships: Ship[]
  skins: Skin[]
  collectionGroups: CollectionGroup[]
  wikiRecords: WikiRecord[]
  news: NewsItem[]
  updateHistory: UpdateHistory[]
  equipmentPresets: EquipmentPreset[]
  fleets: FleetPreset[]
  settings: AppSettings
  mails: AppMail[]
  meta: AppMeta
}

export interface BackupPayload {
  format: 'azur-lane-archive-backup'
  version: 1
  exportedAt: string
  ownedIds: string[]
  ownedSkinIds?: string[]
  ships?: Omit<Ship, 'owned'>[]
  skins?: Omit<Skin, 'owned'>[]
  meta?: AppMeta
}

export interface SyncResult { ok: boolean; count: number; updatedAt: string; message: string }

export interface DesktopApi {
  getData(): Promise<AppData>
  setOwned(id: string, owned: boolean): Promise<boolean>
  setSkinOwned(id: string, owned: boolean): Promise<boolean>
  setShipStars(id: string, stars: number): Promise<boolean>
  syncData(module?: WikiModule | 'ships' | 'all'): Promise<SyncResult>
  setManyOwned(ids: string[], owned: boolean): Promise<boolean>
  undoCollection(): Promise<{ ok: boolean; message: string }>
  redoCollection(): Promise<{ ok: boolean; message: string }>
  getCollectionHistoryState(): Promise<{ canUndo: boolean; canRedo: boolean }>
  setNewsState(id: string, patch: Partial<Pick<NewsItem, 'read' | 'favorite'>>): Promise<boolean>
  saveEquipmentPreset(preset: EquipmentPreset): Promise<boolean>
  deleteEquipmentPreset(id: string): Promise<boolean>
  saveFleetPreset(fleet: FleetPreset): Promise<boolean>
  deleteFleetPreset(id: string): Promise<boolean>
  saveSettings(settings: AppSettings): Promise<boolean>
  setMailRead(id: number, read: boolean): Promise<boolean>
  deleteMail(id: number): Promise<boolean>
  cacheAssets(scope: 'ships' | 'skins' | WikiModule | 'all'): Promise<SyncResult>
  exportData(options: { includeShips: boolean }): Promise<{ ok: boolean; path?: string; message: string }>
  importData(): Promise<{ ok: boolean; count?: number; message: string }>
  backupDatabase(): Promise<{ ok: boolean; path?: string; message: string }>
  openExternal(url: string): Promise<boolean>
  onSyncProgress(callback: (payload: { stage: string; progress: number }) => void): () => void
  onDataChanged(callback: () => void): () => void
  platform: string
}

declare global { interface Window { desktopApi: DesktopApi } }
