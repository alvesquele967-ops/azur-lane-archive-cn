import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const API = 'https://wiki.biligame.com/blhx/api.php'
const target = path.resolve(process.argv[2] || 'data/ships.json')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let lastCall = 0

async function api(params, attempts = 5) {
  const url = new URL(API)
  for (const [key, value] of Object.entries({ format: 'json', formatversion: 2, origin: '*', ...params })) url.searchParams.set(key, String(value))
  let error
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const wait = Math.max(0, 600 - (Date.now() - lastCall)); if (wait) await pause(wait)
      lastCall = Date.now()
      const response = await fetch(url, { headers: { 'User-Agent': 'AzurLaneArchiveCN/1.3 (public BWIKI offline profile cache)' }, signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    } catch (next) { error = next; await pause(1000 * (attempt + 1)) }
  }
  throw error
}

function rawValue(source, key) { return source.match(new RegExp(`^\\|${key}=([^\\r\\n]*)`, 'm'))?.[1]?.trim() || '' }
function clean(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').replace(/\{\{[^{}]*\}\}/g, '').replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '').replace(/[ \t]+/g, ' ').trim()
}
function values(source, prefix, keys) { return Object.fromEntries(keys.map(key => [key, clean(rawValue(source, `${prefix}${key}`))]).filter(([, value]) => value !== '')) }
function parseProfile(source) {
  const skills = []
  for (let index = 1; index <= 6; index++) {
    const normalName = clean(rawValue(source, `技能${index}名`)); const normal = clean(rawValue(source, `技能${index}`))
    const retrofitName = clean(rawValue(source, `技能${index}名改造`)); const retrofit = clean(rawValue(source, `技能${index}改造`))
    if (normalName || normal) skills.push({ name: normalName || `技能 ${index}`, description: normal })
    if (retrofitName || retrofit) skills.push({ name: retrofitName || `改造技能 ${index}`, description: retrofit, retrofit: true })
  }
  const equipmentSlots = []
  for (let index = 1; index <= 5; index++) {
    const type = clean(rawValue(source, `${index}号槽装备类型`)); const initial = clean(rawValue(source, `装备${index}`))
    if (type || initial) equipmentSlots.push({ type, initial, efficiencyInitial: clean(rawValue(source, `${index}号槽装备效率初始`)), efficiencyMax: clean(rawValue(source, `${index}号槽装备效率满破`)) })
  }
  const statKeys = ['耐久','装填','命中','炮击','雷击','机动','防空','航空','消耗','反潜','航速','幸运']
  const ratingKeys = ['耐久','防空','机动','航空','雷击','炮击']
  const characterKeys = ['身份','性格','关键词','持有物','发色','瞳色','萌点','CV','画师','舰船型号台词','自我介绍台词']
  const lineKeys = ['获取台词','登录台词','查看详情台词','主界面1台词','主界面2台词','主界面3台词','普通触摸台词','特殊触摸台词','任务提醒台词','任务完成台词','邮件提醒台词','回港台词','胜利台词','失败台词','技能台词','誓约台词']
  return {
    model: clean(rawValue(source, '型号')), englishName: clean(rawValue(source, '英文名')), japaneseName: clean(rawValue(source, '日文名')),
    armor: clean(rawValue(source, '装甲类型')), initialStars: clean(rawValue(source, '初始星级')),
    statsInitial: values(source, '初始', statKeys), statsMax: values(source, '满级', statKeys), statsRetrofit: values(source, '改造满级', statKeys),
    ratings: values(source, '图鉴', ratingKeys), skills, equipmentSlots,
    technology: values(source, '', ['解锁图鉴科技点','突破至满星科技点','达到120级科技点','解锁图鉴属性加成','达到120级属性加成']),
    character: values(source, '', characterKeys), lines: values(source, '', lineKeys),
    evaluation: clean(rawValue(source, '评价')), retrofitDate: clean(rawValue(source, '改造日期')), retrofitRequirements: clean(rawValue(source, '改造需求合计')),
    rawUpdatedAt: new Date().toISOString()
  }
}

const payload = JSON.parse(await readFile(target, 'utf8'))
const names = [...new Set(payload.ships.map(ship => ship.name))]
const profiles = new Map()
for (let index = 0; index < names.length; index += 30) {
  const batch = names.slice(index, index + 30)
  const json = await api({ action: 'query', titles: batch.join('|'), redirects: 1, prop: 'revisions', rvprop: 'content|timestamp', rvslots: 'main' })
  for (const page of json.query?.pages || []) {
    const source = page.revisions?.[0]?.slots?.main?.content || ''
    if (source) profiles.set(page.title, parseProfile(source))
  }
  for (const redirect of json.query?.redirects || []) if (profiles.has(redirect.to)) profiles.set(redirect.from, profiles.get(redirect.to))
  process.stdout.write(`\r角色档案 ${Math.min(index + batch.length, names.length)}/${names.length}`)
}
for (const ship of payload.ships) if (profiles.has(ship.name)) ship.profile = profiles.get(ship.name)
payload.meta.profileSync = new Date().toISOString()
await writeFile(target, JSON.stringify(payload, null, 2), 'utf8')
console.log(`\n已写入 ${profiles.size} 份本地角色档案`)
