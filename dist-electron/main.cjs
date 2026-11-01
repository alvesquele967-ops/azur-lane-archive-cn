const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, Notification, nativeImage, protocol, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const initSqlJs = require('sql.js')

let mainWindow
let db
let dbPath
let syncRunning = false
let tray
let scheduleTimer

protocol.registerSchemesAsPrivileged([{ scheme: 'archive-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

// electron-builder exposes this directory only for the single-file portable target.
// Keeping the database beside the portable executable makes the collection movable.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const portableDataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, '碧蓝航线舰船图鉴数据')
    fs.mkdirSync(portableDataDir, { recursive: true })
    app.setPath('userData', portableDataDir)
  } catch {
    // A read-only directory (for example Program Files) safely falls back to Electron userData.
  }
}

function appPath(...parts) { return path.join(app.getAppPath(), ...parts) }
function assetCacheRoot() { return path.join(app.getPath('userData'), 'asset-cache') }

async function saveDatabase() {
  if (!db) return
  const bytes = db.export()
  const temp = `${dbPath}.tmp`
  await fsp.writeFile(temp, Buffer.from(bytes))
  await fsp.rename(temp, dbPath)
}

function sqlValue(row, key) { return row?.[key] ?? '' }

async function initDatabase() {
  const wasmDir = appPath('node_modules', 'sql.js', 'dist')
  const SQL = await initSqlJs({ locateFile: file => path.join(wasmDir, file) })
  dbPath = path.join(app.getPath('userData'), 'azur-lane-archive.sqlite')
  const bytes = fs.existsSync(dbPath) ? await fsp.readFile(dbPath) : undefined
  db = new SQL.Database(bytes)
  db.run(`
    CREATE TABLE IF NOT EXISTS ships (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collection (ship_id TEXT PRIMARY KEY, owned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skins (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skin_collection (skin_id TEXT PRIMARY KEY, owned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collection_progress (ship_id TEXT PRIMARY KEY, stars INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collection_groups (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wiki_records (id TEXT PRIMARY KEY, module TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS news_state (news_id TEXT PRIMARY KEY, is_read INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS equipment_presets (id TEXT PRIMARY KEY, ship_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_presets (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS update_history (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, added INTEGER NOT NULL DEFAULT 0, changed INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collection_history (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const seed = JSON.parse(await fsp.readFile(appPath('data', 'ships.json'), 'utf8'))
  upsertShips(seed.ships)
  upsertSkins(seed.skins || [])
  upsertCollectionGroups(seed.collectionGroups || [])
  try {
    const wikiSeed = JSON.parse(await fsp.readFile(appPath('data', 'wiki.json'), 'utf8'))
    for (const [module, records] of Object.entries(wikiSeed.modules || {})) upsertWikiRecords(module, records)
  } catch {}
  setSetting('lastSync', getSetting('lastSync') || seed.meta.lastSync)
  setSetting('dataVersion', getSetting('dataVersion') || seed.meta.dataVersion)
  setSetting('sourceLabel', seed.meta.sourceLabel)
  if (!getSetting('appSettings')) setSetting('appSettings', JSON.stringify(defaultSettings()))
  await saveDatabase()
}

function upsertCollectionGroups(groups) {
  const statement = db.prepare('INSERT INTO collection_groups (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
  db.run('BEGIN')
  try {
    for (const group of groups) statement.run([group.id, JSON.stringify(group), new Date().toISOString()])
    db.run('COMMIT')
  } catch (error) { db.run('ROLLBACK'); throw error } finally { statement.free() }
}

function upsertSkins(skins) {
  const statement = db.prepare('INSERT INTO skins (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
  db.run('BEGIN')
  try {
    for (const skin of skins) statement.run([skin.id, JSON.stringify(skin), skin.syncedAt || new Date().toISOString()])
    db.run('COMMIT')
  } catch (error) { db.run('ROLLBACK'); throw error } finally { statement.free() }
}

function upsertShips(ships) {
  const statement = db.prepare('INSERT INTO ships (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
  db.run('BEGIN')
  try {
    for (const ship of ships) statement.run([ship.id, JSON.stringify(ship), ship.syncedAt || new Date().toISOString()])
    db.run('COMMIT')
  } catch (error) { db.run('ROLLBACK'); throw error } finally { statement.free() }
}

function defaultSettings() {
  return {
    nameMode: 'cn', autoRefresh: true, refreshHour: 4, refreshMinute: 0,
    backgroundMode: false, notifications: true, lastAutoRefresh: '',
    home: { shipId: '', skinId: '', scale: 1, offsetX: 0, offsetY: 0 }
  }
}

function parseSettings() {
  try {
    const value = JSON.parse(getSetting('appSettings') || '{}')
    return { ...defaultSettings(), ...value, home: { ...defaultSettings().home, ...(value.home || {}) } }
  } catch { return defaultSettings() }
}

function tablePayloads(table, order = '') {
  const rows = []
  const stmt = db.prepare(`SELECT payload FROM ${table}${order ? ` ORDER BY ${order}` : ''}`)
  while (stmt.step()) rows.push(JSON.parse(String(stmt.getAsObject().payload)))
  stmt.free()
  return rows
}

function stablePayload(item) {
  const copy = JSON.parse(JSON.stringify(item || {}))
  delete copy.syncedAt
  delete copy.updatedAt
  if (copy.profile) delete copy.profile.rawUpdatedAt
  return JSON.stringify(copy)
}

function upsertWikiRecords(module, records) {
  const old = new Map()
  const oldStmt = db.prepare('SELECT id,payload FROM wiki_records WHERE module=?')
  oldStmt.bind([module])
  while (oldStmt.step()) {
    const row = oldStmt.getAsObject()
    old.set(String(row.id), stablePayload(JSON.parse(String(row.payload))))
  }
  oldStmt.free()
  let added = 0
  let changed = 0
  const addedNames = []
  const changedNames = []
  const now = new Date().toISOString()
  const stmt = db.prepare('INSERT INTO wiki_records (id,module,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET module=excluded.module,payload=excluded.payload,updated_at=excluded.updated_at')
  db.run('BEGIN')
  try {
    for (const record of records) {
      const payload = JSON.stringify(record)
      const comparable = stablePayload(record)
      if (!old.has(record.id)) { added++; addedNames.push(record.name || record.title || record.id) }
      else if (old.get(record.id) !== comparable) { changed++; changedNames.push(record.name || record.title || record.id) }
      stmt.run([record.id, module, payload, record.updatedAt || now])
    }
    db.run('COMMIT')
  } catch (error) { db.run('ROLLBACK'); throw error } finally { stmt.free() }
  return { added, changed, addedNames, changedNames }
}

function getNews() {
  const states = new Map()
  const stateStmt = db.prepare('SELECT news_id,is_read,favorite FROM news_state')
  while (stateStmt.step()) {
    const row = stateStmt.getAsObject()
    states.set(String(row.news_id), { read: Boolean(row.is_read), favorite: Boolean(row.favorite) })
  }
  stateStmt.free()
  const result = []
  const stmt = db.prepare("SELECT payload FROM wiki_records WHERE module='news' ORDER BY updated_at DESC")
  while (stmt.step()) {
    const news = JSON.parse(String(stmt.getAsObject().payload))
    result.push({ ...news, ...(states.get(news.id) || { read: false, favorite: false }) })
  }
  stmt.free()
  return result.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
}

function getUpdateHistory() {
  const rows = []
  const stmt = db.prepare('SELECT id,module,added,changed,message,created_at FROM update_history ORDER BY id DESC LIMIT 100')
  while (stmt.step()) {
    const row = stmt.getAsObject()
    rows.push({ id: Number(row.id), module: String(row.module), added: Number(row.added), changed: Number(row.changed), message: String(row.message), createdAt: String(row.created_at) })
  }
  stmt.free()
  return rows
}

function createMail(title, category, body) {
  db.run('INSERT INTO app_mail (title,category,body,is_read,created_at) VALUES (?,?,?,0,?)', [title, category, body, new Date().toISOString()])
}

function getMails() {
  const rows = []
  const stmt = db.prepare('SELECT id,title,category,body,is_read,created_at FROM app_mail ORDER BY id DESC LIMIT 300')
  while (stmt.step()) {
    const row = stmt.getAsObject()
    rows.push({ id: Number(row.id), title: String(row.title), category: String(row.category), body: String(row.body), read: Boolean(row.is_read), createdAt: String(row.created_at) })
  }
  stmt.free()
  return rows
}

function recordCollectionHistory(changes, label) {
  if (!changes.length) return
  db.run('DELETE FROM collection_history WHERE applied=0')
  db.run('INSERT INTO collection_history (payload,applied,created_at) VALUES (?,1,?)', [JSON.stringify({ label, changes }), new Date().toISOString()])
  db.run('DELETE FROM collection_history WHERE id NOT IN (SELECT id FROM collection_history ORDER BY id DESC LIMIT 100)')
}

function isShipOwned(id) {
  const stmt = db.prepare('SELECT owned FROM collection WHERE ship_id=?')
  stmt.bind([id]); const value = stmt.step() ? Boolean(stmt.getAsObject().owned) : false; stmt.free(); return value
}

function collectionHistoryState() {
  const undo = db.exec('SELECT id FROM collection_history WHERE applied=1 ORDER BY id DESC LIMIT 1')
  const redo = db.exec('SELECT id FROM collection_history WHERE applied=0 ORDER BY id ASC LIMIT 1')
  return { canUndo: Boolean(undo.length), canRedo: Boolean(redo.length) }
}

async function applyCollectionHistory(direction) {
  const sql = direction === 'undo' ? 'SELECT id,payload FROM collection_history WHERE applied=1 ORDER BY id DESC LIMIT 1' : 'SELECT id,payload FROM collection_history WHERE applied=0 ORDER BY id ASC LIMIT 1'
  const stmt = db.prepare(sql)
  if (!stmt.step()) { stmt.free(); return { ok: false, message: direction === 'undo' ? '没有可撤销的操作' : '没有可重做的操作' } }
  const row = stmt.getAsObject(); stmt.free()
  const payload = JSON.parse(String(row.payload))
  const valueKey = direction === 'undo' ? 'before' : 'after'
  db.run('BEGIN')
  try {
    for (const change of payload.changes) db.run('INSERT INTO collection (ship_id,owned,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET owned=excluded.owned,updated_at=excluded.updated_at', [change.id, change[valueKey] ? 1 : 0, new Date().toISOString()])
    db.run('UPDATE collection_history SET applied=? WHERE id=?', [direction === 'undo' ? 0 : 1, row.id])
    db.run('COMMIT')
  } catch (error) { db.run('ROLLBACK'); throw error }
  await saveDatabase()
  return { ok: true, message: `${direction === 'undo' ? '已撤销' : '已重做'}：${payload.label || '收藏操作'}` }
}

function setSetting(key, value) {
  db.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)])
}

function getSetting(key) {
  const stmt = db.prepare('SELECT value FROM settings WHERE key=?')
  stmt.bind([key])
  const value = stmt.step() ? stmt.getAsObject().value : ''
  stmt.free()
  return value
}

function cachedAssetUrl(value) {
  if (!value || String(value).startsWith('archive-asset://')) return value
  if (!String(value).startsWith('https://')) return value
  try {
    const hash = crypto.createHash('sha256').update(String(value)).digest('hex')
    const guessed = path.extname(new URL(String(value)).pathname).toLowerCase()
    const extension = /^\.(?:png|jpe?g|webp|gif)$/.test(guessed) ? guessed : '.img'
    const name = `${hash}${extension}`
    return validCachedImage(path.join(assetCacheRoot(), name)) ? `archive-asset://cache/${name}` : value
  } catch { return value }
}

function validCachedImage(filePath) {
  try {
    const bytes = Buffer.alloc(12)
    const fd = fs.openSync(filePath, 'r')
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0)
    fs.closeSync(fd)
    if (length < 6) return false
    return bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) ||
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      bytes.subarray(0, 6).toString('ascii').startsWith('GIF8') ||
      (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
  } catch { return false }
}

function attachCachedAssets(payload, fields) {
  const result = { ...payload }
  for (const field of fields) result[field] = cachedAssetUrl(payload[`${field}Remote`] || payload[field])
  return result
}

function getAppData() {
  const owned = new Set()
  const ownedStmt = db.prepare('SELECT ship_id FROM collection WHERE owned=1')
  while (ownedStmt.step()) owned.add(String(ownedStmt.getAsObject().ship_id))
  ownedStmt.free()
  const starMap = new Map()
  const starStmt = db.prepare('SELECT ship_id,stars FROM collection_progress')
  while (starStmt.step()) {
    const row = starStmt.getAsObject()
    starMap.set(String(row.ship_id), Number(row.stars || 0))
  }
  starStmt.free()
  const ships = []
  const stmt = db.prepare('SELECT payload FROM ships')
  while (stmt.step()) {
    const ship = JSON.parse(String(stmt.getAsObject().payload))
    ships.push({ ...attachCachedAssets(ship, ['avatarUrl', 'artUrl']), owned: owned.has(ship.id), collectionStars: starMap.get(ship.id) || 0 })
  }
  stmt.free()
  const ownedSkins = new Set()
  const ownedSkinStmt = db.prepare('SELECT skin_id FROM skin_collection WHERE owned=1')
  while (ownedSkinStmt.step()) ownedSkins.add(String(ownedSkinStmt.getAsObject().skin_id))
  ownedSkinStmt.free()
  const skins = []
  const skinStmt = db.prepare('SELECT payload FROM skins')
  while (skinStmt.step()) {
    const skin = JSON.parse(String(skinStmt.getAsObject().payload))
    skins.push({ ...attachCachedAssets(skin, ['imageUrl']), owned: ownedSkins.has(skin.id) })
  }
  skinStmt.free()
  const collectionGroups = []
  const groupStmt = db.prepare('SELECT payload FROM collection_groups')
  while (groupStmt.step()) collectionGroups.push(JSON.parse(String(groupStmt.getAsObject().payload)))
  groupStmt.free()
  const wikiRecords = []
  const wikiStmt = db.prepare("SELECT payload FROM wiki_records WHERE module!='news'")
  while (wikiStmt.step()) wikiRecords.push(attachCachedAssets(JSON.parse(String(wikiStmt.getAsObject().payload)), ['imageUrl']))
  wikiStmt.free()
  return {
    ships, skins, collectionGroups, wikiRecords, news: getNews(), updateHistory: getUpdateHistory(),
    equipmentPresets: tablePayloads('equipment_presets', 'updated_at DESC'),
    fleets: tablePayloads('fleet_presets', 'updated_at DESC'), settings: parseSettings(), mails: getMails(),
    meta: {
      lastSync: getSetting('lastSync'), dataVersion: getSetting('dataVersion'),
      sourceLabel: getSetting('sourceLabel') || 'Bilibili 碧蓝航线 BWIKI 公共页面'
    }
  }
}

async function syncWikiData(module) {
  const send = (stage, progress) => mainWindow?.webContents.send('sync:progress', { stage, progress })
  const cachePath = path.join(app.getPath('userData'), 'wiki-cache.json')
  const moduleUrl = pathToFileURL(appPath('scripts', 'sync-wiki-module.mjs')).href
  const { syncWikiModule, syncAllWiki } = await import(`${moduleUrl}?v=${Date.now()}`)
  const targets = module === 'all' ? ['equipment', 'augment', 'maps', 'news'] : [module]
  const results = module === 'all' ? await syncAllWiki(cachePath) : [await syncWikiModule(module, cachePath)]
  let count = 0
  let added = 0
  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    if (result.error) {
      db.run('INSERT INTO update_history (module,added,changed,message,created_at) VALUES (?,0,0,?,?)', [result.module, result.error, new Date().toISOString()])
      continue
    }
    send(`正在写入${result.module}`, 30 + Math.round((index + 1) / targets.length * 60))
    const diff = upsertWikiRecords(result.module, result.records)
    count += result.records.length
    added += diff.added
    db.run('INSERT INTO update_history (module,added,changed,message,created_at) VALUES (?,?,?,?,?)', [result.module, diff.added, diff.changed, `同步 ${result.records.length} 条`, result.updatedAt])
    if (diff.added || diff.changed) {
      const labels = { equipment: '装备', augment: '特殊兵装', maps: '海域与掉落', news: '公告资讯' }
      const lines = [
        diff.added ? `新增 ${diff.added} 条：${diff.addedNames.slice(0, 30).join('、')}${diff.added > 30 ? '……' : ''}` : '',
        diff.changed ? `更新 ${diff.changed} 条：${diff.changedNames.slice(0, 30).join('、')}${diff.changed > 30 ? '……' : ''}` : ''
      ].filter(Boolean)
      createMail(`${labels[result.module] || result.module}资料已更新`, result.module, lines.join('\n'))
    }
  }
  setSetting(`lastSync:${module}`, new Date().toISOString())
  await saveDatabase()
  if (added && parseSettings().notifications && Notification.isSupported()) {
    new Notification({ title: '碧蓝航线资料库已更新', body: `发现 ${added} 条新舰船相关资料、装备、地图或公告` }).show()
  }
  send('同步完成', 100)
  return { ok: true, count, updatedAt: new Date().toISOString(), message: `已同步 ${count} 条资料${added ? `，新增 ${added} 条` : ''}` }
}

async function syncLiveData(module = 'ships') {
  if (syncRunning) return { ok: false, count: 0, updatedAt: '', message: '同步任务正在进行中' }
  syncRunning = true
  const send = (stage, progress) => mainWindow?.webContents.send('sync:progress', { stage, progress })
  const tempPath = path.join(app.getPath('temp'), `azur-lane-sync-${Date.now()}.json`)
  try {
    if (module !== 'ships') return await syncWikiData(module)
    send('正在连接资料源', 8)
    const moduleUrl = pathToFileURL(appPath('scripts', 'sync-data.mjs')).href
    const { syncData } = await import(`${moduleUrl}?v=${Date.now()}`)
    send('正在读取舰船资料与图片索引', 30)
    const payload = await syncData(tempPath)
    send('正在写入本地数据库', 88)
    const oldShips = new Map(tablePayloads('ships').map(item => [item.id, stablePayload(item)]))
    const oldSkins = new Map(tablePayloads('skins').map(item => [item.id, stablePayload(item)]))
    const newShips = payload.ships.filter(item => !oldShips.has(item.id))
    const changedShips = payload.ships.filter(item => oldShips.has(item.id) && oldShips.get(item.id) !== stablePayload(item))
    const newSkins = (payload.skins || []).filter(item => !oldSkins.has(item.id))
    const changedSkins = (payload.skins || []).filter(item => oldSkins.has(item.id) && oldSkins.get(item.id) !== stablePayload(item))
    upsertShips(payload.ships)
    upsertSkins(payload.skins || [])
    upsertCollectionGroups(payload.collectionGroups || [])
    setSetting('lastSync', payload.meta.lastSync)
    setSetting('dataVersion', payload.meta.dataVersion)
    setSetting('sourceLabel', payload.meta.sourceLabel)
    if (newShips.length || changedShips.length) createMail('舰船资料已更新', 'ships', `新增 ${newShips.length} 艘：${newShips.slice(0, 30).map(item => item.displayName || item.name).join('、')}\n更新 ${changedShips.length} 艘：${changedShips.slice(0, 30).map(item => item.displayName || item.name).join('、')}`)
    if (newSkins.length || changedSkins.length) createMail('皮肤资料已更新', 'skins', `新增 ${newSkins.length} 款：${newSkins.slice(0, 30).map(item => `${item.shipName}·${item.name}`).join('、')}\n更新 ${changedSkins.length} 款：${changedSkins.slice(0, 30).map(item => `${item.shipName}·${item.name}`).join('、')}`)
    await saveDatabase()
    send('同步完成', 100)
    return { ok: true, count: payload.ships.length, updatedAt: payload.meta.lastSync, message: `已同步 ${payload.ships.length} 艘舰船、${payload.skins?.length || 0} 款皮肤` }
  } catch (error) {
    return { ok: false, count: 0, updatedAt: '', message: `同步失败：${error.message || error}` }
  } finally {
    syncRunning = false
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}

function ensureTray() {
  const settings = parseSettings()
  if (!settings.backgroundMode) {
    tray?.destroy()
    tray = undefined
    return
  }
  if (tray) return
  const image = nativeImage.createFromPath(appPath('build', 'icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(image)
  tray.setToolTip('碧蓝航线舰船图鉴')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开图鉴', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: '立即更新全部资料', click: () => syncLiveData('all') },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit() } }
  ]))
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function startSchedule() {
  if (scheduleTimer) clearInterval(scheduleTimer)
  scheduleTimer = setInterval(async () => {
    const settings = parseSettings()
    if (!settings.autoRefresh || syncRunning) return
    const now = new Date()
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (now.getHours() !== Number(settings.refreshHour) || now.getMinutes() < Number(settings.refreshMinute) || settings.lastAutoRefresh === key) return
    const shipResult = await syncLiveData('ships')
    const result = shipResult.ok ? await syncLiveData('all') : shipResult
    if (result.ok) {
      settings.lastAutoRefresh = key
      setSetting('appSettings', JSON.stringify(settings))
      await saveDatabase()
      mainWindow?.webContents.send('data:changed')
    }
  }, 60_000)
  ensureTray()
}

async function cacheRemoteAsset(url) {
  if (!/^https:\/\//.test(url || '')) return url
  const hash = crypto.createHash('sha256').update(url).digest('hex')
  const pathname = new URL(url).pathname
  const guessed = path.extname(pathname).toLowerCase()
  const extension = /^\.(?:png|jpe?g|webp|gif)$/.test(guessed) ? guessed : '.img'
  const name = `${hash}${extension}`
  const filePath = path.join(assetCacheRoot(), name)
  if (!validCachedImage(filePath)) {
    const response = await net.fetch(url)
    if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) throw new Error(`图片地址返回了非图片内容：${contentType || 'unknown'}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    await fsp.mkdir(assetCacheRoot(), { recursive: true })
    await fsp.writeFile(filePath, bytes)
    if (!validCachedImage(filePath)) { await fsp.unlink(filePath).catch(() => {}); throw new Error('下载内容不是有效图片') }
  }
  return `archive-asset://cache/${name}`
}

async function cacheAssets(scope) {
  const send = (stage, progress) => mainWindow?.webContents.send('sync:progress', { stage, progress })
  const sources = []
  if (scope === 'all' || scope === 'ships') sources.push({ table: 'ships', where: '', fields: ['avatarUrl', 'artUrl'] })
  if (scope === 'all' || scope === 'skins') sources.push({ table: 'skins', where: '', fields: ['imageUrl'] })
  if (['all', 'equipment', 'augment', 'maps', 'news'].includes(scope)) sources.push({ table: 'wiki_records', where: scope === 'all' ? " WHERE module!='news'" : ' WHERE module=?', args: scope === 'all' ? [] : [scope], fields: ['imageUrl'] })
  const entries = []
  for (const source of sources) {
    const stmt = db.prepare(`SELECT id,payload FROM ${source.table}${source.where}`)
    if (source.args?.length) stmt.bind(source.args)
    while (stmt.step()) entries.push({ ...source, ...stmt.getAsObject() })
    stmt.free()
  }
  let cached = 0
  let failed = 0
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const payload = JSON.parse(String(entry.payload))
    let changed = false
    for (const field of entry.fields) {
      const remote = payload[`${field}Remote`] || payload[field]
      if (!/^https:\/\//.test(remote || '')) continue
      try {
        const local = await cacheRemoteAsset(remote)
        payload[`${field}Remote`] = remote
        payload[field] = local
        changed = true; cached++
      } catch { failed++ }
    }
    if (changed) db.run(`UPDATE ${entry.table} SET payload=?,updated_at=? WHERE id=?`, [JSON.stringify(payload), new Date().toISOString(), String(entry.id)])
    if (index % 10 === 0) send(`正在缓存图片 ${index + 1}/${entries.length}`, Math.round((index + 1) / Math.max(1, entries.length) * 100))
  }
  await saveDatabase()
  createMail('离线图片缓存完成', 'cache', `已缓存 ${cached} 张图片，失败 ${failed} 张。缓存保存在本地用户数据目录，可离线浏览。`)
  send('离线缓存完成', 100)
  return { ok: true, count: cached, updatedAt: new Date().toISOString(), message: `已缓存 ${cached} 张图片${failed ? `，${failed} 张失败可稍后重试` : ''}` }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1040, minHeight: 680,
    backgroundColor: '#061725', title: '碧蓝航线舰船图鉴',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, spellcheck: false
    }
  })
  mainWindow.removeMenu()
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  await mainWindow.loadFile(appPath('dist', 'index.html'))
  mainWindow.on('close', event => {
    if (parseSettings().backgroundMode && !app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
}

ipcMain.handle('data:get', () => getAppData())
ipcMain.handle('collection:set', async (_event, { id, owned }) => {
  const exists = db.exec(`SELECT id FROM ships WHERE id='${String(id).replaceAll("'", "''")}' LIMIT 1`)
  if (!exists.length) return false
  const before = isShipOwned(id)
  if (before !== Boolean(owned)) recordCollectionHistory([{ id, before, after: Boolean(owned) }], owned ? '点亮舰船' : '取消点亮舰船')
  db.run('INSERT INTO collection (ship_id,owned,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET owned=excluded.owned,updated_at=excluded.updated_at', [id, owned ? 1 : 0, new Date().toISOString()])
  if (owned) {
    const payloadRow = db.exec(`SELECT payload FROM ships WHERE id='${String(id).replaceAll("'", "''")}' LIMIT 1`)
    const rarity = payloadRow[0]?.values?.[0]?.[0] ? JSON.parse(String(payloadRow[0].values[0][0])).rarity : ''
    const initialStars = ['普通'].includes(rarity) ? 1 : ['稀有', '精锐'].includes(rarity) ? 2 : 3
    db.run('INSERT INTO collection_progress (ship_id,stars,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET stars=CASE WHEN stars<1 THEN excluded.stars ELSE stars END,updated_at=excluded.updated_at', [id, initialStars, new Date().toISOString()])
  } else {
    db.run('INSERT INTO collection_progress (ship_id,stars,updated_at) VALUES (?,0,?) ON CONFLICT(ship_id) DO UPDATE SET stars=0,updated_at=excluded.updated_at', [id, new Date().toISOString()])
  }
  await saveDatabase()
  return true
})
ipcMain.handle('collection:set-many', async (_event, { ids, owned }) => {
  if (!Array.isArray(ids)) return false
  const now = new Date().toISOString()
  const changes = ids.map(id => ({ id: String(id), before: isShipOwned(String(id)), after: Boolean(owned) })).filter(change => change.before !== change.after)
  recordCollectionHistory(changes, owned ? `批量全选 ${changes.length} 艘` : `批量全不选 ${changes.length} 艘`)
  const stmt = db.prepare('INSERT INTO collection (ship_id,owned,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET owned=excluded.owned,updated_at=excluded.updated_at')
  db.run('BEGIN')
  try {
    for (const id of ids) stmt.run([String(id), owned ? 1 : 0, now])
    db.run('COMMIT')
  } catch (error) { db.run('ROLLBACK'); throw error } finally { stmt.free() }
  await saveDatabase()
  return true
})
ipcMain.handle('collection:undo', () => applyCollectionHistory('undo'))
ipcMain.handle('collection:redo', () => applyCollectionHistory('redo'))
ipcMain.handle('collection:history-state', () => collectionHistoryState())
ipcMain.handle('collection:set-stars', async (_event, { id, stars }) => {
  const exists = db.exec(`SELECT id FROM ships WHERE id='${String(id).replaceAll("'", "''")}' LIMIT 1`)
  if (!exists.length) return false
  const value = Math.max(0, Math.min(6, Number(stars) || 0))
  db.run('INSERT INTO collection_progress (ship_id,stars,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET stars=excluded.stars,updated_at=excluded.updated_at', [id, value, new Date().toISOString()])
  db.run('INSERT INTO collection (ship_id,owned,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET owned=excluded.owned,updated_at=excluded.updated_at', [id, value > 0 ? 1 : 0, new Date().toISOString()])
  await saveDatabase()
  return true
})
ipcMain.handle('skin-collection:set', async (_event, { id, owned }) => {
  const exists = db.exec(`SELECT id FROM skins WHERE id='${String(id).replaceAll("'", "''")}' LIMIT 1`)
  if (!exists.length) return false
  db.run('INSERT INTO skin_collection (skin_id,owned,updated_at) VALUES (?,?,?) ON CONFLICT(skin_id) DO UPDATE SET owned=excluded.owned,updated_at=excluded.updated_at', [id, owned ? 1 : 0, new Date().toISOString()])
  await saveDatabase()
  return true
})
ipcMain.handle('data:sync', (_event, module) => syncLiveData(module || 'ships'))
ipcMain.handle('assets:cache', (_event, scope) => cacheAssets(scope || 'all'))
ipcMain.handle('news:set-state', async (_event, { id, patch }) => {
  const current = getNews().find(item => item.id === id)
  if (!current) return false
  const read = patch.read == null ? current.read : Boolean(patch.read)
  const favorite = patch.favorite == null ? current.favorite : Boolean(patch.favorite)
  db.run('INSERT INTO news_state (news_id,is_read,favorite,updated_at) VALUES (?,?,?,?) ON CONFLICT(news_id) DO UPDATE SET is_read=excluded.is_read,favorite=excluded.favorite,updated_at=excluded.updated_at', [id, read ? 1 : 0, favorite ? 1 : 0, new Date().toISOString()])
  await saveDatabase(); return true
})
ipcMain.handle('mail:set-read', async (_event, { id, read }) => { db.run('UPDATE app_mail SET is_read=? WHERE id=?', [read ? 1 : 0, Number(id)]); await saveDatabase(); return true })
ipcMain.handle('mail:delete', async (_event, id) => { db.run('DELETE FROM app_mail WHERE id=?', [Number(id)]); await saveDatabase(); return true })
ipcMain.handle('preset:save', async (_event, preset) => {
  if (!preset?.id || !preset?.shipId || !preset?.name) return false
  const value = { ...preset, updatedAt: new Date().toISOString() }
  db.run('INSERT INTO equipment_presets (id,ship_id,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET ship_id=excluded.ship_id,payload=excluded.payload,updated_at=excluded.updated_at', [value.id, value.shipId, JSON.stringify(value), value.updatedAt])
  await saveDatabase(); return true
})
ipcMain.handle('preset:delete', async (_event, id) => { db.run('DELETE FROM equipment_presets WHERE id=?', [id]); await saveDatabase(); return true })
ipcMain.handle('fleet:save', async (_event, fleet) => {
  if (!fleet?.id || !fleet?.name) return false
  const value = { ...fleet, updatedAt: new Date().toISOString() }
  db.run('INSERT INTO fleet_presets (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', [value.id, JSON.stringify(value), value.updatedAt])
  await saveDatabase(); return true
})
ipcMain.handle('fleet:delete', async (_event, id) => { db.run('DELETE FROM fleet_presets WHERE id=?', [id]); await saveDatabase(); return true })
ipcMain.handle('settings:save', async (_event, settings) => {
  const value = { ...defaultSettings(), ...(settings || {}), home: { ...defaultSettings().home, ...(settings?.home || {}) } }
  value.refreshHour = Math.max(0, Math.min(23, Number(value.refreshHour) || 0))
  value.refreshMinute = Math.max(0, Math.min(59, Number(value.refreshMinute) || 0))
  setSetting('appSettings', JSON.stringify(value))
  await saveDatabase(); ensureTray(); return true
})
ipcMain.handle('data:export', async (_event, { includeShips }) => {
  const data = getAppData()
  const payload = {
    format: 'azur-lane-archive-backup', version: 1, exportedAt: new Date().toISOString(),
    ownedIds: data.ships.filter(s => s.owned).map(s => s.id),
    ownedSkinIds: data.skins.filter(s => s.owned).map(s => s.id),
    shipStars: Object.fromEntries(data.ships.filter(s => s.collectionStars).map(s => [s.id, s.collectionStars])),
    equipmentPresets: data.equipmentPresets, fleets: data.fleets, settings: data.settings,
    mails: data.mails,
    newsState: Object.fromEntries(data.news.filter(item => item.read || item.favorite).map(item => [item.id, { read: item.read, favorite: item.favorite }])),
    meta: data.meta
  }
  if (includeShips) {
    payload.ships = data.ships.map(({ owned, ...ship }) => ship)
    payload.skins = data.skins.map(({ owned, ...skin }) => skin)
  }
  const result = await dialog.showSaveDialog(mainWindow, { title: '导出舰船图鉴数据', defaultPath: `碧蓝航线图鉴备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 数据', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return { ok: false, message: '已取消导出' }
  await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  return { ok: true, path: result.filePath, message: '导出成功' }
})
ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '导入舰船图鉴备份', properties: ['openFile'], filters: [{ name: 'JSON 数据', extensions: ['json'] }] })
  if (result.canceled || !result.filePaths[0]) return { ok: false, message: '已取消导入' }
  try {
    const payload = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8'))
    if (payload.format !== 'azur-lane-archive-backup' || !Array.isArray(payload.ownedIds)) throw new Error('不是有效的图鉴备份文件')
    if (Array.isArray(payload.ships) && payload.ships.length) upsertShips(payload.ships)
    if (Array.isArray(payload.skins) && payload.skins.length) upsertSkins(payload.skins)
    db.run('BEGIN')
    try {
      db.run('UPDATE collection SET owned=0,updated_at=?', [new Date().toISOString()])
      const stmt = db.prepare('INSERT INTO collection (ship_id,owned,updated_at) VALUES (?,1,?) ON CONFLICT(ship_id) DO UPDATE SET owned=1,updated_at=excluded.updated_at')
      for (const id of payload.ownedIds) stmt.run([String(id), new Date().toISOString()])
      stmt.free()
      db.run('UPDATE collection_progress SET stars=0,updated_at=?', [new Date().toISOString()])
      const progressStmt = db.prepare('INSERT INTO collection_progress (ship_id,stars,updated_at) VALUES (?,?,?) ON CONFLICT(ship_id) DO UPDATE SET stars=excluded.stars,updated_at=excluded.updated_at')
      for (const [id, stars] of Object.entries(payload.shipStars || {})) progressStmt.run([String(id), Math.max(0, Math.min(6, Number(stars) || 0)), new Date().toISOString()])
      progressStmt.free()
      db.run('UPDATE skin_collection SET owned=0,updated_at=?', [new Date().toISOString()])
      const skinStmt = db.prepare('INSERT INTO skin_collection (skin_id,owned,updated_at) VALUES (?,1,?) ON CONFLICT(skin_id) DO UPDATE SET owned=1,updated_at=excluded.updated_at')
      for (const id of (payload.ownedSkinIds || [])) skinStmt.run([String(id), new Date().toISOString()])
      skinStmt.free()
      for (const preset of (payload.equipmentPresets || [])) {
        db.run('INSERT INTO equipment_presets (id,ship_id,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET ship_id=excluded.ship_id,payload=excluded.payload,updated_at=excluded.updated_at', [preset.id, preset.shipId, JSON.stringify(preset), preset.updatedAt || new Date().toISOString()])
      }
      for (const fleet of (payload.fleets || [])) {
        db.run('INSERT INTO fleet_presets (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', [fleet.id, JSON.stringify(fleet), fleet.updatedAt || new Date().toISOString()])
      }
      for (const [id, state] of Object.entries(payload.newsState || {})) {
        db.run('INSERT INTO news_state (news_id,is_read,favorite,updated_at) VALUES (?,?,?,?) ON CONFLICT(news_id) DO UPDATE SET is_read=excluded.is_read,favorite=excluded.favorite,updated_at=excluded.updated_at', [id, state.read ? 1 : 0, state.favorite ? 1 : 0, new Date().toISOString()])
      }
      if (Array.isArray(payload.mails)) {
        db.run('DELETE FROM app_mail')
        const mailStmt = db.prepare('INSERT INTO app_mail (title,category,body,is_read,created_at) VALUES (?,?,?,?,?)')
        for (const mail of payload.mails) mailStmt.run([String(mail.title || '资料更新'), String(mail.category || '资料'), String(mail.body || ''), mail.read ? 1 : 0, mail.createdAt || new Date().toISOString()])
        mailStmt.free()
      }
      if (payload.settings) setSetting('appSettings', JSON.stringify({ ...defaultSettings(), ...payload.settings, home: { ...defaultSettings().home, ...(payload.settings.home || {}) } }))
      db.run('COMMIT')
    } catch (error) { db.run('ROLLBACK'); throw error }
    await saveDatabase()
    return { ok: true, count: payload.ownedIds.length + (payload.ownedSkinIds?.length || 0), message: `已导入 ${payload.ownedIds.length} 条舰船、${payload.ownedSkinIds?.length || 0} 条皮肤收藏` }
  } catch (error) { return { ok: false, message: `导入失败：${error.message || error}` } }
})
ipcMain.handle('data:backup', async () => {
  await saveDatabase()
  const result = await dialog.showSaveDialog(mainWindow, { title: '备份本地数据库', defaultPath: `碧蓝航线图鉴数据库-${new Date().toISOString().slice(0, 10)}.sqlite`, filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }] })
  if (result.canceled || !result.filePath) return { ok: false, message: '已取消备份' }
  await fsp.copyFile(dbPath, result.filePath)
  return { ok: true, path: result.filePath, message: '数据库备份成功' }
})
ipcMain.handle('external:open', async (_event, url) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    await shell.openExternal(parsed.toString())
    return true
  } catch { return false }
})

app.whenReady().then(async () => {
  protocol.handle('archive-asset', async request => {
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname))
    const filePath = path.join(assetCacheRoot(), name)
    if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 })
    const extension = path.extname(filePath).toLowerCase()
    const contentType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/jpeg'
    return new Response(await fsp.readFile(filePath), { headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' } })
  })
  await initDatabase()
  await createWindow()
  startSchedule()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch(error => { dialog.showErrorBox('启动失败', String(error?.stack || error)); app.quit() })

app.on('before-quit', () => { app.isQuitting = true; if (scheduleTimer) clearInterval(scheduleTimer) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !parseSettings().backgroundMode) app.quit() })
