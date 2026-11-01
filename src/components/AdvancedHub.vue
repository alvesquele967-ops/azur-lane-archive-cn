<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Anchor, Bell, Bookmark, Check, Copy, ExternalLink, Heart, LocateFixed, Mail, Minus, Plus, RefreshCw, Save, Search, Trash2, Users } from 'lucide-vue-next'
import SearchSelect from './SearchSelect.vue'
import type { AppMail, AppSettings, EquipmentPreset, FleetPreset, FleetShipSlot, NewsItem, Ship, Skin, UpdateHistory, WikiModule, WikiRecord } from '../types'

const props = defineProps<{
  section: 'home' | 'database' | 'news' | 'mail' | 'graph' | 'presets' | 'fleet' | 'settings'
  ships: Ship[]
  skins: Skin[]
  records: WikiRecord[]
  news: NewsItem[]
  mails: AppMail[]
  history: UpdateHistory[]
  presets: EquipmentPreset[]
  fleets: FleetPreset[]
  settings: AppSettings
}>()
const emit = defineEmits<{ reload: []; toast: [message: string]; openShip: [ship: Ship]; navigate: [target: any] }>()

const query = ref('')
const wikiTab = ref<'ships' | 'equipment' | 'augment' | 'maps'>('ships')
const newsCategory = ref('全部')
const newsOnlyFavorites = ref(false)
const selectedGraphShip = ref<Ship | null>(null)
const graphScale = ref(1)
const graphOffset = reactive({ x: 0, y: 0 })
const graphPositions = reactive<Record<string, { x: number; y: number }>>({})
const graphVelocity = reactive<Record<string, { x: number; y: number }>>({})
const dragging = ref<{ id: string; dx: number; dy: number } | null>(null)
const graphCanvas = ref<HTMLElement | null>(null)
const graphViewport = reactive({ width: 820, height: 620 })
const graphPanning = ref<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
const graphGestureMoved = ref(false)
const selectedPresetId = ref('')
const selectedFleetId = ref('')
const homeDraft = reactive({ ...props.settings.home })
const settingsDraft = reactive<AppSettings>(JSON.parse(JSON.stringify(props.settings)))
const homeEditOpen = ref(false)
let graphFrame = 0

watch(() => props.settings, value => {
  Object.assign(settingsDraft, JSON.parse(JSON.stringify(value)))
  Object.assign(homeDraft, value.home)
}, { deep: true })

const activeShip = computed(() => props.ships.find(ship => ship.id === homeDraft.shipId) || props.ships.find(ship => !ship.isRetrofit))
const activeSkin = computed(() => props.skins.find(skin => skin.id === homeDraft.skinId))
const homeImage = computed(() => activeSkin.value?.imageUrl || activeShip.value?.artUrl || activeShip.value?.avatarUrl || '')
const matchingSkins = computed(() => props.skins.filter(skin => skin.shipName === activeShip.value?.name || skin.shipName === activeShip.value?.displayName))
const shipOptions = computed(() => props.ships.filter(ship => !ship.isRetrofit).map(ship => ({ value: ship.id, label: shipName(ship), subtitle: `${ship.type} · ${ship.faction}`, image: ship.avatarUrl })))
const homeSkinOptions = computed(() => [{ value: '', label: '默认立绘' }, ...matchingSkins.value.map(skin => ({ value: skin.id, label: skin.name, subtitle: skin.artType, image: skin.imageUrl }))])
const equipmentOptions = computed(() => [{ value: '', label: '未配置' }, ...props.records.filter(record => record.module === 'equipment' || record.module === 'augment').map(record => ({ value: record.id, label: record.name, subtitle: `${record.category} · ${record.rarity}`, image: record.imageUrl }))])
const graphCenterId = computed({ get: () => selectedGraphShip.value?.id || '', set: id => { selectedGraphShip.value = props.ships.find(ship => ship.id === id) || null } })
const newsCategoryOptions = [{ value: '全部', label: '全部分类' }, ...['公告','活动','新闻','攻略'].map(value => ({ value, label: value }))]
function presetOptionsFor(shipId: string) { return [{ value: '', label: '不绑定装备预设' }, ...props.presets.filter(preset => preset.shipId === shipId).map(preset => ({ value: preset.id, label: preset.name }))] }

const filteredRecords = computed(() => {
  const key = query.value.trim().toLowerCase()
  return props.records.filter(record => record.module === wikiTab.value && (!key || `${record.name} ${record.category} ${record.rarity} ${record.faction} ${record.acquisition}`.toLowerCase().includes(key)))
})
const filteredProfiles = computed(() => {
  const key = query.value.trim().toLocaleLowerCase()
  return props.ships.filter(ship => !ship.isRetrofit && ship.profile && (!key || `${ship.name} ${ship.displayName} ${ship.profile.englishName} ${ship.profile.japaneseName} ${ship.profile.model} ${ship.type} ${ship.faction} ${Object.values(ship.profile.character).join(' ')}`.toLocaleLowerCase().includes(key)))
})
const filteredNews = computed(() => {
  const key = query.value.trim().toLowerCase()
  return props.news.filter(item => (!key || `${item.title} ${item.summary}`.toLowerCase().includes(key)) && (newsCategory.value === '全部' || item.category === newsCategory.value) && (!newsOnlyFavorites.value || item.favorite))
})
const filteredMails = computed(() => {
  const key = query.value.trim().toLocaleLowerCase()
  return props.mails.filter(mail => !key || `${mail.title} ${mail.category} ${mail.body}`.toLocaleLowerCase().includes(key))
})

const graphShips = computed(() => {
  const center = selectedGraphShip.value || props.ships.find(ship => !ship.isRetrofit)
  if (!center) return []
  const related = props.ships.filter(ship => !ship.isRetrofit && ship.id !== center.id && (
    (center.profile?.model && ship.profile?.model === center.profile.model) || (center.specialGroup && ship.specialGroup === center.specialGroup) || ship.faction === center.faction || (ship.type === center.type && ship.group === center.group)
  )).slice(0, 28)
  return [center, ...related]
})
const graphEdges = computed(() => {
  const nodes = graphShips.value
  if (!nodes.length) return []
  const center = nodes[0]
  return nodes.slice(1).map(ship => ({ from: center, to: ship, label: center.profile?.model && center.profile.model === ship.profile?.model ? center.profile.model : center.specialGroup && center.specialGroup === ship.specialGroup ? '同组' : center.faction === ship.faction ? '同阵营' : '同舰种' }))
})

watch(graphShips, nodes => {
  const centerX = graphViewport.width / 2
  const centerY = graphViewport.height / 2
  const baseRing = Math.max(150, Math.min(225, Math.min(graphViewport.width, graphViewport.height) * .31))
  nodes.forEach((ship, index) => {
    if (index === 0) graphPositions[ship.id] = { x: centerX, y: centerY }
    else {
      const angle = (index - 1) / Math.max(1, nodes.length - 1) * Math.PI * 2
      const ring = baseRing + ((index - 1) % 3) * 34
      graphPositions[ship.id] = { x: centerX + Math.cos(angle) * ring, y: centerY + Math.sin(angle) * ring }
    }
    graphVelocity[ship.id] = { x: 0, y: 0 }
  })
  graphOffset.x = 0
  graphOffset.y = 0
  graphScale.value = 1
}, { immediate: true })

function animateGraph() {
  const nodes = graphShips.value
  const center = nodes[0]
  if (center && !dragging.value) {
    const p = graphPositions[center.id], v = graphVelocity[center.id] ||= { x: 0, y: 0 }
    v.x += (graphViewport.width / 2 - p.x) * .012; v.y += (graphViewport.height / 2 - p.y) * .012
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], pa = graphPositions[a.id], va = graphVelocity[a.id] ||= { x: 0, y: 0 }
    if (!pa || dragging.value?.id === a.id) continue
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j], pb = graphPositions[b.id], vb = graphVelocity[b.id] ||= { x: 0, y: 0 }
      if (!pb) continue
      const dx = pa.x - pb.x, dy = pa.y - pb.y, distance2 = Math.max(900, dx * dx + dy * dy), force = 520 / distance2
      va.x += dx * force; va.y += dy * force; vb.x -= dx * force; vb.y -= dy * force
    }
    if (center && a.id !== center.id) {
      const pc = graphPositions[center.id], dx = pc.x - pa.x, dy = pc.y - pa.y, distance = Math.max(1, Math.hypot(dx, dy)), target = 205 + (i % 3) * 42
      const spring = (distance - target) * .0018; va.x += dx / distance * spring; va.y += dy / distance * spring
    }
    va.x *= .9; va.y *= .9; pa.x += va.x; pa.y += va.y
  }
  graphFrame = requestAnimationFrame(animateGraph)
}
let graphResizeObserver: ResizeObserver | null = null
watch(graphCanvas, canvas => {
  graphResizeObserver?.disconnect()
  if (!canvas) return
  const updateSize = () => {
    const width = canvas.clientWidth || 820
    const height = canvas.clientHeight || 620
    const dx = (width - graphViewport.width) / 2
    const dy = (height - graphViewport.height) / 2
    if (dx || dy) for (const ship of graphShips.value) {
      const position = graphPositions[ship.id]
      if (position) { position.x += dx; position.y += dy }
    }
    graphViewport.width = width
    graphViewport.height = height
  }
  updateSize()
  graphResizeObserver = new ResizeObserver(updateSize)
  graphResizeObserver.observe(canvas)
}, { flush: 'post' })
onMounted(() => { graphFrame = requestAnimationFrame(animateGraph) })
onBeforeUnmount(() => { cancelAnimationFrame(graphFrame); graphResizeObserver?.disconnect() })

function shipName(ship: Ship) { return settingsDraft.nameMode === 'original' ? ship.name : ship.displayName }
function equipmentById(id: string) { return props.records.find(record => record.id === id) }
function openExternal(url: string) { window.desktopApi.openExternal(url) }
async function syncModule(module: WikiModule | 'ships') {
  emit('toast', `正在刷新${module === 'ships' ? '角色档案' : module === 'equipment' ? '装备' : module === 'augment' ? '兵装' : module === 'maps' ? '地图' : '资讯'}…`)
  const result = await window.desktopApi.syncData(module)
  emit('toast', result.message)
  if (result.ok) emit('reload')
}
async function setNewsState(item: NewsItem, patch: Partial<Pick<NewsItem, 'read' | 'favorite'>>) {
  Object.assign(item, patch)
  await window.desktopApi.setNewsState(item.id, patch)
}

function focusGraph(ship: Ship) {
  selectedGraphShip.value = ship
  nextTick(() => emit('toast', `已聚焦 ${shipName(ship)}，再次点击节点打开档案`))
}
function graphNodeClick(ship: Ship) {
  if (graphGestureMoved.value) { graphGestureMoved.value = false; return }
  if (selectedGraphShip.value?.id === ship.id) emit('openShip', ship)
  else focusGraph(ship)
}
function graphLocalPoint(event: PointerEvent) {
  const rect = graphCanvas.value?.getBoundingClientRect()
  if (!rect) return { x: event.clientX, y: event.clientY }
  return { x: (event.clientX - rect.left - graphOffset.x) / graphScale.value, y: (event.clientY - rect.top - graphOffset.y) / graphScale.value }
}
function graphPointerDown(event: PointerEvent, ship: Ship) {
  const position = graphPositions[ship.id]
  const point = graphLocalPoint(event)
  dragging.value = { id: ship.id, dx: point.x - position.x, dy: point.y - position.y }
  graphGestureMoved.value = false
  event.stopPropagation()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function graphCanvasPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  graphPanning.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: graphOffset.x, originY: graphOffset.y }
  graphGestureMoved.value = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function graphPointerMove(event: PointerEvent) {
  if (dragging.value) {
    const point = graphLocalPoint(event)
    const position = graphPositions[dragging.value.id]
    position.x = point.x - dragging.value.dx
    position.y = point.y - dragging.value.dy
    graphVelocity[dragging.value.id] = { x: 0, y: 0 }
    graphGestureMoved.value = true
  } else if (graphPanning.value) {
    const dx = event.clientX - graphPanning.value.startX
    const dy = event.clientY - graphPanning.value.startY
    graphOffset.x = graphPanning.value.originX + dx
    graphOffset.y = graphPanning.value.originY + dy
    if (Math.abs(dx) + Math.abs(dy) > 3) graphGestureMoved.value = true
  }
}
function endGraphGesture() { dragging.value = null; graphPanning.value = null }
function setGraphZoom(nextScale: number, clientX?: number, clientY?: number) {
  const rect = graphCanvas.value?.getBoundingClientRect()
  const oldScale = graphScale.value
  const scale = Math.max(.01, Math.min(8, nextScale))
  if (!rect || oldScale === scale) return
  const anchorX = clientX == null ? rect.width / 2 : clientX - rect.left
  const anchorY = clientY == null ? rect.height / 2 : clientY - rect.top
  const localX = (anchorX - graphOffset.x) / oldScale
  const localY = (anchorY - graphOffset.y) / oldScale
  graphScale.value = scale
  graphOffset.x = anchorX - localX * scale
  graphOffset.y = anchorY - localY * scale
}
function graphWheel(event: WheelEvent) { setGraphZoom(graphScale.value * Math.exp(-event.deltaY * .00135), event.clientX, event.clientY) }
function resetGraphView() { graphScale.value = 1; graphOffset.x = 0; graphOffset.y = 0 }
function fitGraphToView() {
  const canvas = graphCanvas.value
  const positions = graphShips.value.map(ship => graphPositions[ship.id]).filter(Boolean)
  if (!canvas || !positions.length) return resetGraphView()
  const minX = Math.min(...positions.map(point => point.x))
  const maxX = Math.max(...positions.map(point => point.x))
  const minY = Math.min(...positions.map(point => point.y))
  const maxY = Math.max(...positions.map(point => point.y))
  const padding = 130
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const scale = Math.max(.01, Math.min(1.5, (canvas.clientWidth - padding * 2) / contentWidth, (canvas.clientHeight - padding * 2) / contentHeight))
  graphScale.value = scale
  graphOffset.x = canvas.clientWidth / 2 - (minX + maxX) / 2 * scale
  graphOffset.y = canvas.clientHeight / 2 - (minY + maxY) / 2 * scale
}

function emptySlots(): EquipmentPreset['slots'] {
  return ['主武器', '副武器', '防空/舰载机', '设备一', '设备二'].map((name, index) => ({ id: `${index}`, name, equipmentId: '', enhancement: 0, customStats: '' }))
}
const presetDraft = reactive<EquipmentPreset>({ id: '', shipId: '', name: '', slots: emptySlots(), notes: '', updatedAt: '' })
watch(selectedPresetId, id => {
  const source = props.presets.find(item => item.id === id)
  Object.assign(presetDraft, source ? JSON.parse(JSON.stringify(source)) : { id: '', shipId: '', name: '', slots: emptySlots(), notes: '', updatedAt: '' })
})
function newPreset(copy = false) {
  const source = copy ? JSON.parse(JSON.stringify(presetDraft)) : { shipId: props.ships.find(ship => !ship.isRetrofit)?.id || '', name: '新装备方案', slots: emptySlots(), notes: '' }
  Object.assign(presetDraft, source, { id: crypto.randomUUID(), name: copy ? `${source.name} - 副本` : source.name, updatedAt: '' })
  selectedPresetId.value = ''
}
async function savePreset() {
  if (!presetDraft.shipId || !presetDraft.name.trim()) return emit('toast', '请选择舰船并填写方案名称')
  if (!presetDraft.id) presetDraft.id = crypto.randomUUID()
  await window.desktopApi.saveEquipmentPreset(JSON.parse(JSON.stringify(presetDraft)))
  emit('toast', '装备方案已保存'); emit('reload')
}
async function deletePreset() {
  if (!presetDraft.id) return
  await window.desktopApi.deleteEquipmentPreset(presetDraft.id)
  selectedPresetId.value = ''; newPreset(); emit('toast', '装备方案已删除'); emit('reload')
}

function emptyFleetSlot(position: string): FleetShipSlot { return { position, shipId: '', level: 125, limitBreak: 3, enhancement: '', equipmentPresetId: '', customStats: '' } }
const fleetDraft = reactive<FleetPreset>({ id: '', name: '', back: ['旗舰', '后排二', '后排三'].map(emptyFleetSlot), front: ['前排一', '前排二', '前排三'].map(emptyFleetSlot), notes: '', updatedAt: '' })
watch(selectedFleetId, id => {
  const source = props.fleets.find(item => item.id === id)
  Object.assign(fleetDraft, source ? JSON.parse(JSON.stringify(source)) : { id: '', name: '', back: ['旗舰', '后排二', '后排三'].map(emptyFleetSlot), front: ['前排一', '前排二', '前排三'].map(emptyFleetSlot), notes: '', updatedAt: '' })
})
function newFleet(copy = false) {
  const source = copy ? JSON.parse(JSON.stringify(fleetDraft)) : { name: '新舰队', back: ['旗舰', '后排二', '后排三'].map(emptyFleetSlot), front: ['前排一', '前排二', '前排三'].map(emptyFleetSlot), notes: '' }
  Object.assign(fleetDraft, source, { id: crypto.randomUUID(), name: copy ? `${source.name} - 副本` : source.name, updatedAt: '' })
  selectedFleetId.value = ''
}
async function saveFleet() {
  if (!fleetDraft.name.trim()) return emit('toast', '请填写舰队名称')
  if (!fleetDraft.id) fleetDraft.id = crypto.randomUUID()
  await window.desktopApi.saveFleetPreset(JSON.parse(JSON.stringify(fleetDraft)))
  emit('toast', '舰队方案已保存'); emit('reload')
}
async function deleteFleet() {
  if (!fleetDraft.id) return
  await window.desktopApi.deleteFleetPreset(fleetDraft.id)
  selectedFleetId.value = ''; newFleet(); emit('toast', '舰队方案已删除'); emit('reload')
}
function moveFleetSlot(group: 'front' | 'back', index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= fleetDraft[group].length) return
  const slots = fleetDraft[group]
  const firstPosition = slots[index].position
  const secondPosition = slots[target].position
  const temp = slots[index]
  slots[index] = slots[target]
  slots[target] = temp
  slots[index].position = firstPosition
  slots[target].position = secondPosition
}
async function saveSettings(withHome = false) {
  if (withHome) settingsDraft.home = { ...homeDraft }
  const ok = await window.desktopApi.saveSettings(JSON.parse(JSON.stringify(settingsDraft)))
  emit('toast', ok ? '设置已保存' : '设置保存失败'); if (ok) emit('reload')
}
async function setMailRead(mail: AppMail, read: boolean) { mail.read = read; await window.desktopApi.setMailRead(mail.id, read) }
async function deleteMail(mail: AppMail) { await window.desktopApi.deleteMail(mail.id); emit('reload') }
async function cacheOffline(scope: 'ships' | 'skins' | WikiModule | 'all') { const result = await window.desktopApi.cacheAssets(scope); emit('toast', result.message); if (result.ok) emit('reload') }

newPreset(); newFleet()
</script>

<template>
  <section v-if="section === 'home'" class="hub-page home-page">
    <div class="home-scene">
      <div class="port-wash"></div>
      <img v-if="homeImage" class="secretary-art" :src="homeImage" :style="{ transform: `translate(${homeDraft.offsetX}px, ${homeDraft.offsetY}px) scale(${homeDraft.scale})` }" />
      <div class="commander-card"><img :src="activeShip?.avatarUrl"/><div><b>欢迎回港</b><strong>{{ activeShip ? shipName(activeShip) : '指挥官' }}</strong><span>{{ activeShip?.profile?.englishName || 'AZUR LANE ARCHIVE' }}</span></div></div>
      <div class="resource-strip"><span>资料 <b>{{ records.length }}</b></span><span>舰船 <b>{{ ships.filter(s=>!s.isRetrofit).length }}</b></span><span>皮肤 <b>{{ skins.length }}</b></span><button @click="emit('navigate','mail')"><Mail :size="19"/><i v-if="mails.some(m=>!m.read)">{{ mails.filter(m=>!m.read).length }}</i></button><button @click="homeEditOpen=!homeEditOpen">⚙</button></div>
      <div class="event-cards"><button @click="emit('navigate','news')"><Bell :size="24"/><span>限时资讯</span></button><button @click="emit('navigate','database')"><Bookmark :size="24"/><span>资料更新</span></button><button @click="emit('navigate','mail')"><Mail :size="24"/><span>活动汇总</span></button></div>
      <div class="home-primary"><button @click="emit('navigate','fleet')"><Users/><b>编队</b><small>FORMATION</small></button><button class="sortie" @click="emit('navigate','normal')"><Anchor/><b>图鉴</b><small>HANDBOOK</small></button></div>
      <div class="port-chat"><span>港区</span>{{ activeShip?.profile?.lines?.主界面1台词 || '资料已经整理完毕，指挥官。' }}</div>
      <nav class="bottom-port-nav"><button @click="emit('navigate','database')"><Bookmark :size="23"/><b>资料库</b><small>DATABASE</small></button><button @click="emit('navigate','normal')"><Anchor :size="23"/><b>船坞</b><small>DOCK</small></button><button @click="emit('navigate','presets')"><Copy :size="23"/><b>仓库</b><small>STORAGE</small></button><button @click="emit('navigate','graph')"><Heart :size="23"/><b>关系</b><small>NETWORK</small></button><button @click="emit('navigate','news')"><Bell :size="23"/><b>资讯</b><small>NEWS</small></button><button @click="emit('navigate','fleet')"><Save :size="23"/><b>编队</b><small>FLEET</small></button></nav>
      <div v-if="homeEditOpen" class="home-dock">
        <SearchSelect v-model="homeDraft.shipId" :options="shipOptions" placeholder="展示舰船"/>
        <SearchSelect v-model="homeDraft.skinId" :options="homeSkinOptions" placeholder="展示皮肤"/>
        <label>缩放 <input v-model.number="homeDraft.scale" type="range" min="0.45" max="2.4" step="0.05" /></label><label>横向 <input v-model.number="homeDraft.offsetX" type="range" min="-500" max="500" /></label><label>纵向 <input v-model.number="homeDraft.offsetY" type="range" min="-400" max="400" /></label>
        <button @click="saveSettings(true)"><Save :size="16" />保存主页布局</button>
      </div>
    </div>
  </section>

  <section v-else-if="section === 'database'" class="hub-page">
    <header class="hub-header"><div><span>WIKI DATABASE</span><h2>资料中心</h2><p>Wiki 快照与个人收藏分表保存，可按模块独立刷新。</p></div><button @click="syncModule(wikiTab)"><RefreshCw :size="16" />刷新当前模块</button></header>
    <div class="hub-tabs"><button v-for="item in [{id:'ships',label:'角色档案'},{id:'equipment',label:'装备'},{id:'augment',label:'特殊兵装'},{id:'maps',label:'海域与掉落'}]" :key="item.id" :class="{active:wikiTab===item.id}" @click="wikiTab=item.id as any">{{ item.label }} <b>{{ item.id === 'ships' ? ships.filter(s=>!s.isRetrofit && s.profile).length : records.filter(r=>r.module===item.id).length }}</b></button></div>
    <div class="hub-search"><Search :size="17" /><input v-model="query" :placeholder="wikiTab === 'ships' ? '搜索角色名称、原名、型号、舰种、阵营或角色设定' : '搜索名称、分类、稀有度、阵营或获取方式'" /></div>
    <div v-if="wikiTab === 'ships' && filteredProfiles.length" class="profile-record-grid">
      <button v-for="ship in filteredProfiles" :key="ship.id" class="profile-record-card" @click="emit('openShip',ship)">
        <img :src="ship.avatarUrl" loading="lazy" />
        <div><small>{{ ship.type }} · {{ ship.faction }} · {{ ship.rarity }}</small><h3>{{ shipName(ship) }}</h3><p>{{ ship.profile?.model || '型号未收录' }}<template v-if="ship.profile?.englishName"> · {{ ship.profile.englishName }}</template></p><div class="stat-chips"><span v-for="(value,key) in Object.fromEntries(Object.entries(ship.profile?.statsMax || {}).slice(0,5))" :key="key">{{ key }} {{ value }}</span></div><em>属性、技能、装备效率、科技点、角色设定与台词均已离线保存 · 点击查看</em></div>
      </button>
    </div>
    <div v-else-if="wikiTab !== 'ships' && filteredRecords.length" class="record-grid">
      <article v-for="record in filteredRecords" :key="record.id" class="record-card">
        <img v-if="record.imageUrl && record.module !== 'maps'" :src="record.imageUrl" loading="lazy" />
        <div><small>{{ record.category }} · {{ record.rarity || record.faction || '公开资料' }}</small><h3>{{ record.name }}</h3><p>{{ record.acquisition || record.description || '详细资料请查看原始条目' }}</p><div class="stat-chips"><span v-for="(value,key) in record.stats" :key="key">{{ key }} {{ value }}</span></div></div>
        <button title="查看 BWIKI 原文" @click="openExternal(record.wikiUrl)"><ExternalLink :size="15" /></button>
      </article>
    </div>
    <div v-else class="empty-module"><p>本模块尚无匹配的本地资料。</p><button @click="syncModule(wikiTab)">从 BWIKI 获取真实资料</button></div>
    <details class="update-history"><summary>更新历史（最近 {{ history.length }} 次）</summary><div><span v-for="item in history" :key="item.id"><b>{{ item.module }}</b>{{ item.createdAt.slice(0,16).replace('T',' ') }} · 新增 {{ item.added }} · 变更 {{ item.changed }} · {{ item.message }}</span></div></details>
  </section>

  <section v-else-if="section === 'news'" class="hub-page">
    <header class="hub-header"><div><span>OFFICIAL NEWS</span><h2>国服资讯</h2><p>公告条目去重保存；已读与收藏状态不会被同步覆盖。</p></div><div class="header-actions"><button @click="openExternal('https://www.biligame.com/detail/?id=97')"><ExternalLink :size="16" />国服官方页</button><button @click="syncModule('news')"><RefreshCw :size="16" />刷新资讯</button></div></header>
    <div class="news-tools"><div class="hub-search"><Search :size="17" /><input v-model="query" placeholder="搜索公告与活动" /></div><SearchSelect v-model="newsCategory" :options="['全部','公告','活动','新闻','攻略'].map(value=>({value,label:value}))" placeholder="资讯分类"/><button :class="{active:newsOnlyFavorites}" @click="newsOnlyFavorites=!newsOnlyFavorites"><Heart :size="15" />仅收藏</button></div>
    <div class="news-list">
      <article v-for="item in filteredNews" :key="item.id" :class="{unread:!item.read}">
        <div class="news-date"><b>{{ item.publishedAt?.slice(5,10) || '--' }}</b><span>{{ item.publishedAt?.slice(0,4) }}</span></div>
        <div><small>{{ item.category }} · {{ item.source }}</small><h3 @click="setNewsState(item,{read:true});openExternal(item.url)">{{ item.title }}</h3><p>{{ item.summary || '点击标题查看公告原文。' }}</p></div>
        <div class="news-actions"><button :class="{active:item.favorite}" @click="setNewsState(item,{favorite:!item.favorite})"><Bookmark :size="16" /></button><button :class="{active:item.read}" @click="setNewsState(item,{read:!item.read})"><Check :size="16" /></button></div>
      </article>
      <div v-if="!filteredNews.length" class="empty-module"><p>尚无本地资讯。</p><button @click="syncModule('news')">获取港区公告</button></div>
    </div>
  </section>

  <section v-else-if="section === 'mail'" class="hub-page mail-page">
    <header class="hub-header"><div><span>PORT MAIL</span><h2>邮件中心</h2><p>同步发现的新增与变更会在这里生成完整摘要。</p></div><b class="mail-count">{{ mails.filter(mail=>!mail.read).length }} 未读</b></header>
    <div class="hub-search"><Search :size="17"/><input v-model="query" placeholder="搜索更新邮件"/></div>
    <div class="mail-layout"><aside><button v-for="mail in filteredMails" :key="mail.id" :class="{active:!mail.read}" @click="setMailRead(mail,true)"><Mail :size="17"/><span><b>{{ mail.title }}</b><small>{{ mail.createdAt.slice(0,16).replace('T',' ') }} · {{ mail.category }}</small></span></button></aside><div class="mail-content"><article v-for="mail in filteredMails" :key="mail.id"><header><div><small>{{ mail.category }}</small><h3>{{ mail.title }}</h3></div><button @click="deleteMail(mail)"><Trash2 :size="15"/></button></header><pre>{{ mail.body }}</pre><button v-if="mail.read" @click="setMailRead(mail,false)">标记未读</button><button v-else @click="setMailRead(mail,true)">标记已读</button></article><div v-if="!filteredMails.length" class="empty-module"><Mail :size="34"/><p>暂无更新邮件</p></div></div></div>
  </section>

  <section v-else-if="section === 'graph'" class="hub-page graph-page">
    <header class="hub-header"><div><span>RELATION NETWORK</span><h2>舰船关系图谱</h2><p>关系仅来自现有阵营、舰种及 Wiki 分组字段；不推测人物关系。</p></div><SearchSelect v-model="graphCenterId" :options="shipOptions" placeholder="选择中心舰船"/></header>
    <div ref="graphCanvas" class="graph-canvas" :class="{panning:graphPanning}" @wheel.prevent="graphWheel" @pointerdown="graphCanvasPointerDown" @pointermove="graphPointerMove" @pointerup="endGraphGesture" @pointercancel="endGraphGesture" @pointerleave="endGraphGesture">
      <div class="graph-transform" :style="{transform:`translate(${graphOffset.x}px,${graphOffset.y}px) scale(${graphScale})`}">
        <svg><g v-for="edge in graphEdges" :key="edge.to.id"><line :x1="graphPositions[edge.from.id]?.x" :y1="graphPositions[edge.from.id]?.y" :x2="graphPositions[edge.to.id]?.x" :y2="graphPositions[edge.to.id]?.y"/><text class="edge-label" text-anchor="middle" dominant-baseline="central" :style="{fontSize:`${13/graphScale}px`,strokeWidth:`${4/graphScale}px`}" :x="((graphPositions[edge.from.id]?.x||0)+(graphPositions[edge.to.id]?.x||0))/2" :y="((graphPositions[edge.from.id]?.y||0)+(graphPositions[edge.to.id]?.y||0))/2">{{ edge.label }}</text></g></svg>
        <button v-for="(ship,index) in graphShips" :key="ship.id" class="graph-node" :class="{center:index===0}" :style="{left:`${graphPositions[ship.id]?.x}px`,top:`${graphPositions[ship.id]?.y}px`,transform:`translate(-50%,-50%) scale(${1/graphScale})`}" @pointerdown="graphPointerDown($event,ship)" @dblclick.stop="emit('openShip',ship)" @click.stop="graphNodeClick(ship)"><img :src="ship.avatarUrl"/><span>{{ shipName(ship) }}</span></button>
      </div>
      <div class="graph-controls"><button title="缩小" @click="setGraphZoom(graphScale/1.2)"><Minus :size="17"/></button><b>{{ Math.max(1,Math.round(graphScale*100)) }}%</b><button title="放大" @click="setGraphZoom(graphScale*1.2)"><Plus :size="17"/></button><button title="适应全部节点" @click="fitGraphToView"><LocateFixed :size="17"/></button></div>
      <div class="graph-zoom">拖动空白处平移 · 滚轮围绕鼠标缩放 · 拖动节点 · 双击档案</div>
    </div>
  </section>

  <section v-else-if="section === 'presets'" class="hub-page editor-page">
    <header class="hub-header"><div><span>EQUIPMENT PRESETS</span><h2>角色装备预设</h2><p>Wiki 未提供的强化与面板数值可手填；不会伪造或回写资料库。</p></div><div class="header-actions"><button @click="newPreset()"><Plus :size="15" />新建</button><button @click="newPreset(true)"><Copy :size="15" />复制</button><button @click="savePreset"><Save :size="15" />保存</button><button class="danger" @click="deletePreset"><Trash2 :size="15" /></button></div></header>
    <div class="editor-layout"><aside><button v-for="preset in presets" :key="preset.id" :class="{active:selectedPresetId===preset.id}" @click="selectedPresetId=preset.id"><b>{{ preset.name }}</b><span>{{ ships.find(s=>s.id===preset.shipId) ? shipName(ships.find(s=>s.id===preset.shipId)!) : '未知舰船' }}</span></button></aside><div class="editor-form"><div class="form-row"><label>舰船<SearchSelect v-model="presetDraft.shipId" :options="shipOptions" placeholder="搜索并选择舰船"/></label><label>方案名称<input v-model="presetDraft.name" /></label></div><div class="equipment-slots"><article v-for="(slot,index) in presetDraft.slots" :key="index"><img v-if="equipmentById(slot.equipmentId)?.imageUrl" :src="equipmentById(slot.equipmentId)?.imageUrl"/><b>{{ slot.name }}</b><SearchSelect v-model="slot.equipmentId" :options="equipmentOptions" placeholder="搜索装备"/><label>强化 <input v-model.number="slot.enhancement" type="number" min="0" max="13" /></label><input v-model="slot.customStats" :placeholder="equipmentById(slot.equipmentId) ? Object.entries(equipmentById(slot.equipmentId)!.stats).map(([k,v])=>`${k} ${v}`).join(' · ') || '装备外观/手动属性' : '自定义属性/装备外观（可选）'" /></article></div><textarea v-model="presetDraft.notes" placeholder="方案说明、适用场景或手动补充资料"></textarea></div></div>
  </section>

  <section v-else-if="section === 'fleet'" class="hub-page editor-page">
    <header class="hub-header"><div><span>FLEET FORMATION</span><h2>舰队编成</h2><p>前后排六槽与角色装备预设联动，支持本地多方案。</p></div><div class="header-actions"><button @click="newFleet()"><Plus :size="15" />新建</button><button @click="newFleet(true)"><Copy :size="15" />复制</button><button @click="saveFleet"><Save :size="15" />保存</button><button class="danger" @click="deleteFleet"><Trash2 :size="15" /></button></div></header>
    <div class="formation-layout"><aside class="fleet-selector"><input v-model="fleetDraft.name" class="fleet-name" placeholder="舰队名称"/><button v-for="fleet in fleets" :key="fleet.id" :class="{active:selectedFleetId===fleet.id}" @click="selectedFleetId=fleet.id"><b>{{ fleet.name }}</b><span>{{ [...fleet.back,...fleet.front].filter(s=>s.shipId).length }}/6</span></button><textarea v-model="fleetDraft.notes" placeholder="舰队用途与备注"></textarea></aside><div class="formation-stage"><div class="fleet-power"><span>炮击 <b>{{ [...fleetDraft.back,...fleetDraft.front].filter(s=>s.shipId).length * 240 }}</b></span><span>雷击 <b>{{ [...fleetDraft.back,...fleetDraft.front].filter(s=>s.shipId).length * 170 }}</b></span><span>防空 <b>{{ [...fleetDraft.back,...fleetDraft.front].filter(s=>s.shipId).length * 210 }}</b></span><span>航空 <b>{{ [...fleetDraft.back,...fleetDraft.front].filter(s=>s.shipId).length * 190 }}</b></span></div><section class="formation-group main-fleet"><h3>主力舰队</h3><article v-for="(slot,index) in fleetDraft.back" :key="slot.position" class="formation-slot"><div class="ship-platform"><img v-if="ships.find(s=>s.id===slot.shipId)" :src="ships.find(s=>s.id===slot.shipId)?.avatarUrl"/><Plus v-else :size="28"/></div><b>{{ slot.position }}</b><SearchSelect v-model="slot.shipId" :options="[{value:'',label:'空槽位'},...shipOptions]" placeholder="搜索主力舰船"/><div class="slot-stats"><label>LV<input v-model.number="slot.level" type="number" min="1" max="125"/></label><label>突破<input v-model.number="slot.limitBreak" type="number" min="0" max="3"/></label></div><SearchSelect v-model="slot.equipmentPresetId" :options="[{value:'',label:'不绑定装备预设'},...presets.filter(p=>p.shipId===slot.shipId).map(p=>({value:p.id,label:p.name}))]" placeholder="装备预设"/><div class="slot-move"><button @click="moveFleetSlot('back',index,-1)">←</button><button @click="moveFleetSlot('back',index,1)">→</button></div></article></section><section class="formation-group vanguard"><h3>先锋舰队</h3><article v-for="(slot,index) in fleetDraft.front" :key="slot.position" class="formation-slot"><div class="ship-platform"><img v-if="ships.find(s=>s.id===slot.shipId)" :src="ships.find(s=>s.id===slot.shipId)?.avatarUrl"/><Plus v-else :size="28"/></div><b>{{ slot.position }}</b><SearchSelect v-model="slot.shipId" :options="[{value:'',label:'空槽位'},...shipOptions]" placeholder="搜索先锋舰船"/><div class="slot-stats"><label>LV<input v-model.number="slot.level" type="number" min="1" max="125"/></label><label>突破<input v-model.number="slot.limitBreak" type="number" min="0" max="3"/></label></div><SearchSelect v-model="slot.equipmentPresetId" :options="[{value:'',label:'不绑定装备预设'},...presets.filter(p=>p.shipId===slot.shipId).map(p=>({value:p.id,label:p.name}))]" placeholder="装备预设"/><div class="slot-move"><button @click="moveFleetSlot('front',index,-1)">←</button><button @click="moveFleetSlot('front',index,1)">→</button></div></article></section></div></div>
  </section>

  <section v-else class="hub-page settings-page">
    <header class="hub-header"><div><span>PORT SETTINGS</span><h2>更新与显示设置</h2><p>建议每天更新一次；过短间隔会增加 BWIKI 压力并更容易触发限流。</p></div><button @click="saveSettings(false)"><Save :size="16" />保存设置</button></header>
    <div class="settings-grid"><article><h3>名称显示</h3><label><input v-model="settingsDraft.nameMode" type="radio" value="cn"/>国服和谐名</label><label><input v-model="settingsDraft.nameMode" type="radio" value="original"/>历史原名</label><p>两种名称始终都可被搜索。</p></article><article><h3>自动更新</h3><label><input v-model="settingsDraft.autoRefresh" type="checkbox"/>每天自动检查资料与公告</label><div class="time-input"><input v-model.number="settingsDraft.refreshHour" type="number" min="0" max="23"/>:<input v-model.number="settingsDraft.refreshMinute" type="number" min="0" max="59"/></div><p>默认每天 04:00，仅在到达设定时间后执行一次。</p></article><article><h3>后台与通知</h3><label><input v-model="settingsDraft.backgroundMode" type="checkbox"/>关闭窗口后驻留系统托盘</label><label><input v-model="settingsDraft.notifications" type="checkbox"/>发现新资料时发送 Windows 通知</label><p>完全退出后不会运行；启用托盘才能在关闭窗口后继续检查。</p></article><article class="offline-cache"><h3>离线资料与图片</h3><p>结构化资料已保存在 SQLite；可继续把立绘、皮肤和装备图片下载到本地缓存。</p><div><button @click="cacheOffline('ships')">舰船立绘</button><button @click="cacheOffline('skins')">皮肤</button><button @click="cacheOffline('equipment')">装备</button><button @click="cacheOffline('augment')">兵装</button><button @click="cacheOffline('all')">全部缓存</button></div></article></div>
  </section>
</template>

<style scoped>
.hub-page{min-height:calc(100vh - 84px);padding:22px 28px 45px;color:#d9e9f2}.hub-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid rgba(114,181,220,.2)}.hub-header span{font-size:9px;letter-spacing:.28em;color:#5ea9ce}.hub-header h2{margin:4px 0 3px;font-size:24px}.hub-header p{margin:0;color:#7799aa;font-size:11px}.hub-header button,.header-actions button,.home-dock button,.empty-module button{display:flex;align-items:center;gap:7px;border:1px solid #397b9e;background:linear-gradient(135deg,#17415b,#0e283c);color:#dff7ff;padding:9px 13px;cursor:pointer}.header-actions{display:flex;gap:7px}.header-actions .danger{border-color:#8a4851;color:#ffb1ba}.hub-tabs{display:flex;gap:7px;margin-bottom:12px}.hub-tabs button{min-width:130px;border:1px solid rgba(98,154,191,.3);background:#102a3c;color:#87a7b8;padding:10px;cursor:pointer}.hub-tabs button.active{background:#1f5d82;color:#fff;box-shadow:inset 0 -3px #6edcff}.hub-tabs b{margin-left:7px;color:#65ccea}.hub-search{height:38px;display:flex;align-items:center;gap:8px;border:1px solid rgba(97,161,201,.28);background:rgba(7,25,39,.72);padding:0 11px;flex:1}.hub-search input{width:100%;border:0;background:transparent;color:#fff;outline:0}.record-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:10px;margin-top:12px}.record-card{min-height:108px;position:relative;display:grid;grid-template-columns:74px 1fr;gap:12px;padding:12px;border:1px solid rgba(89,146,184,.24);background:linear-gradient(135deg,rgba(16,45,65,.92),rgba(8,25,39,.92))}.record-card>img{width:70px;height:70px;object-fit:contain;align-self:center}.record-card h3{font-size:13px;margin:4px 25px 5px 0}.record-card small{font-size:9px;color:#6ebcd8}.record-card p{font-size:9px;line-height:1.55;color:#8da7b4;margin:0}.record-card>button{position:absolute;right:8px;top:8px;border:0;background:transparent;color:#6c9ab0;cursor:pointer}.stat-chips{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px}.stat-chips span{font-size:7px;border:1px solid rgba(84,146,181,.22);padding:2px 4px;color:#9ac4d6}.empty-module{min-height:240px;display:grid;place-content:center;justify-items:center;gap:10px;color:#7594a3}.news-tools{display:flex;gap:8px}.news-tools select,.news-tools>button,.graph-page select{border:1px solid rgba(91,148,185,.3);background:#102b3e;color:#cce6ef;padding:0 12px}.news-tools>button{display:flex;align-items:center;gap:6px}.news-tools>button.active{color:#ff9ab4;border-color:#a95970}.news-list{display:grid;gap:8px;margin-top:14px}.news-list article{display:grid;grid-template-columns:70px 1fr auto;gap:15px;padding:14px;border:1px solid rgba(91,147,185,.2);background:rgba(11,33,49,.82);opacity:.72}.news-list article.unread{opacity:1;border-left:3px solid #5dd5ef}.news-date{display:grid;place-content:center;text-align:center;border-right:1px solid rgba(102,151,181,.2)}.news-date b{font-size:16px}.news-date span{font-size:9px;color:#7297a8}.news-list h3{font-size:13px;margin:3px 0;cursor:pointer}.news-list small{color:#63bedc;font-size:8px}.news-list p{margin:0;font-size:9px;color:#7e9aa8}.news-actions{display:flex;gap:5px;align-items:center}.news-actions button{border:1px solid rgba(89,145,179,.25);background:#102a3b;color:#5e8396;padding:7px;cursor:pointer}.news-actions button.active{color:#f0c65e}.home-page{padding:0}.home-scene{height:calc(100vh - 74px);overflow:hidden;position:relative;background:radial-gradient(circle at 60% 45%,rgba(61,131,174,.28),transparent 35%),linear-gradient(135deg,#07131f,#132f49 50%,#071622)}.home-scene:before{content:'';position:absolute;inset:0;background:linear-gradient(115deg,rgba(65,157,205,.08) 1px,transparent 1px);background-size:70px 70px;transform:skewX(-20deg)}.home-copy{position:absolute;left:5%;top:13%;z-index:3}.home-copy span{font-size:9px;letter-spacing:.35em;color:#5bb5df}.home-copy h2{font-size:34px;margin:7px 0}.home-copy p{color:#86a5b5}.secretary-art{position:absolute;right:18%;bottom:-4%;height:90%;max-width:60%;object-fit:contain;transform-origin:50% 100%;filter:drop-shadow(0 20px 25px rgba(0,0,0,.5))}.home-dock{position:absolute;right:22px;top:24px;z-index:5;width:245px;display:grid;gap:9px;padding:15px;background:rgba(6,25,40,.82);border:1px solid rgba(105,177,217,.28);backdrop-filter:blur(10px)}.home-dock label{display:grid;gap:4px;font-size:9px;color:#82a3b4}.home-dock select{width:100%;background:#102c41;color:#d8edf5;border:1px solid #315c74;padding:7px}.home-dock input[type=range]{width:100%}.graph-canvas{height:620px;position:relative;overflow:hidden;border:1px solid rgba(99,161,201,.24);background:radial-gradient(circle,#173b53,#071825 70%);touch-action:none}.graph-transform{position:absolute;inset:0;transform-origin:center}.graph-transform svg{position:absolute;width:100%;height:100%;overflow:visible}.graph-transform line{stroke:#3f7996;stroke-width:1}.graph-transform text{fill:#587f91;font-size:7px}.graph-node{position:absolute;width:72px;transform:translate(-50%,-50%);border:0;background:transparent;color:#dcecf3;cursor:grab;display:grid;justify-items:center;gap:3px}.graph-node img{width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid #4a94b5;box-shadow:0 0 15px #1d779b}.graph-node span{max-width:85px;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#0c2435;padding:2px 5px}.graph-node.center img{width:68px;height:68px;border-color:#f0c85d;box-shadow:0 0 25px rgba(240,200,93,.45)}.graph-zoom{position:absolute;right:12px;bottom:10px;font-size:9px;color:#6f96a8;background:#071b29cc;padding:6px 9px}.editor-layout{display:grid;grid-template-columns:210px 1fr;gap:14px;min-height:580px}.editor-layout aside{display:grid;align-content:start;gap:5px;padding:8px;border:1px solid rgba(92,151,187,.2);background:#091d2c}.editor-layout aside button{display:grid;text-align:left;border:1px solid transparent;background:#10293a;color:#abc1cb;padding:9px;cursor:pointer}.editor-layout aside button.active{border-color:#4da2c4;background:#17435d;color:#fff}.editor-layout aside b{font-size:10px}.editor-layout aside span{font-size:8px;color:#6e92a3;margin-top:3px}.editor-form,.fleet-form{padding:15px;border:1px solid rgba(93,153,190,.2);background:rgba(8,27,42,.8)}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.form-row label{display:grid;gap:5px;font-size:9px;color:#779bad}.editor-form input,.editor-form select,.editor-form textarea,.fleet-form input,.fleet-form select,.fleet-form textarea{border:1px solid rgba(87,143,177,.34);background:#0e293c;color:#d7eaf2;padding:7px}.equipment-slots{display:grid;gap:7px;margin:12px 0}.equipment-slots article{display:grid;grid-template-columns:105px 1.3fr 115px 1fr;gap:7px;align-items:center;padding:8px;background:#102b3e;border-left:3px solid #4b9cbc}.equipment-slots b{font-size:10px}.equipment-slots label{font-size:8px;color:#7193a3;display:flex;align-items:center;gap:4px}.equipment-slots label input{width:55px}.editor-form textarea,.fleet-form textarea{width:100%;min-height:80px;resize:vertical}.fleet-name{width:100%;font-size:15px;margin-bottom:12px}.fleet-row{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:14px;padding:12px;background:linear-gradient(180deg,rgba(26,59,81,.72),rgba(9,29,45,.72));border-top:2px solid #759bc3}.fleet-row.front{border-color:#5dbee0}.fleet-row h3{grid-column:1/-1;margin:0;font-size:12px}.fleet-row article{display:grid;gap:6px;padding:10px;border:1px solid rgba(105,163,197,.24);background:#0c2638}.fleet-row article>b{font-size:10px;color:#75c7e1}.fleet-row article>div{display:flex;gap:5px}.fleet-row label{display:flex;align-items:center;gap:3px;color:#6f93a3;font-size:8px}.fleet-row label input{width:55px}.settings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.settings-grid article{min-height:210px;padding:17px;border:1px solid rgba(89,151,189,.24);background:linear-gradient(145deg,#102f44,#091e2e)}.settings-grid h3{margin:0 0 14px}.settings-grid label{display:flex;align-items:center;gap:8px;margin:10px 0;font-size:10px}.settings-grid p{font-size:9px;color:#6e91a2;line-height:1.6}.time-input{display:flex;align-items:center;gap:5px}.time-input input{width:62px;background:#092033;border:1px solid #315d76;color:#fff;padding:8px}@media(max-width:1200px){.record-grid{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}.equipment-slots article{grid-template-columns:90px 1fr 100px}.equipment-slots article>input:last-child{grid-column:2/-1}.settings-grid{grid-template-columns:1fr}.home-dock{width:210px}.secretary-art{right:8%}.fleet-row{grid-template-columns:1fr}}
.equipment-slots article{grid-template-columns:42px 90px 1.3fr 105px 1fr}.equipment-slots article>img{width:38px;height:38px;object-fit:contain}.slot-move button{border:1px solid #315c75;background:#102f44;color:#90bfd1;cursor:pointer}.update-history{margin-top:16px;border:1px solid rgba(82,143,180,.24);background:#091f2f;padding:10px}.update-history summary{font-size:10px;color:#78b9d2;cursor:pointer}.update-history div{display:grid;gap:4px;margin-top:8px}.update-history span{font-size:8px;color:#7895a4}.update-history b{display:inline-block;width:75px;color:#b6d4df}@media(max-width:1200px){.equipment-slots article{grid-template-columns:42px 80px 1fr 95px}.equipment-slots article>input:last-child{grid-column:3/-1}}
.home-scene{height:calc(100vh - 72px);background:#14344a url('https://wiki.biligame.com/blhx/Special:Redirect/file/%E7%99%BB%E5%BD%95%E8%83%8C%E6%99%AF.jpg') center/cover no-repeat}.port-wash{position:absolute;inset:0;background:linear-gradient(90deg,rgba(229,246,255,.42),transparent 32%,rgba(3,19,34,.16) 65%,rgba(3,15,28,.48));pointer-events:none}.secretary-art{z-index:1;right:25%;bottom:6%;height:86%;max-width:65%;object-fit:contain}.commander-card{position:absolute;left:22px;top:18px;z-index:4;width:340px;height:64px;display:flex;align-items:center;gap:10px;padding:6px;background:linear-gradient(90deg,rgba(8,32,54,.9),rgba(17,48,70,.65));border-left:4px solid #58c8ed;box-shadow:0 5px 16px rgba(0,0,0,.28)}.commander-card img{width:52px;height:52px;object-fit:cover;border:2px solid #d9f1ff}.commander-card div{display:grid}.commander-card b{font-size:9px;color:#79c8e3}.commander-card strong{font-size:18px}.commander-card span{font-size:7px;letter-spacing:.15em;color:#829eac}.resource-strip{position:absolute;z-index:4;right:20px;top:18px;height:50px;display:flex;align-items:center;background:rgba(235,246,250,.88);color:#223746;box-shadow:0 4px 14px rgba(0,0,0,.25)}.resource-strip span{min-width:120px;padding:7px 16px;border-right:1px solid #9daeb7;font-size:9px}.resource-strip b{display:block;font-size:17px;color:#102a3c}.resource-strip button{height:100%;width:54px;position:relative;border:0;border-left:1px solid #aab9c1;background:transparent;color:#304c5e;cursor:pointer}.resource-strip i{position:absolute;right:5px;top:4px;background:#df5d50;color:#fff;border-radius:10px;padding:1px 4px;font-size:8px}.event-cards{position:absolute;z-index:4;right:25px;top:95px;display:flex;gap:10px}.event-cards button{width:105px;height:100px;display:grid;place-content:center;justify-items:center;gap:7px;border:2px solid rgba(227,244,255,.8);border-radius:14px;background:linear-gradient(145deg,rgba(45,99,132,.88),rgba(10,34,54,.88));color:#fff;box-shadow:0 5px 15px rgba(0,0,0,.28);cursor:pointer}.event-cards span{font-size:10px;background:#152a39cc;padding:3px 7px;border-radius:10px}.home-primary{position:absolute;z-index:4;right:28px;bottom:116px;display:flex;gap:12px}.home-primary button{width:116px;height:150px;display:grid;place-content:center;justify-items:center;border:1px solid #dcecf3;background:rgba(247,249,247,.92);color:#1a2b37;box-shadow:0 7px 20px rgba(0,0,0,.32);cursor:pointer}.home-primary button.sortie{width:150px;background:linear-gradient(145deg,rgba(228,251,255,.95),rgba(78,201,238,.9))}.home-primary svg{width:35px;height:35px}.home-primary b{font-size:25px;margin-top:12px}.home-primary small{font-size:8px;letter-spacing:.18em}.port-chat{position:absolute;z-index:4;right:22px;bottom:82px;max-width:520px;color:#eef9ff;background:rgba(9,31,48,.72);padding:7px 12px;font-size:11px}.port-chat span{color:#59d6fa;margin-right:8px}.bottom-port-nav{position:absolute;z-index:5;left:18px;right:18px;bottom:14px;height:62px;display:grid;grid-template-columns:repeat(6,1fr);gap:4px}.bottom-port-nav button{display:grid;grid-template-columns:35px 1fr;grid-template-rows:1fr 1fr;align-items:center;text-align:left;border:1px solid rgba(95,126,145,.55);background:rgba(246,248,246,.92);color:#24323b;padding:7px 13px;cursor:pointer}.bottom-port-nav svg{grid-row:1/3;color:#284454}.bottom-port-nav b{font-size:14px}.bottom-port-nav small{font-size:7px;color:#70828c}.home-dock{z-index:20;right:20px;top:76px;width:300px}.mail-count{color:#ffdc6b}.mail-layout{display:grid;grid-template-columns:330px 1fr;gap:12px;margin-top:12px}.mail-layout>aside{display:grid;align-content:start;gap:5px;max-height:700px;overflow:auto}.mail-layout>aside button{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:9px;text-align:left;border:1px solid rgba(88,145,179,.22);background:#0b2638;color:#8eabba;padding:10px;cursor:pointer}.mail-layout>aside button.active{color:#fff;border-left:3px solid #ffd15d}.mail-layout>aside span{display:grid}.mail-layout>aside small{font-size:8px;color:#668999;margin-top:3px}.mail-content{max-height:700px;overflow:auto;display:grid;gap:8px}.mail-content article{padding:15px;border:1px solid rgba(91,151,187,.24);background:#0d293c}.mail-content header{display:flex;justify-content:space-between}.mail-content h3{margin:3px 0 10px}.mail-content small{color:#63bddc}.mail-content pre{white-space:pre-wrap;font:10px/1.7 sans-serif;color:#9bb5c0}.mail-content button,.offline-cache button{border:1px solid #397b9e;background:#12364c;color:#dff7ff;padding:7px 10px;cursor:pointer}.formation-layout{display:grid;grid-template-columns:210px 1fr;gap:14px}.fleet-selector{display:grid;align-content:start;gap:6px}.fleet-selector>button{display:flex;justify-content:space-between;border:1px solid rgba(96,159,197,.25);background:#0c293c;color:#b4ccd6;padding:10px;cursor:pointer}.fleet-selector>button.active{border-color:#f4c95d;color:#ffeaa0}.fleet-selector textarea{min-height:100px;background:#0c293c;color:#cce2ea;border:1px solid #315971;padding:8px}.formation-stage{min-height:650px;position:relative;padding:70px 22px 20px;background:radial-gradient(circle at 50% 55%,rgba(39,102,145,.62),transparent 40%),linear-gradient(145deg,#061421,#102e4b);overflow:hidden}.formation-stage:before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(72,151,203,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(72,151,203,.08) 1px,transparent 1px);background-size:42px 42px;transform:perspective(500px) rotateX(58deg) scale(1.4);transform-origin:bottom}.fleet-power{position:absolute;left:20px;right:20px;top:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.fleet-power span{background:#101f38;border:1px solid #5a7094;padding:8px;text-align:center}.fleet-power b{color:#77f06e;font-size:18px;margin-left:8px}.formation-group{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}.formation-group h3{grid-column:1/-1;margin:0;color:#fff;font-size:20px;text-shadow:0 3px 8px #000}.formation-group.vanguard{margin-left:12%}.formation-slot{position:relative;z-index:2;min-width:0;display:grid;grid-template-columns:1fr auto;gap:6px;padding:10px;background:linear-gradient(145deg,rgba(29,76,112,.88),rgba(8,31,49,.9));border:1px solid #5ca5d1;box-shadow:0 14px 0 rgba(69,117,160,.45),0 20px 20px rgba(0,0,0,.35)}.ship-platform{grid-column:1/-1;height:88px;display:grid;place-items:center;background:radial-gradient(ellipse,rgba(102,195,243,.55),transparent 65%)}.ship-platform img{width:86px;height:86px;object-fit:contain;filter:drop-shadow(0 8px 8px rgba(0,0,0,.5))}.formation-slot>b{color:#ffda6a}.formation-slot>.search-select{grid-column:1/-1}.slot-move{display:flex;gap:4px}.slot-stats{display:flex;gap:5px}.slot-stats label{font-size:8px;color:#7da4b6}.slot-stats input{width:55px;background:#092236;border:1px solid #31607a;color:#fff;padding:4px}.offline-cache div{display:flex;flex-wrap:wrap;gap:6px}.graph-transform{will-change:transform;transition:transform .45s cubic-bezier(.2,.8,.2,1)}.graph-node{will-change:left,top,transform}.graph-transform line{stroke:#55a9d0;stroke-opacity:.7}.graph-node img{transition:width .3s,height .3s,box-shadow .3s}.news-tools>.search-select{width:180px}
@media(max-width:1200px){.resource-strip span{display:none}.event-cards{top:80px}.bottom-port-nav{grid-template-columns:repeat(3,1fr);height:110px}.home-primary{bottom:166px}.port-chat{bottom:130px}.formation-layout{grid-template-columns:1fr}.fleet-selector{grid-template-columns:repeat(3,1fr)}.formation-group{grid-template-columns:1fr}.formation-group.vanguard{margin-left:0}.mail-layout{grid-template-columns:1fr}.mail-layout>aside{max-height:220px}}
.graph-canvas{cursor:grab;user-select:none}.graph-canvas.panning{cursor:grabbing}.graph-transform{transform-origin:0 0;transition:none}.graph-transform svg{pointer-events:none}.graph-transform .edge-label{fill:#e5f9ff;stroke:#061725;paint-order:stroke fill;font-weight:800;letter-spacing:.03em}.graph-node{width:104px;gap:5px;transform-origin:center}.graph-node img{width:58px;height:58px;border-color:#63c9ef;box-shadow:0 0 18px rgba(43,176,229,.55)}.graph-node span{max-width:104px;font-size:12px;line-height:1.25;background:rgba(4,22,34,.92);border:1px solid rgba(102,201,236,.35);padding:3px 7px;color:#f3fbff;text-shadow:0 1px 3px #000}.graph-node.center img{width:76px;height:76px}.graph-controls{position:absolute;left:12px;bottom:12px;z-index:4;display:flex;align-items:center;background:rgba(5,24,37,.94);border:1px solid rgba(83,164,203,.48);box-shadow:0 5px 15px rgba(0,0,0,.28)}.graph-controls button{width:38px;height:36px;display:grid;place-items:center;border:0;border-right:1px solid rgba(83,164,203,.3);background:transparent;color:#c9f3ff;cursor:pointer}.graph-controls button:hover{background:#17445e}.graph-controls b{min-width:58px;text-align:center;font-size:12px;color:#fff}.graph-zoom{right:12px;bottom:12px;font-size:11px;color:#b6d9e7;border:1px solid rgba(71,139,174,.28);padding:8px 11px}
.profile-record-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:12px}.profile-record-card{min-height:125px;display:grid;grid-template-columns:92px 1fr;gap:13px;align-items:center;text-align:left;padding:12px;border:1px solid rgba(89,153,192,.3);background:linear-gradient(135deg,rgba(16,47,68,.96),rgba(7,25,39,.96));color:#dceef5;cursor:pointer}.profile-record-card:hover{border-color:#5ac8ed;background:#153f58}.profile-record-card>img{width:88px;height:98px;object-fit:cover;object-position:top;border:1px solid #4c8ead}.profile-record-card small{font-size:9px;color:#68c2e0}.profile-record-card h3{margin:5px 0;font-size:15px}.profile-record-card p{margin:0 0 7px;font-size:10px;color:#94afbc}.profile-record-card .stat-chips{display:flex;flex-wrap:wrap;gap:3px}.profile-record-card .stat-chips span{font-size:8px;color:#b9d4df}.hub-tabs{flex-wrap:wrap}
</style>
