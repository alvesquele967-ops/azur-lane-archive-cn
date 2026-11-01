import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const API = 'https://wiki.biligame.com/blhx/api.php'
const UA = 'AzurLaneArchiveCN/1.0 (desktop ship collection; public MediaWiki reader)'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let lastApiCall = 0

async function api(params, attempts = 5) {
  const url = new URL(API)
  for (const [key, value] of Object.entries({ format: 'json', origin: '*', ...params })) url.searchParams.set(key, String(value))
  let error
  for (let i = 0; i < attempts; i++) {
    try {
      const wait = Math.max(0, 350 - (Date.now() - lastApiCall))
      if (wait) await new Promise(resolve => setTimeout(resolve, wait))
      lastApiCall = Date.now()
      const usePost = url.toString().length > 5500
      const response = await fetch(usePost ? API : url, {
        method: usePost ? 'POST' : 'GET',
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(usePost ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: usePost ? url.searchParams.toString() : undefined,
        signal: AbortSignal.timeout(45000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (next) {
      error = next
      await new Promise(resolve => setTimeout(resolve, 1200 * (i + 1)))
    }
  }
  throw error
}

const cleanWiki = value => String(value || '')
  .replace(/<!--[^]*?-->/g, '')
  .replace(/<br\s*\/?\s*>/gi, '；')
  .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
  .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
  .replace(/\{\{[^{}]*\}\}/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/'{2,}/g, '')
  .replace(/\s+/g, ' ')
  .trim()

function templateValue(text, key) {
  const match = text.match(new RegExp(`^\\|${key}=([^\\r\\n]*)`, 'm'))
  return cleanWiki(match?.[1])
}

function rawTemplateValue(text, key) {
  return text.match(new RegExp(`^\\|${key}=([^\\r\\n]*)`, 'm'))?.[1]?.trim() || ''
}

function profileMap(text, prefix, keys) {
  return Object.fromEntries(keys.map(key => [key, templateValue(text, `${prefix}${key}`)]).filter(([, value]) => value))
}

function profileFor(text) {
  const statKeys = ['耐久','装填','命中','炮击','雷击','机动','防空','航空','消耗','反潜','航速','幸运']
  const skills = []
  for (let index = 1; index <= 6; index++) {
    const name = templateValue(text, `技能${index}名`), description = templateValue(text, `技能${index}`)
    const retrofitName = templateValue(text, `技能${index}名改造`), retrofitDescription = templateValue(text, `技能${index}改造`)
    if (name || description) skills.push({ name: name || `技能 ${index}`, description })
    if (retrofitName || retrofitDescription) skills.push({ name: retrofitName || `改造技能 ${index}`, description: retrofitDescription, retrofit: true })
  }
  const equipmentSlots = []
  for (let index = 1; index <= 5; index++) {
    const type = templateValue(text, `${index}号槽装备类型`), initial = templateValue(text, `装备${index}`)
    if (type || initial) equipmentSlots.push({ type, initial, efficiencyInitial: templateValue(text, `${index}号槽装备效率初始`), efficiencyMax: templateValue(text, `${index}号槽装备效率满破`) })
  }
  return {
    model: templateValue(text, '型号'), englishName: templateValue(text, '英文名'), japaneseName: templateValue(text, '日文名'), armor: templateValue(text, '装甲类型'), initialStars: templateValue(text, '初始星级'),
    statsInitial: profileMap(text, '初始', statKeys), statsMax: profileMap(text, '满级', statKeys), statsRetrofit: profileMap(text, '改造满级', statKeys),
    ratings: profileMap(text, '图鉴', ['耐久','防空','机动','航空','雷击','炮击']), skills, equipmentSlots,
    technology: profileMap(text, '', ['解锁图鉴科技点','突破至满星科技点','达到120级科技点','解锁图鉴属性加成','达到120级属性加成']),
    character: profileMap(text, '', ['身份','性格','关键词','持有物','发色','瞳色','萌点','CV','画师','舰船型号台词','自我介绍台词']),
    lines: profileMap(text, '', ['获取台词','登录台词','查看详情台词','主界面1台词','主界面2台词','主界面3台词','普通触摸台词','特殊触摸台词','任务提醒台词','任务完成台词','邮件提醒台词','回港台词','胜利台词','失败台词','技能台词','誓约台词']),
    evaluation: templateValue(text, '评价'), retrofitDate: templateValue(text, '改造日期'), retrofitRequirements: templateValue(text, '改造需求合计'), rawUpdatedAt: new Date().toISOString()
  }
}

function acquisitionGroupsFor(ship, raw) {
  if (ship.isRetrofit) return []
  const source = `${rawTemplateValue(raw, '其他获取途径')} ${rawTemplateValue(raw, '掉落点')} ${(ship.dropPoints || []).join(' ')}`
  const groups = []
  const add = (key, label, kind) => {
    if (key && label && !groups.some(group => group.key === key)) groups.push({ key, label, kind })
  }
  for (const match of source.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) {
    const target = match[1].trim()
    const label = cleanWiki(match[2] || target)
    if (/^(?:\d{1,2}-\d{1,2}|[A-Z]{1,2}\d{1,2})$/i.test(target)) {
      add(`stage:${target.toUpperCase()}`, `关卡 ${target.toUpperCase()}`, '关卡')
    } else if (/专题|活动/.test(target) && !/庆典广场|邀请函/.test(label)) {
      const canonical = target.replace(/\s+/g, '').replace(/复刻/g, '').replace(/^碧蓝(?:海事局|航线)/, '')
      const title = target
        .replace(/^碧蓝(?:海事局|航线)/, '').replace(/攻略专题页$|活动专题$|专题$/g, '')
        .replace(/^复刻/, '复刻 · ')
      add(`event:${canonical}`, title, '活动')
    }
  }
  for (const match of source.matchAll(/(?:^|[^0-9])((?:\d{1,2}-\d{1,2}|[A-Z]{1,2}\d{1,2}))(?![0-9])/gi)) {
    const stage = match[1].toUpperCase()
    add(`stage:${stage}`, `关卡 ${stage}`, '关卡')
  }
  if (ship.releaseDate) add(`release:${ship.releaseDate}`, `同期实装 · ${ship.releaseDate}`, '同期实装')
  return groups
}

function acquisitionFor(ship, raw) {
  if (ship.isRetrofit) return {
    acquisition: ['改造'], availability: '常驻',
    acquisitionText: `将「${ship.name}」完成近代化改造后解锁`, dropLocations: '', acquisitionGroups: []
  }
  const other = templateValue(raw, '其他获取途径')
  const drop = templateValue(raw, '掉落点') || (ship.dropPoints || []).map(value => cleanWiki(value)).join('、')
  const combined = `${other} ${drop} ${raw.slice(0, 9000)}`
  const methods = []
  if (ship.group === '方案' || /科研|开发船坞|方案舰|决战方案/.test(combined)) methods.push('科研')
  if (ship.group === '联动') methods.push('联动')
  if (ship.group === 'META') methods.push('META')
  if (/限时建造|限时池/.test(combined)) methods.push('限时建造')
  if (/轻型建造|重型建造|特型建造|常驻建造|建造获得/.test(combined) || (ship.buildTime && !methods.includes('限时建造'))) methods.push('常驻建造')
  if (/活动兑换|商店兑换|军需商店|荣誉勋章兑换|核心兑换|兑换获得/.test(combined)) methods.push('活动兑换')
  if (drop || /打捞|掉落/.test(combined)) methods.push('海域打捞')
  if (/签到|任务|收藏奖励|邀请函|累计奖励|通关奖励|活动获得/.test(combined)) methods.push('活动奖励')
  if (!methods.length) methods.push('其他')

  let availability = '未知'
  if (ship.group === '方案') availability = '科研常驻'
  else if (ship.group === '联动') availability = '联动限定'
  else if (methods.includes('常驻建造') || methods.includes('海域打捞') || /永久|常驻|作战档案/.test(combined)) availability = '常驻'
  else if (methods.includes('限时建造')) availability = '限时'
  else if (/已绝版|暂无获取|暂时无法|无法获得/.test(combined)) availability = '暂不可获取'
  else if (/活动/.test(combined) || ship.group === 'META') availability = '活动限定'

  return {
    acquisition: [...new Set(methods)], availability,
    acquisitionText: other || (ship.group === '方案' ? '军部科研室开发船坞' : ship.group === '联动' ? '联动活动期间获取' : '详细获取方式请查看资料来源'),
    dropLocations: drop,
    acquisitionGroups: acquisitionGroupsFor(ship, raw)
  }
}

async function fetchShips() {
  const query = '[[分类:舰娘||联动舰娘||META舰娘||方案舰娘]]|?稀有度|?类型|?阵营|?分组|?特殊分组|?和谐名|?编号|?实装日期|?耗时|?画师|?CV|?掉落点|sort=稀有度编号,编号|order=desc|limit=1000'
  const json = await api({ action: 'ask', query })
  const normal = Object.values(json.query?.results || {}).map(entry => {
    const p = entry.printouts || {}
    const value = key => Array.isArray(p[key]) ? String(p[key][0] ?? '') : ''
    const values = key => Array.isArray(p[key]) ? p[key].map(item => String(item ?? '')).filter(Boolean) : []
    const name = entry.fulltext
    return {
      id: `ship:${encodeURIComponent(name)}`, name,
      displayName: value('和谐名') || name,
      number: value('编号'), rarity: value('稀有度') || '未知', type: value('类型') || '未知',
      faction: value('阵营') || '未知', group: value('分组'), specialGroup: value('特殊分组'),
      buildTime: value('耗时'), releaseDate: value('实装日期'), cv: value('CV'), artist: value('画师'),
      isRetrofit: false, baseShipName: '', dropPoints: values('掉落点'), wikiUrl: entry.fullurl,
      officialSearchUrl: `https://search.bilibili.com/all?keyword=${encodeURIComponent(`碧蓝航线 ${name}`)}`
    }
  })
  const retrofitQuery = '[[分类:改造]]|?改造后稀有度|?改造后类型|?阵营|?和谐名|?编号|?实装日期|?画师|?CV|sort=编号|order=asc|limit=1000'
  const retrofitJson = await api({ action: 'ask', query: retrofitQuery })
  const retrofit = Object.values(retrofitJson.query?.results || {}).map(entry => {
    const p = entry.printouts || {}
    const value = key => Array.isArray(p[key]) ? String(p[key][0] ?? '') : ''
    const name = entry.fulltext
    return {
      id: `retrofit:${encodeURIComponent(name)}`, name,
      displayName: `${value('和谐名') || name}·改`, number: value('编号'),
      rarity: value('改造后稀有度') || '未知', type: value('改造后类型') || '未知', faction: value('阵营') || '未知',
      group: '改造', specialGroup: '', buildTime: '', releaseDate: value('实装日期'), cv: value('CV'), artist: value('画师'),
      isRetrofit: true, baseShipName: name, wikiUrl: entry.fullurl,
      officialSearchUrl: `https://search.bilibili.com/all?keyword=${encodeURIComponent(`碧蓝航线 ${name} 改造`)}`
    }
  })
  return [...normal, ...retrofit]
}

async function enrichWikitext(ships) {
  for (let i = 0; i < ships.length; i += 30) {
    const batch = ships.slice(i, i + 30)
    const json = await api({ action: 'query', titles: batch.map(s => s.name).join('|'), prop: 'revisions', rvprop: 'content', rvslots: 'main', formatversion: 2 })
    const map = new Map((json.query?.pages || []).map(page => [page.title, page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.content || '']))
    for (const ship of batch) {
      const source = map.get(ship.name) || ''
      Object.assign(ship, acquisitionFor(ship, source), { profile: profileFor(source) })
    }
    process.stdout.write(`\r资料 ${Math.min(i + batch.length, ships.length)}/${ships.length}`)
  }
  process.stdout.write('\n')
}

async function enrichImages(ships) {
  for (let i = 0; i < ships.length; i += 25) {
    const batch = ships.slice(i, i + 25)
    const titles = batch.flatMap(s => s.isRetrofit
      ? [`File:${s.name}改头像.jpg`, `File:${s.name}改造.jpg`]
      : [`File:${s.name}头像.jpg`, `File:${s.name}立绘.jpg`]).join('|')
    const json = await api({ action: 'query', titles, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: 720, formatversion: 2 })
    const map = new Map((json.query?.pages || []).map(page => [page.title.replace(/^文件:|^File:/, ''), page.imageinfo?.[0]]))
    for (const ship of batch) {
      const avatar = map.get(ship.isRetrofit ? `${ship.name}改头像.jpg` : `${ship.name}头像.jpg`)
      const art = map.get(ship.isRetrofit ? `${ship.name}改造.jpg` : `${ship.name}立绘.jpg`)
      ship.avatarUrl = avatar?.thumburl || avatar?.url || ''
      ship.artUrl = art?.thumburl || art?.url || ''
    }
    process.stdout.write(`\r图片 ${Math.min(i + batch.length, ships.length)}/${ships.length}`)
  }
  process.stdout.write('\n')
}

async function fetchSkins() {
  const json = await api({ action: 'parse', page: '模块:ClothList/json', prop: 'wikitext' })
  const records = JSON.parse(json.parse?.wikitext?.['*'] || '[]')
  return records.map((raw, index) => {
    const shipName = String(raw['船名'] || '').trim()
    const tag = String(raw['换装'] || '').trim()
    const name = String(raw['换装名称'] || '').trim()
    return {
      id: `skin:${encodeURIComponent(shipName)}:${encodeURIComponent(tag || name || index)}`,
      shipName, name, tag,
      type: String(raw['舰种'] || '').trim(), faction: String(raw['阵营'] || '').trim(),
      theme: String(raw['主题'] || '其他').trim(), price: String(raw['价格'] || '').trim(),
      acquisition: String(raw['获取方式'] || '未知').trim(), expression: String(raw['表情差分'] || '').trim(),
      artType: String(raw['立绘类型'] || '静态').trim() || '静态',
      backgroundType: String(raw['背景类型'] || '').trim(), accessory: String(raw['背景物件'] || '').trim(),
      note: String(raw['备注'] || '').trim(), releaseDate: String(raw['实装时间'] || '').trim(),
      imageUrl: '', wikiUrl: `https://wiki.biligame.com/blhx/${encodeURIComponent(shipName)}`
    }
  }).filter(skin => skin.shipName && skin.name)
}

async function enrichSkinImages(skins) {
  for (let i = 0; i < skins.length; i += 45) {
    const batch = skins.slice(i, i + 45)
    const json = await api({
      action: 'query', titles: batch.map(skin => `File:${skin.shipName}${skin.tag}.jpg`).join('|'),
      prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: 720, formatversion: 2
    })
    const map = new Map((json.query?.pages || []).map(page => [page.title.replace(/^文件:|^File:/, ''), page.imageinfo?.[0]]))
    for (const skin of batch) {
      const info = map.get(`${skin.shipName}${skin.tag}.jpg`)
      skin.imageUrl = info?.thumburl || info?.url || ''
    }
    process.stdout.write(`\r皮肤图片 ${Math.min(i + batch.length, skins.length)}/${skins.length}`)
  }
  process.stdout.write('\n')
}

function cleanReward(value) {
  return String(value || '')
    .replace(/\{\{#info:[^]*?\}\}/g, '')
    .replace(/\{\{(?:小图标2?|道具)\|([^}|]+)[^}]*\}\}/g, '$1')
    .replace(/\[\[(?:File|文件):[^\]]+\]\]/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .trim()
}

async function fetchCollectionGroups() {
  const json = await api({ action: 'parse', page: '收藏奖励', prop: 'wikitext' })
  const text = json.parse?.wikitext?.['*'] || ''
  const headings = [...text.matchAll(/^====([^=\r\n]+)====\s*$/gm)]
  return headings.map((heading, index) => {
    const name = heading[1].trim()
    const section = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length)
    const shipBlock = section.match(/包含舰船[^]*?\|-\s*\n\|colspan=2[^|]*\|([^\n]+)/)?.[1] || ''
    const shipNames = [...shipBlock.matchAll(/\{\{小图标\|([^}|]+)[^}]*\}\}/g)].map(match => match[1].trim())
    const rewards = [...section.matchAll(/\|(\d+)★奖励\s*\|\|([^\r\n]+)/g)].map(match => ({
      stars: Number(match[1]), label: cleanReward(match[2])
    }))
    return {
      id: `collection:${encodeURIComponent(name)}`, name, shipNames, rewards,
      wikiUrl: 'https://wiki.biligame.com/blhx/收藏奖励'
    }
  }).filter(group => group.shipNames.length && group.rewards.length)
}

export async function syncData(output = path.join(root, 'data', 'ships.json')) {
  console.log('正在读取 BWIKI 公共页面数据…')
  let ships
  let existing
  try { existing = JSON.parse(await readFile(output, 'utf8')) } catch {}
  try {
    ships = await fetchShips()
    await enrichWikitext(ships)
    await enrichImages(ships)
  } catch (error) {
    if (!existing?.ships?.length) throw error
    console.warn(`舰船源暂时受限，沿用本地 ${existing.ships.length} 条快照并补齐归组：${error.message || error}`)
    ships = existing.ships.map(ship => ({
      ...ship,
      acquisitionGroups: acquisitionGroupsFor(ship, `|其他获取途径=${ship.acquisitionText || ''}\n|掉落点=${ship.dropLocations || ''}`)
    }))
  }
  let skins
  let collectionGroups
  try {
    skins = await fetchSkins()
    await enrichSkinImages(skins)
  } catch (error) {
    if (!existing?.skins?.length) throw error
    skins = existing.skins
    console.warn(`皮肤源暂时受限，沿用本地 ${skins.length} 条快照：${error.message || error}`)
  }
  try {
    collectionGroups = await fetchCollectionGroups()
  } catch (error) {
    if (!existing?.collectionGroups?.length) throw error
    collectionGroups = existing.collectionGroups
    console.warn(`收藏奖励源暂时受限，沿用本地 ${collectionGroups.length} 组快照：${error.message || error}`)
  }
  const syncedAt = new Date().toISOString()
  for (const ship of ships) ship.syncedAt = syncedAt
  for (const skin of skins) skin.syncedAt = syncedAt
  const payload = {
    meta: {
      lastSync: syncedAt,
      dataVersion: syncedAt.slice(0, 10),
      sourceLabel: 'Bilibili 碧蓝航线 BWIKI 公共页面；状态以国服官方公告为准',
      sourceUrl: 'https://wiki.biligame.com/blhx/舰船图鉴',
      officialUrl: 'https://www.biligame.com/detail/?id=97'
    }, ships, skins, collectionGroups
  }
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`已写入 ${ships.length} 艘舰船、${skins.length} 款皮肤、${collectionGroups.length} 组收藏奖励：${output}`)
  return payload
}

if (process.argv[1] === fileURLToPath(import.meta.url)) syncData().catch(error => { console.error(error); process.exitCode = 1 })
