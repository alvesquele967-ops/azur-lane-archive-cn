import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://wiki.biligame.com/blhx/api.php'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'AzurLaneArchiveCN/1.2 (public BWIKI reader; no account data)'
let lastRequest = 0

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function api(params, attempts = 4) {
  let error
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const wait = Math.max(0, 650 - (Date.now() - lastRequest))
      if (wait) await pause(wait)
      lastRequest = Date.now()
      const url = new URL(API)
      for (const [key, value] of Object.entries({ format: 'json', formatversion: 2, origin: '*', ...params })) url.searchParams.set(key, String(value))
      const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(40000) })
      if (!response.ok) throw new Error(`BWIKI HTTP ${response.status}`)
      return await response.json()
    } catch (next) {
      error = next
      await pause(1400 * (attempt + 1))
    }
  }
  throw error
}

function text(value) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? item.fulltext || item.raw || item.timestamp || '' : item).filter(Boolean).join('、')
  return String(value || '')
}

async function askAll(category, properties) {
  const records = []
  for (let offset = 0; offset < 5000; offset += 500) {
    const query = `[[分类:${category}]]${properties.map(item => `|?${item}`).join('')}|limit=500|offset=${offset}`
    const json = await api({ action: 'ask', query })
    const batch = Object.values(json.query?.results || {})
    records.push(...batch)
    if (batch.length < 500) break
  }
  return records
}

function equipmentRecord(entry, module) {
  const p = entry.printouts || {}
  const category = text(p['类型']) || (module === 'augment' ? '特殊兵装' : '装备')
  const name = entry.fulltext
  const stats = {}
  for (const key of ['伤害', '射速', '炮击', '雷击', '航空', '防空', '机动', '命中', '耐久', '装填', '反潜', '强化上限']) {
    const value = text(p[key])
    if (value) stats[key] = value
  }
  return {
    id: `${module}:${encodeURIComponent(name)}`, module, name, category,
    rarity: text(p['稀有度']), faction: text(p['阵营']),
    description: text(p['技能']) || text(p['备注']), acquisition: text(p['获取方式']) || text(p['掉落点']),
    stats, imageUrl: '',
    wikiUrl: entry.fullurl || `https://wiki.biligame.com/blhx/${encodeURIComponent(name)}`, updatedAt: new Date().toISOString()
  }
}

function chunks(items, size = 40) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function normalizedFileStem(title) {
  return String(title || '').replace(/^(?:File|文件):/i, '').replace(/\.(?:png|jpe?g|webp)$/i, '').replace(/[\s_]/g, '').toLocaleLowerCase()
}

async function attachDirectImageUrls(entries, records) {
  const fileForPage = new Map()
  for (const batch of chunks(entries.map(entry => entry.fulltext))) {
    const json = await api({ action: 'query', prop: 'images', imlimit: 'max', titles: batch.join('|') })
    for (const page of json.query?.pages || []) {
      const pageStem = normalizedFileStem(page.title)
      const candidates = (page.images || []).map(image => image.title).filter(title => !/logo|背景|稀有度|阵营|舰种|技能|icon/i.test(title))
      const exact = candidates.find(title => normalizedFileStem(title) === pageStem)
      const close = candidates.find(title => pageStem.includes(normalizedFileStem(title)) || normalizedFileStem(title).includes(pageStem.split('/').at(-1)))
      const selected = exact || close || candidates[0]
      if (selected) fileForPage.set(page.title, selected)
    }
  }
  const urlForFile = new Map()
  const files = [...new Set(fileForPage.values())]
  for (const batch of chunks(files)) {
    const json = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url|mime', titles: batch.join('|') })
    for (const page of json.query?.pages || []) {
      const info = page.imageinfo?.[0]
      if (info?.url && /^image\//.test(info.mime || 'image/unknown')) urlForFile.set(page.title, info.url)
    }
  }
  const recordByName = new Map(records.map(record => [record.name, record]))
  for (const [page, file] of fileForPage) {
    const record = recordByName.get(page)
    if (record) record.imageUrl = urlForFile.get(file) || ''
  }
  return records
}

async function fetchEquipment(module) {
  const category = module === 'augment' ? '特殊兵装' : '装备'
  const properties = ['类型', '稀有度', '阵营', '伤害', '射速', '炮击', '雷击', '航空', '防空', '机动', '命中', '耐久', '装填', '反潜', '强化上限', '技能', '备注', '获取方式', '掉落点']
  const rows = await askAll(category, properties)
  const records = rows.map(entry => equipmentRecord(entry, module))
  return attachDirectImageUrls(rows, records)
}

async function fetchMaps() {
  const seed = JSON.parse(await readFile(path.join(root, 'data', 'ships.json'), 'utf8'))
  const map = new Map()
  for (const ship of seed.ships || []) {
    if (ship.isRetrofit) continue
    const sources = `${ship.dropLocations || ''} ${(ship.acquisitionGroups || []).filter(group => group.kind === '关卡').map(group => group.label).join(' ')}`
    for (const match of sources.matchAll(/(?:^|[^0-9A-Z])((?:\d{1,2}-\d{1,2}|[A-Z]{1,2}\d{1,2}))(?![0-9])/gi)) {
      const stage = match[1].toUpperCase()
      if (!map.has(stage)) map.set(stage, [])
      map.get(stage).push(ship.displayName || ship.name)
    }
  }
  return [...map.entries()].map(([stage, drops]) => ({
    id: `maps:${stage}`, module: 'maps', name: stage, category: /^[A-Z]/.test(stage) ? '活动海域' : '主线海域',
    rarity: '', faction: '', description: `可获取舰船：${[...new Set(drops)].join('、')}`,
    acquisition: '海域掉落', stats: { 舰船掉落数: String(new Set(drops).size) }, imageUrl: '',
    wikiUrl: `https://wiki.biligame.com/blhx/${encodeURIComponent(stage)}`, updatedAt: new Date().toISOString()
  })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

function newsCategory(title) {
  if (/活动|复刻|限时|庆典/.test(title)) return '活动'
  if (/攻略|指南/.test(title)) return '攻略'
  if (/改建|维护|公告/.test(title)) return '公告'
  return '新闻'
}

async function fetchNews() {
  const searches = ['intitle:港区改建', 'intitle:活动公告', 'intitle:维护公告']
  const found = new Map()
  for (const srsearch of searches) {
    const json = await api({ action: 'query', list: 'search', srsearch, srnamespace: 0, srlimit: 100, srprop: 'snippet|timestamp' })
    for (const row of json.query?.search || []) {
      const title = row.title
      found.set(title, {
        id: `news:${row.pageid || encodeURIComponent(title)}`, title, category: newsCategory(title),
        summary: String(row.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").slice(0, 220),
        publishedAt: row.timestamp || '', source: 'BWIKI',
        url: `https://wiki.biligame.com/blhx/${encodeURIComponent(title)}`
      })
    }
  }
  return [...found.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export async function syncWikiModule(module, cachePath = path.join(root, 'data', 'wiki.json')) {
  const allowed = ['equipment', 'augment', 'maps', 'news']
  if (!allowed.includes(module)) throw new Error(`未知同步模块：${module}`)
  let records
  if (module === 'equipment' || module === 'augment') records = await fetchEquipment(module)
  else if (module === 'maps') records = await fetchMaps()
  else records = await fetchNews()
  if (!records.length) throw new Error(`${module} 数据源没有返回记录`)
  let cache = { modules: {}, updatedAt: '' }
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')) } catch {}
  cache.modules ||= {}
  cache.modules[module] = records
  cache.updatedAt = new Date().toISOString()
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8')
  return { module, records, updatedAt: cache.updatedAt }
}

export async function syncAllWiki(cachePath = path.join(root, 'data', 'wiki.json')) {
  const results = []
  for (const module of ['equipment', 'augment', 'maps', 'news']) {
    try { results.push(await syncWikiModule(module, cachePath)) }
    catch (error) { results.push({ module, records: [], error: error.message || String(error), updatedAt: new Date().toISOString() }) }
  }
  return results
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] || 'all'
  const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'data', 'wiki.json')
  const result = target === 'all' ? await syncAllWiki(output) : [await syncWikiModule(target, output)]
  console.log(result.map(item => `${item.module}:${item.records.length}${item.error ? ` (${item.error})` : ''}`).join(' / '))
}
