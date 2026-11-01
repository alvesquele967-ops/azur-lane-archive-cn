<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Anchor, ArchiveRestore, Check, ChevronDown, DatabaseBackup, Download, ExternalLink,
  Bell, Filter, Home, Info, Library, Mail, Menu, Network, Palette, Redo2, RefreshCw, Search, Settings,
  ShieldCheck, Star, Undo2, Upload, Users, Wrench, X
} from 'lucide-vue-next'
import AdvancedHub from './components/AdvancedHub.vue'
import SearchSelect from './components/SearchSelect.vue'
import type { AppData, AppMail, AppSettings, EquipmentPreset, FleetPreset, NewsItem, Ship, Skin, CollectionGroup, UpdateHistory, WikiRecord } from './types'
import { getRarityOrder } from './sync'

const ships = ref<Ship[]>([])
const skins = ref<Skin[]>([])
const collectionGroups = ref<CollectionGroup[]>([])
const wikiRecords = ref<WikiRecord[]>([])
const news = ref<NewsItem[]>([])
const updateHistory = ref<UpdateHistory[]>([])
const mails = ref<AppMail[]>([])
const equipmentPresets = ref<EquipmentPreset[]>([])
const fleets = ref<FleetPreset[]>([])
const settings = ref<AppSettings>({ nameMode: 'cn', autoRefresh: true, refreshHour: 4, refreshMinute: 0, backgroundMode: false, notifications: true, lastAutoRefresh: '', home: { shipId: '', skinId: '', scale: 1, offsetX: 0, offsetY: 0 } })
const meta = ref<AppData['meta']>({ lastSync: '', dataVersion: '', sourceLabel: '' })
const loading = ref(true)
const error = ref('')
const search = ref('')
const typeFilter = ref('全部舰种')
const rarityFilter = ref('全部稀有度')
const factionFilter = ref('全部阵营')
const acquisitionFilter = ref('全部获取方式')
const collectionFilter = ref<'全部' | '已收集' | '未收集'>('全部')
const sortBy = ref<'rarity' | 'number' | 'name'>('number')
const viewMode = ref<'normal' | 'retrofit' | 'collection' | 'owned' | 'skins'>('normal')
const advancedSection = ref<null | 'home' | 'database' | 'news' | 'mail' | 'graph' | 'presets' | 'fleet' | 'settings'>('home')
const historyState = reactive({ canUndo: false, canRedo: false })
const groupFilter = ref<'角色' | '联动' | '方案舰' | 'META'>('角色')
const selected = ref<Ship | null>(null)
const selectedSkin = ref<Skin | null>(null)
const skinThemeFilter = ref('全部主题')
const skinAcquisitionFilter = ref('全部获取方式')
const skinArtFilter = ref('全部立绘类型')
const skinSort = ref<'date' | 'ship' | 'name'>('date')
const syncProgress = ref(0)
const syncStage = ref('')
const syncing = ref(false)
const toast = ref('')
const menuOpen = ref(false)
const sourceOpen = ref(false)
const viewerUrl = ref('')
const viewerScale = ref(1)
const viewerOffset = reactive({ x: 0, y: 0 })
const viewerDrag = ref<{ x: number; y: number } | null>(null)
const visibleLimit = ref(120)
let toastTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | undefined
let unsubscribeData: (() => void) | undefined

const rarityColors: Record<string, string> = {
  '海上传奇': '#f7d878', '决战方案': '#ffba63', '超稀有': '#f4c353', '最高方案': '#f1bf58',
  '精锐': '#a98bf2', '稀有': '#72b8f4', '普通': '#b6c1cb'
}

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 3200)
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const data = await window.desktopApi.getData()
    ships.value = data.ships
    skins.value = data.skins || []
    collectionGroups.value = data.collectionGroups || []
    wikiRecords.value = data.wikiRecords || []
    news.value = data.news || []
    updateHistory.value = data.updateHistory || []
    mails.value = data.mails || []
    equipmentPresets.value = data.equipmentPresets || []
    fleets.value = data.fleets || []
    settings.value = data.settings || settings.value
    meta.value = data.meta
    Object.assign(historyState, await window.desktopApi.getCollectionHistoryState())
  } catch (cause) {
    error.value = `本地资料库读取失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally { loading.value = false }
}

const unique = (field: keyof Ship) => computed(() => [...new Set(ships.value.map(s => String(s[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const types = unique('type')
const rarities = computed(() => [...new Set(ships.value.map(s => s.rarity))].sort((a, b) => getRarityOrder(b) - getRarityOrder(a)))
const factions = unique('faction')
const acquisitions = computed(() => [...new Set(ships.value.flatMap(s => s.acquisition))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const skinThemes = computed(() => [...new Set(skins.value.map(s => s.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const skinAcquisitions = computed(() => [...new Set(skins.value.map(s => s.acquisition).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const skinArtTypes = computed(() => [...new Set(skins.value.map(s => s.artType).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const optionList = (first: string, values: string[]) => [{ value: first, label: first }, ...values.map(value => ({ value, label: value }))]

const modeShips = computed(() => ships.value.filter(ship => {
  if (viewMode.value === 'retrofit') return ship.isRetrofit
  if (viewMode.value === 'collection') return false
  if (viewMode.value === 'owned') return !ship.isRetrofit && ship.owned
  if (viewMode.value === 'skins') return false
  if (ship.isRetrofit) return false
  if (groupFilter.value === '联动') return ship.group === '联动'
  if (groupFilter.value === '方案舰') return ship.group === '方案'
  if (groupFilter.value === 'META') return ship.group === 'META'
  return !['联动', '方案', 'META'].includes(ship.group)
}))

const filteredShips = computed(() => {
  const key = search.value.trim().toLocaleLowerCase()
  return modeShips.value.filter(ship => {
    if (key && !`${ship.name} ${ship.displayName} ${ship.number} ${ship.faction} ${ship.type}`.toLocaleLowerCase().includes(key)) return false
    if (typeFilter.value !== '全部舰种' && ship.type !== typeFilter.value) return false
    if (rarityFilter.value !== '全部稀有度' && ship.rarity !== rarityFilter.value) return false
    if (factionFilter.value !== '全部阵营' && ship.faction !== factionFilter.value) return false
    if (acquisitionFilter.value !== '全部获取方式' && !ship.acquisition.includes(acquisitionFilter.value)) return false
    if (collectionFilter.value === '已收集' && !ship.owned) return false
    if (collectionFilter.value === '未收集' && ship.owned) return false
    return true
  }).sort((a, b) => {
    if (sortBy.value === 'rarity') return getRarityOrder(b.rarity) - getRarityOrder(a.rarity) || a.number.localeCompare(b.number)
    if (sortBy.value === 'number') return a.number.localeCompare(b.number, undefined, { numeric: true })
    return a.displayName.localeCompare(b.displayName, 'zh-CN')
  })
})

const visibleShips = computed(() => filteredShips.value.slice(0, visibleLimit.value))
const filteredSkins = computed(() => {
  const key = search.value.trim().toLocaleLowerCase()
  return skins.value.filter(skin => {
    if (key && !`${skin.shipName} ${skin.name} ${skin.theme} ${skin.faction}`.toLocaleLowerCase().includes(key)) return false
    if (typeFilter.value !== '全部舰种' && skin.type !== typeFilter.value) return false
    if (factionFilter.value !== '全部阵营' && skin.faction !== factionFilter.value) return false
    if (skinThemeFilter.value !== '全部主题' && skin.theme !== skinThemeFilter.value) return false
    if (skinAcquisitionFilter.value !== '全部获取方式' && skin.acquisition !== skinAcquisitionFilter.value) return false
    if (skinArtFilter.value !== '全部立绘类型' && skin.artType !== skinArtFilter.value) return false
    if (collectionFilter.value === '已收集' && !skin.owned) return false
    if (collectionFilter.value === '未收集' && skin.owned) return false
    return true
  }).sort((a, b) => {
    if (skinSort.value === 'date') return b.releaseDate.localeCompare(a.releaseDate)
    if (skinSort.value === 'ship') return a.shipName.localeCompare(b.shipName, 'zh-CN') || a.releaseDate.localeCompare(b.releaseDate)
    return a.name.localeCompare(b.name, 'zh-CN')
  })
})
const visibleSkins = computed(() => filteredSkins.value.slice(0, visibleLimit.value))
const ownedCount = computed(() => ships.value.filter(s => !s.isRetrofit && s.owned).length)
const totalCount = computed(() => ships.value.filter(s => !s.isRetrofit).length)
const unownedCount = computed(() => totalCount.value - ownedCount.value)
const percentage = computed(() => totalCount.value ? (ownedCount.value / totalCount.value * 100) : 0)
const ownedSkinCount = computed(() => skins.value.filter(s => s.owned).length)
const headerOwnedCount = computed(() => viewMode.value === 'skins' ? ownedSkinCount.value : ownedCount.value)
const headerTotalCount = computed(() => viewMode.value === 'skins' ? skins.value.length : totalCount.value)
const headerPercentage = computed(() => headerTotalCount.value ? headerOwnedCount.value / headerTotalCount.value * 100 : 0)
const hasFilters = computed(() => search.value || typeFilter.value !== '全部舰种' || rarityFilter.value !== '全部稀有度' || factionFilter.value !== '全部阵营' || acquisitionFilter.value !== '全部获取方式' || skinThemeFilter.value !== '全部主题' || skinAcquisitionFilter.value !== '全部获取方式' || skinArtFilter.value !== '全部立绘类型' || collectionFilter.value !== '全部')

const relatedGroups = computed(() => {
  if (!selected.value) return []
  return (selected.value.acquisitionGroups || []).map(group => ({
    ...group,
    ships: ships.value.filter(ship => !ship.isRetrofit && !ship.owned && ship.id !== selected.value?.id &&
      (ship.acquisitionGroups || []).some(candidate => candidate.key === group.key))
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  })).filter(group => group.ships.length > 0)
})

watch([search, typeFilter, rarityFilter, factionFilter, acquisitionFilter, collectionFilter, sortBy, viewMode, groupFilter, skinThemeFilter, skinAcquisitionFilter, skinArtFilter, skinSort], () => { visibleLimit.value = 120 })

function clearFilters() {
  search.value = ''
  typeFilter.value = '全部舰种'
  rarityFilter.value = '全部稀有度'
  factionFilter.value = '全部阵营'
  acquisitionFilter.value = '全部获取方式'
  skinThemeFilter.value = '全部主题'
  skinAcquisitionFilter.value = '全部获取方式'
  skinArtFilter.value = '全部立绘类型'
  collectionFilter.value = '全部'
}

function setMode(mode: 'normal' | 'retrofit' | 'collection' | 'owned' | 'skins') {
  advancedSection.value = null
  viewMode.value = mode
  collectionFilter.value = '全部'
  visibleLimit.value = 120
  selected.value = null
  selectedSkin.value = null
}

function setAdvanced(mode: NonNullable<typeof advancedSection.value>) {
  advancedSection.value = mode
  selected.value = null
  selectedSkin.value = null
}

const pageTitle = computed(() => {
  if (advancedSection.value) return ({ home: '港区主页', database: '资料中心', news: '官方资讯', mail: '邮件中心', graph: '关系图谱', presets: '装备预设', fleet: '舰队编成', settings: '设置' } as const)[advancedSection.value]
  return viewMode.value === 'normal' ? '图鉴' : viewMode.value === 'retrofit' ? '改造图鉴' : viewMode.value === 'collection' ? '收藏' : viewMode.value === 'owned' ? '已拥有' : '皮肤图鉴'
})
const pageSubtitle = computed(() => advancedSection.value ? advancedSection.value.toUpperCase() : viewMode.value === 'normal' ? 'HANDBOOK' : viewMode.value === 'retrofit' ? 'RETROFIT' : viewMode.value === 'collection' ? 'COLLECTION' : viewMode.value === 'owned' ? 'OWNED' : 'SKINS')

async function setVisibleOwned(owned: boolean) {
  const targets = filteredShips.value
  if (!targets.length) return
  const ok = await window.desktopApi.setManyOwned(targets.map(ship => ship.id), owned)
  if (ok) { targets.forEach(ship => { ship.owned = owned }); Object.assign(historyState, await window.desktopApi.getCollectionHistoryState()); showToast(owned ? `已批量点亮 ${targets.length} 艘` : `已批量取消 ${targets.length} 艘`) }
}

async function undoCollection() {
  const result = await window.desktopApi.undoCollection()
  if (result.ok) await loadData()
  showToast(result.message)
}

async function redoCollection() {
  const result = await window.desktopApi.redoCollection()
  if (result.ok) await loadData()
  showToast(result.message)
}

function handleShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undoCollection() }
  else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) { event.preventDefault(); redoCollection() }
}

function collectionShip(name: string) {
  return ships.value.find(ship => !ship.isRetrofit && (ship.name === name || ship.displayName === name))
}

function shipMaxStars(ship?: Ship) {
  if (!ship) return 0
  if (ship.rarity === '普通') return 4
  if (['稀有', '精锐'].includes(ship.rarity)) return 5
  return 6
}

function groupStars(group: CollectionGroup) {
  return group.shipNames.reduce((total, name) => total + (collectionShip(name)?.collectionStars || 0), 0)
}

async function adjustShipStars(ship: Ship | undefined, delta: number) {
  if (!ship) return
  const next = Math.max(0, Math.min(shipMaxStars(ship), (ship.collectionStars || 0) + delta))
  const previous = ship.collectionStars || 0
  ship.collectionStars = next
  ship.owned = next > 0
  const ok = await window.desktopApi.setShipStars(ship.id, next)
  if (!ok) { ship.collectionStars = previous; ship.owned = previous > 0; showToast('星级进度保存失败') }
}

async function toggleSkinOwned(skin: Skin, event?: Event) {
  event?.stopPropagation()
  const next = !skin.owned
  skin.owned = next
  if (selectedSkin.value?.id === skin.id) selectedSkin.value.owned = next
  const ok = await window.desktopApi.setSkinOwned(skin.id, next)
  if (!ok) { skin.owned = !next; showToast('皮肤收藏状态保存失败') }
  else showToast(next ? `已收藏皮肤「${skin.name}」` : `已取消收藏皮肤「${skin.name}」`)
}

async function toggleOwned(ship: Ship, event?: Event) {
  event?.stopPropagation()
  const next = !ship.owned
  ship.owned = next
  if (selected.value?.id === ship.id) selected.value.owned = next
  const ok = await window.desktopApi.setOwned(ship.id, next)
  if (!ok) {
    ship.owned = !next
    showToast('收藏状态保存失败')
  } else {
    Object.assign(historyState, await window.desktopApi.getCollectionHistoryState())
    showToast(next ? `已点亮「${ship.displayName}」` : `已取消点亮「${ship.displayName}」`)
  }
}

async function sync() {
  if (syncing.value) return
  syncing.value = true
  syncProgress.value = 3
  syncStage.value = '准备同步'
  menuOpen.value = false
  try {
    const result = await window.desktopApi.syncData()
    if (result.ok) { await loadData(); showToast(`同步完成：本地共有 ${result.count} 艘舰船`) }
    else showToast(result.message)
  } catch (cause) { showToast(`同步失败：${cause instanceof Error ? cause.message : String(cause)}`) }
  finally { syncing.value = false; syncProgress.value = 0; syncStage.value = '' }
}

async function exportData(includeShips = false) {
  menuOpen.value = false
  const result = await window.desktopApi.exportData({ includeShips })
  showToast(result.message)
}

async function importData() {
  menuOpen.value = false
  const result = await window.desktopApi.importData()
  if (result.ok) await loadData()
  showToast(result.message)
}

async function backupDatabase() {
  menuOpen.value = false
  const result = await window.desktopApi.backupDatabase()
  showToast(result.message)
}

function openUrl(url: string) { window.desktopApi.openExternal(url) }
function shipLabel(ship: Ship) { return settings.value.nameMode === 'original' ? ship.name : ship.displayName }
function equipmentRecordByName(name: string) { return wikiRecords.value.find(record => record.module === 'equipment' && (record.name === name || record.name.startsWith(name))) }
function openViewer(url: string) { if (!url) return; viewerUrl.value = url; viewerScale.value = 1; viewerOffset.x = 0; viewerOffset.y = 0 }
function viewerWheel(event: WheelEvent) { viewerScale.value = Math.max(.25, Math.min(5, viewerScale.value - event.deltaY * .0015)) }
function viewerDown(event: PointerEvent) { viewerDrag.value = { x: event.clientX - viewerOffset.x, y: event.clientY - viewerOffset.y }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
function viewerMove(event: PointerEvent) { if (!viewerDrag.value) return; viewerOffset.x = event.clientX - viewerDrag.value.x; viewerOffset.y = event.clientY - viewerDrag.value.y }
function formatDate(value: string) {
  if (!value) return '尚未同步'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

onMounted(async () => {
  unsubscribe = window.desktopApi.onSyncProgress(payload => {
    syncStage.value = payload.stage
    syncProgress.value = Math.max(syncProgress.value, payload.progress)
  })
  unsubscribeData = window.desktopApi.onDataChanged(loadData)
  window.addEventListener('keydown', handleShortcut)
  await loadData()
})
onBeforeUnmount(() => { unsubscribe?.(); unsubscribeData?.(); window.removeEventListener('keydown', handleShortcut); if (toastTimer) clearTimeout(toastTimer) })
</script>

<template>
  <div class="app-shell" :class="{ 'home-active': advancedSection === 'home' }">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><Anchor :size="23" /></div>
        <div><h1>{{ pageTitle }}</h1><span>{{ advancedSection ? 'COMMAND CENTER' : viewMode === 'normal' ? 'HANDBOOK' : viewMode === 'retrofit' ? 'RETROFIT' : viewMode === 'collection' ? 'COLLECTION' : viewMode === 'owned' ? 'OWNED' : 'SKINS' }}</span></div>
      </div>
      <div class="top-actions">
        <div v-if="!advancedSection" class="hud-stat"><span>{{ viewMode === 'skins' ? '拥有皮肤' : '获得角色' }}</span><strong>{{ headerOwnedCount }}<i>/</i>{{ headerTotalCount }}</strong></div>
        <div v-if="!advancedSection" class="hud-stat"><span>总收藏率</span><strong>{{ headerPercentage.toFixed(1) }}<i>%</i></strong></div>
        <button class="source-chip" @click="sourceOpen = true"><ShieldCheck :size="15" /> 国服资料源 <span class="live-dot"></span></button>
        <button class="icon-button sync-button" :class="{ spinning: syncing }" title="立即同步" @click="sync"><RefreshCw :size="19" /></button>
        <div class="menu-wrap">
          <button class="icon-button" title="数据与备份" @click="menuOpen = !menuOpen"><Menu :size="20" /></button>
          <div v-if="menuOpen" class="dropdown-menu">
            <button @click="exportData(false)"><Download :size="17" /><span><b>导出收藏</b><small>可迁移的 JSON 文件</small></span></button>
            <button @click="exportData(true)"><ArchiveRestore :size="17" /><span><b>导出完整资料</b><small>收藏与舰船本地快照</small></span></button>
            <button @click="importData"><Upload :size="17" /><span><b>导入备份</b><small>恢复收藏与可选资料</small></span></button>
            <button @click="backupDatabase"><DatabaseBackup :size="17" /><span><b>备份数据库</b><small>复制原始 SQLite 文件</small></span></button>
          </div>
        </div>
      </div>
    </header>

    <div v-if="syncing" class="sync-strip"><div :style="{ width: `${syncProgress}%` }"></div><span>{{ syncStage }} · {{ syncProgress }}%</span></div>

    <nav class="game-sidebar" aria-label="图鉴分类">
      <div class="collection-word">COLLECTION</div>
      <button :class="{ active: advancedSection === 'home' }" @click="setAdvanced('home')"><Home :size="24" /><span>主页</span></button>
      <button :class="{ active: viewMode === 'normal' }" @click="setMode('normal')"><Anchor :size="27" /><span>图鉴</span></button>
      <button :class="{ active: viewMode === 'retrofit' }" @click="setMode('retrofit')"><RefreshCw :size="26" /><span>改造</span></button>
      <button :class="{ active: viewMode === 'collection' }" @click="setMode('collection')"><Star :size="27" /><span>收藏</span></button>
      <button :class="{ active: viewMode === 'owned' }" @click="setMode('owned')"><Check :size="27" /><span>拥有</span></button>
      <button :class="{ active: viewMode === 'skins' }" @click="setMode('skins')"><Palette :size="27" /><span>皮肤</span></button>
      <div class="sidebar-rule"></div>
      <button :class="{ active: advancedSection === 'database' }" @click="setAdvanced('database')"><Library :size="24" /><span>资料</span></button>
      <button :class="{ active: advancedSection === 'news' }" @click="setAdvanced('news')"><Bell :size="24" /><span>资讯</span></button>
      <button :class="{ active: advancedSection === 'mail' }" @click="setAdvanced('mail')"><Mail :size="24" /><span>邮件<i v-if="mails.some(item=>!item.read)" class="mail-dot">{{ mails.filter(item=>!item.read).length }}</i></span></button>
      <button :class="{ active: advancedSection === 'graph' }" @click="setAdvanced('graph')"><Network :size="24" /><span>关系</span></button>
      <button :class="{ active: advancedSection === 'presets' }" @click="setAdvanced('presets')"><Wrench :size="24" /><span>装备</span></button>
      <button :class="{ active: advancedSection === 'fleet' }" @click="setAdvanced('fleet')"><Users :size="24" /><span>编队</span></button>
      <button :class="{ active: advancedSection === 'settings' }" @click="setAdvanced('settings')"><Settings :size="24" /><span>设置</span></button>
      <button class="muted" @click="sourceOpen = true"><Info :size="22" /><span>说明</span></button>
    </nav>

    <main v-if="!advancedSection">
      <section v-if="viewMode === 'normal'" class="group-tabs">
        <button v-for="item in ['角色','联动','方案舰','META'] as const" :key="item" :class="{ active: groupFilter === item }" @click="groupFilter = item">{{ item }}</button>
      </section>

      <section v-if="viewMode !== 'skins' && viewMode !== 'collection'" class="controls-panel">
        <div class="search-box"><Search :size="18" /><input v-model="search" placeholder="搜索舰船名称、图鉴编号、舰种或阵营…" /><button v-if="search" @click="search = ''"><X :size="15" /></button></div>
        <div class="filter-row">
          <SearchSelect v-model="typeFilter" :options="optionList('全部舰种',types)" placeholder="舰种"/>
          <SearchSelect v-model="rarityFilter" :options="optionList('全部稀有度',rarities)" placeholder="稀有度"/>
          <SearchSelect v-model="factionFilter" :options="optionList('全部阵营',factions)" placeholder="阵营"/>
          <SearchSelect v-model="acquisitionFilter" :options="optionList('全部获取方式',acquisitions)" placeholder="获取方式"/>
          <div class="collection-tabs"><button v-for="item in ['全部','已收集','未收集'] as const" :key="item" :class="{ active: collectionFilter === item }" @click="collectionFilter = item">{{ item }}</button></div>
          <SearchSelect v-model="sortBy" :options="[{value:'rarity',label:'稀有度排序'},{value:'number',label:'图鉴编号'},{value:'name',label:'名称排序'}]" placeholder="排序"/>
        </div>
      </section>

      <section v-else class="controls-panel skin-controls">
        <div class="search-box"><Search :size="18" /><input v-model="search" placeholder="搜索舰船、皮肤名称、主题或阵营…" /><button v-if="search" @click="search = ''"><X :size="15" /></button></div>
        <div class="filter-row">
          <SearchSelect v-model="typeFilter" :options="optionList('全部舰种',types)" placeholder="舰种"/>
          <SearchSelect v-model="factionFilter" :options="optionList('全部阵营',factions)" placeholder="阵营"/>
          <SearchSelect v-model="skinThemeFilter" :options="optionList('全部主题',skinThemes)" placeholder="主题"/>
          <SearchSelect v-model="skinAcquisitionFilter" :options="optionList('全部获取方式',skinAcquisitions)" placeholder="获取方式"/>
          <SearchSelect v-model="skinArtFilter" :options="optionList('全部立绘类型',skinArtTypes)" placeholder="立绘类型"/>
          <div class="collection-tabs"><button v-for="item in ['全部','已收集','未收集'] as const" :key="item" :class="{ active: collectionFilter === item }" @click="collectionFilter = item">{{ item }}</button></div>
          <SearchSelect v-model="skinSort" :options="[{value:'date',label:'实装时间'},{value:'ship',label:'舰船名称'},{value:'name',label:'皮肤名称'}]" placeholder="排序"/>
        </div>
      </section>

      <section v-if="viewMode !== 'collection'" class="results-head"><div><span class="line"></span><h3>{{ viewMode === 'normal' ? `${groupFilter}图鉴` : viewMode === 'retrofit' ? '改造图鉴' : viewMode === 'owned' ? '已拥有舰船' : '皮肤图鉴' }}</h3><em>{{ viewMode === 'skins' ? filteredSkins.length : filteredShips.length }} RESULTS · {{ viewMode === 'skins' ? '实装时间顺序' : '图鉴编号顺序' }}</em></div><div class="result-meta"><span>最后同步 {{ formatDate(meta.lastSync) }}</span><button v-if="viewMode !== 'skins'" :disabled="!historyState.canUndo" title="撤销 Ctrl+Z" @click="undoCollection().then(loadData)"><Undo2 :size="14"/>撤销</button><button v-if="viewMode !== 'skins'" :disabled="!historyState.canRedo" title="重做 Ctrl+Y" @click="redoCollection().then(loadData)"><Redo2 :size="14"/>重做</button><button v-if="viewMode !== 'skins'" @click="setVisibleOwned(true)">全选</button><button v-if="viewMode !== 'skins'" @click="setVisibleOwned(false)">全不选</button><button v-if="hasFilters" @click="clearFilters">清除筛选</button></div></section>

      <section v-if="!loading && !error && viewMode === 'collection'" class="collection-board">
        <div class="collection-guide"><Star :size="18" /><span>收集指定舰船并调整突破星级，右侧会自动显示奖励达成状态。</span><b>{{ collectionGroups.length }} 组收藏</b></div>
        <article v-for="group in collectionGroups" :key="group.id" class="collection-shelf">
          <div class="collection-members">
            <div class="collection-group-title"><h3>{{ group.name }}</h3><span><Star :size="14" />{{ groupStars(group) }} / {{ group.rewards[group.rewards.length - 1]?.stars || 0 }}</span></div>
            <div class="collection-ship-row">
              <div v-for="shipName in group.shipNames" :key="shipName" class="collection-ship" :class="{ unlocked: (collectionShip(shipName)?.collectionStars || 0) > 0 }">
                <button class="collection-avatar" @click="selected = collectionShip(shipName) || null"><img v-if="collectionShip(shipName)?.avatarUrl" :src="collectionShip(shipName)?.avatarUrl" :alt="shipName" /><Anchor v-else :size="28" /></button>
                <strong>{{ collectionShip(shipName)?.displayName || shipName }}</strong>
                <div class="star-line">{{ '★'.repeat(collectionShip(shipName)?.collectionStars || 0) }}<span>{{ '★'.repeat(Math.max(0, shipMaxStars(collectionShip(shipName)) - (collectionShip(shipName)?.collectionStars || 0))) }}</span></div>
                <div class="star-stepper"><button @click="adjustShipStars(collectionShip(shipName), -1)">−</button><em>{{ collectionShip(shipName)?.collectionStars || 0 }}</em><button @click="adjustShipStars(collectionShip(shipName), 1)">＋</button></div>
              </div>
            </div>
          </div>
          <div class="collection-rewards">
            <div v-for="reward in group.rewards" :key="reward.stars" class="collection-reward" :class="{ achieved: groupStars(group) >= reward.stars }">
              <div><Star :size="15" /><b>{{ groupStars(group) }} / {{ reward.stars }}</b></div><strong>{{ reward.label }}</strong><span>{{ groupStars(group) >= reward.stars ? '已达成' : '未达成' }}</span>
            </div>
          </div>
        </article>
      </section>

      <div v-if="loading" class="state-panel"><div class="loader"></div><h3>正在开启舰船典籍</h3><p>读取本地数据库与收藏状态…</p></div>
      <div v-else-if="error" class="state-panel error"><Info :size="36" /><h3>资料库未能开启</h3><p>{{ error }}</p></div>
      <div v-else-if="viewMode !== 'skins' && viewMode !== 'collection' && !filteredShips.length" class="state-panel"><Search :size="36" /><h3>没有匹配的舰船</h3><p>尝试清除部分筛选条件。</p><button @click="clearFilters">清除筛选</button></div>
      <div v-else-if="viewMode === 'skins' && !filteredSkins.length" class="state-panel"><Palette :size="36" /><h3>没有匹配的皮肤</h3><p>尝试清除部分筛选条件。</p><button @click="clearFilters">清除筛选</button></div>

      <section v-if="!loading && !error && viewMode !== 'skins' && viewMode !== 'collection' && filteredShips.length" class="ship-grid">
        <article v-for="ship in visibleShips" :key="ship.id" class="ship-card" :class="[{ owned: ship.owned }, `rarity-${getRarityOrder(ship.rarity)}`]" tabindex="0" @click="selected = ship" @keydown.enter="selected = ship">
          <div class="rarity-rail" :style="{ '--rarity': rarityColors[ship.rarity] || '#7fa0b7' }"></div>
          <div class="ship-image">
            <img v-if="ship.artUrl || ship.avatarUrl" :src="ship.artUrl || ship.avatarUrl" :alt="ship.displayName" loading="lazy" />
            <div v-else class="image-fallback"><Anchor :size="30" /></div>
            <span class="number">NO.{{ ship.number || '—' }}</span>
            <button class="owned-toggle" :title="ship.owned ? '取消点亮' : '点亮收藏'" @click="toggleOwned(ship, $event)"><Check v-if="ship.owned" :size="19" /><Star v-else :size="18" /></button>
          </div>
          <div class="ship-card-body">
            <div class="name-row"><h4>{{ shipLabel(ship) }}</h4><span :style="{ color: rarityColors[ship.rarity] }">{{ ship.rarity }}</span></div>
            <div class="tags"><span>{{ ship.type }}</span><i></i><span>{{ ship.faction }}</span></div>
            <div class="acquisition"><span v-for="way in ship.acquisition.slice(0, 2)" :key="way">{{ way }}</span></div>
          </div>
        </article>
      </section>
      <section v-if="!loading && !error && viewMode === 'skins' && filteredSkins.length" class="ship-grid skin-grid">
        <article v-for="skin in visibleSkins" :key="skin.id" class="ship-card skin-card" :class="{ owned: skin.owned }" tabindex="0" @click="selectedSkin = skin" @keydown.enter="selectedSkin = skin">
          <div class="rarity-rail" :style="{ '--rarity': skin.artType === 'L2D+' ? '#f0a7ff' : skin.artType.includes('L2D') ? '#ffd061' : skin.artType.includes('动态') ? '#a98bf2' : '#72b8f4' }"></div>
          <div class="ship-image">
            <img v-if="skin.imageUrl" :src="skin.imageUrl" :alt="`${skin.shipName} ${skin.name}`" loading="lazy" />
            <div v-else class="image-fallback"><Palette :size="30" /></div>
            <span class="number skin-type">{{ skin.artType }}</span>
            <button class="owned-toggle" :title="skin.owned ? '取消收藏皮肤' : '收藏皮肤'" @click="toggleSkinOwned(skin, $event)"><Check v-if="skin.owned" :size="19" /><Star v-else :size="18" /></button>
          </div>
          <div class="ship-card-body skin-card-body">
            <div class="name-row"><h4>{{ skin.name }}</h4></div>
            <div class="tags"><span>{{ skin.shipName }}</span><i></i><span>{{ skin.theme }}</span></div>
          </div>
        </article>
      </section>
      <button v-if="viewMode !== 'skins' && visibleLimit < filteredShips.length" class="load-more" @click="visibleLimit += 120">继续展开 <b>{{ Math.min(120, filteredShips.length - visibleLimit) }}</b> 艘舰船</button>
      <button v-if="viewMode === 'skins' && visibleLimit < filteredSkins.length" class="load-more" @click="visibleLimit += 120">继续展开 <b>{{ Math.min(120, filteredSkins.length - visibleLimit) }}</b> 款皮肤</button>
    </main>
    <main v-else class="advanced-main">
      <AdvancedHub :section="advancedSection" :ships="ships" :skins="skins" :records="wikiRecords" :news="news" :mails="mails" :history="updateHistory" :presets="equipmentPresets" :fleets="fleets" :settings="settings" @reload="loadData" @toast="showToast" @navigate="target => target === 'normal' ? setMode('normal') : setAdvanced(target as any)" @open-ship="ship => { selected = ship; advancedSection = null }" />
    </main>

    <footer><span>非官方玩家工具 · 不读取游戏账号</span><span>资料：{{ meta.sourceLabel }}</span></footer>

    <Transition name="drawer">
      <div v-if="selected" class="drawer-layer" @click.self="selected = null">
        <aside class="detail-drawer game-detail-screen">
          <button class="drawer-close" @click="selected = null"><X :size="21" /></button>
          <div class="detail-art">
            <img v-if="selected.artUrl" :src="selected.artUrl" :alt="`${shipLabel(selected)}立绘`" title="点击高清查看" @click="openViewer(selected.artUrl)" />
            <div v-else class="art-fallback"><Anchor :size="54" /><span>暂无立绘索引</span></div>
            <div class="art-gradient"></div>
            <div class="detail-title"><span>NO.{{ selected.number || '—' }} · {{ selected.faction }}</span><h2>{{ shipLabel(selected) }}</h2><p v-if="selected.displayName !== selected.name">和谐名：{{ selected.displayName }} · 原名：{{ selected.name }}</p></div>
          </div>
          <div class="detail-content">
            <button class="primary-owned" :class="{ active: selected.owned }" @click="toggleOwned(selected)"><Check v-if="selected.owned" :size="19" /><Star v-else :size="19" />{{ selected.owned ? '已加入舰队 · 点击取消' : '点亮为已拥有' }}</button>
            <div class="detail-badges"><span :style="{ '--badge': rarityColors[selected.rarity] }">{{ selected.rarity }}</span><span>{{ selected.type }}</span><span>{{ selected.faction }}</span><span>{{ selected.availability }}</span></div>
            <div v-if="selected.profile" class="game-profile-panel">
              <section class="profile-equipment"><header><h3>装备 <small>EQUIPMENTS</small></h3></header><div><article v-for="(slot,index) in selected.profile.equipmentSlots" :key="index"><img v-if="equipmentRecordByName(slot.initial)?.imageUrl" :src="equipmentRecordByName(slot.initial)?.imageUrl"/><Anchor v-else :size="26"/><b>{{ slot.initial || slot.type }}</b><span>{{ slot.type }}</span><small>{{ slot.efficiencyInitial || '—' }} → {{ slot.efficiencyMax || '—' }}</small></article></div></section>
              <section class="profile-attributes"><header><h3>属性 <small>ATTRIBUTES</small></h3><b>{{ selected.profile.armor || '未知装甲' }}</b></header><div class="attribute-grid"><span v-for="(value,key) in (selected.isRetrofit && Object.keys(selected.profile.statsRetrofit).length ? selected.profile.statsRetrofit : selected.profile.statsMax)" :key="key"><i>{{ key }}</i><strong>{{ value }}</strong><em v-if="selected.profile.ratings[key]">{{ selected.profile.ratings[key] }}</em></span></div></section>
              <section class="profile-skills"><article v-for="skill in selected.profile.skills" :key="skill.name"><div><Star :size="20"/></div><span><b>{{ skill.name }}</b><small>{{ skill.retrofit ? '改造技能' : '舰船技能' }}</small><p>{{ skill.description }}</p></span></article></section>
              <section class="profile-character"><h3>角色资料 <small>CHARACTER PROFILE</small></h3><div><span v-for="(value,key) in selected.profile.character" :key="key"><b>{{ key }}</b>{{ value }}</span></div><p v-if="selected.profile.evaluation">评价：{{ selected.profile.evaluation }}</p></section>
            </div>
            <div class="detail-section"><h3>获取情报</h3><div class="info-grid"><div><label>获取方式</label><strong>{{ selected.acquisition.join(' / ') }}</strong></div><div><label>当前状态</label><strong>{{ selected.availability }}</strong></div><div v-if="selected.buildTime"><label>建造时间</label><strong>{{ selected.buildTime }}</strong></div><div v-if="selected.releaseDate"><label>国服实装</label><strong>{{ selected.releaseDate }}</strong></div></div><p class="acquisition-text">{{ selected.acquisitionText }}</p><p v-if="selected.dropLocations" class="drop-text">海域记录：{{ selected.dropLocations }}</p><small>获取状态由公开资料规则归类，发生复刻、常驻调整时请以游戏内及国服最新公告为准。</small></div>
            <div v-if="relatedGroups.length" class="detail-section related-section">
              <h3>同来源未拥有汇总</h3>
              <p class="related-intro">按相同活动、关卡或同期实装批次，汇总尚未点亮的角色。</p>
              <div v-for="group in relatedGroups" :key="group.key" class="related-group">
                <div class="related-head"><span>{{ group.kind }}</span><b>{{ group.label }}</b><em>{{ group.ships.length }} 艘未拥有</em></div>
                <div class="related-ships">
                  <button v-for="ship in group.ships" :key="ship.id" @click="selected = ship">
                    <img v-if="ship.avatarUrl" :src="ship.avatarUrl" :alt="ship.displayName" />
                    <span>{{ ship.displayName }}</span><small>NO.{{ ship.number || '—' }}</small>
                  </button>
                </div>
              </div>
              <small>“同期实装”用于补充未明确标注活动专题的资料，建议结合国服公告核对。</small>
            </div>
            <div v-if="selected.cv || selected.artist" class="detail-section"><h3>档案资料</h3><div class="info-grid"><div v-if="selected.cv"><label>配音</label><strong>{{ selected.cv }}</strong></div><div v-if="selected.artist"><label>画师</label><strong>{{ selected.artist }}</strong></div></div></div>
            <div class="detail-section sources"><h3>资料与公告</h3><button @click="openUrl(selected.wikiUrl)"><span><b>BWIKI 舰船资料页</b><small>属性、立绘及获取记录</small></span><ExternalLink :size="17" /></button><button @click="openUrl(selected.officialSearchUrl)"><span><b>在 Bilibili 检索相关公告</b><small>核对活动复刻与获取状态</small></span><ExternalLink :size="17" /></button><button @click="openUrl('https://www.biligame.com/detail/?id=97')"><span><b>国服 Bilibili 游戏中心</b><small>运营公告与最新版本说明</small></span><ExternalLink :size="17" /></button></div>
          </div>
        </aside>
      </div>
    </Transition>

    <Transition name="drawer">
      <div v-if="selectedSkin" class="drawer-layer" @click.self="selectedSkin = null">
        <aside class="detail-drawer skin-detail-drawer">
          <button class="drawer-close" @click="selectedSkin = null"><X :size="21" /></button>
          <div class="detail-art skin-detail-art">
            <img v-if="selectedSkin.imageUrl" :src="selectedSkin.imageUrl" :alt="`${selectedSkin.shipName} ${selectedSkin.name}`" title="点击高清查看" @click="openViewer(selectedSkin.imageUrl)" />
            <div v-else class="art-fallback"><Palette :size="54" /><span>暂无皮肤立绘索引</span></div>
            <div class="art-gradient"></div>
            <div class="detail-title"><span>{{ selectedSkin.shipName }} · {{ selectedSkin.faction }}</span><h2>{{ selectedSkin.name }}</h2><p>{{ selectedSkin.theme }} · {{ selectedSkin.releaseDate }}</p></div>
          </div>
          <div class="detail-content">
            <button class="primary-owned" :class="{ active: selectedSkin.owned }" @click="toggleSkinOwned(selectedSkin)"><Check v-if="selectedSkin.owned" :size="19" /><Star v-else :size="19" />{{ selectedSkin.owned ? '已拥有此皮肤 · 点击取消' : '标记为已拥有皮肤' }}</button>
            <div class="detail-badges"><span>{{ selectedSkin.artType }}</span><span>{{ selectedSkin.type }}</span><span>{{ selectedSkin.faction }}</span><span>{{ selectedSkin.theme }}</span></div>
            <div class="detail-section"><h3>换装资料</h3><div class="info-grid"><div><label>获取方式</label><strong>{{ selectedSkin.acquisition }}</strong></div><div><label>原价</label><strong>{{ selectedSkin.price ? `${selectedSkin.price} 钻石` : '免费 / 特殊获取' }}</strong></div><div><label>实装时间</label><strong>{{ selectedSkin.releaseDate || '未知' }}</strong></div><div><label>立绘类型</label><strong>{{ selectedSkin.artType }}</strong></div><div v-if="selectedSkin.backgroundType"><label>背景</label><strong>{{ selectedSkin.backgroundType }}</strong></div><div v-if="selectedSkin.accessory"><label>背景物件</label><strong>{{ selectedSkin.accessory }}</strong></div></div><p v-if="selectedSkin.note" class="acquisition-text">备注：{{ selectedSkin.note }}</p></div>
            <div class="detail-section sources"><h3>资料页面</h3><button @click="openUrl(selectedSkin.wikiUrl)"><span><b>{{ selectedSkin.shipName }} BWIKI 页面</b><small>查看换装语音、差分与完整资料</small></span><ExternalLink :size="17" /></button><button @click="openUrl('https://wiki.biligame.com/blhx/换装图鉴')"><span><b>BWIKI 换装图鉴</b><small>核对最新换装收录</small></span><ExternalLink :size="17" /></button></div>
          </div>
        </aside>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="viewerUrl" class="viewer-layer" @click.self="viewerUrl = ''" @wheel.prevent="viewerWheel" @pointerdown="viewerDown" @pointermove="viewerMove" @pointerup="viewerDrag = null">
        <button class="viewer-close" @click="viewerUrl = ''"><X :size="22" /></button>
        <img :src="viewerUrl" :style="{ transform: `translate(${viewerOffset.x}px, ${viewerOffset.y}px) scale(${viewerScale})` }" />
        <div class="viewer-hint">滚轮缩放 · 拖动查看 · {{ Math.round(viewerScale * 100) }}%</div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="sourceOpen" class="modal-layer" @click.self="sourceOpen = false">
        <div class="source-modal"><button class="modal-close" @click="sourceOpen = false"><X :size="19" /></button><ShieldCheck :size="34" /><h2>资料来源说明</h2><p>本工具不登录游戏账号，也不调用来源不明的私人接口。</p><div><b>舰船、收藏与皮肤资料</b><span>Bilibili 托管的“碧蓝航线 BWIKI”公开 MediaWiki 页面。该内容由社区维护，并非游戏官方数据库。</span></div><div><b>获取状态与公告</b><span>提供国服 Bilibili 游戏中心及官方内容检索入口。活动复刻、永久常驻等状态以游戏内与国服最新公告为最终依据。</span></div><div><b>隐私与本地存储</b><span>舰船、星级和皮肤收藏状态保存在电脑本地 SQLite 数据库；只有主动同步时会访问上述公开页面。</span></div><button class="modal-primary" @click="sourceOpen = false">我已了解</button></div>
      </div>
    </Transition>

    <Transition name="toast"><div v-if="toast" class="toast-message"><Check :size="16" />{{ toast }}</div></Transition>
  </div>
</template>
