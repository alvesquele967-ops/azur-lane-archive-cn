import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const input = JSON.parse(await new Promise((resolve, reject) => {
  let text = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { text += chunk })
  process.stdin.on('end', () => resolve(text.replace(/^\uFEFF/, '')))
  process.stdin.on('error', reject)
}))
const file = path.resolve('data/ships.json')
const payload = JSON.parse(await readFile(file, 'utf8'))
const skinRecords = JSON.parse(input.skins)
const syncedAt = new Date().toISOString()

payload.skins = skinRecords.map((raw, index) => {
  const shipName = String(raw['船名'] || '').trim()
  const tag = String(raw['换装'] || '').trim()
  const name = String(raw['换装名称'] || '').trim()
  const imageFile = `${shipName}${tag}.jpg`
  return {
    id: `skin:${encodeURIComponent(shipName)}:${encodeURIComponent(tag || name || index)}`,
    shipName, name, tag, type: String(raw['舰种'] || '').trim(), faction: String(raw['阵营'] || '').trim(),
    theme: String(raw['主题'] || '其他').trim(), price: String(raw['价格'] || '').trim(),
    acquisition: String(raw['获取方式'] || '未知').trim(), expression: String(raw['表情差分'] || '').trim(),
    artType: String(raw['立绘类型'] || '').trim() || '静态', backgroundType: String(raw['背景类型'] || '').trim(),
    accessory: String(raw['背景物件'] || '').trim(), note: String(raw['备注'] || '').trim(),
    releaseDate: String(raw['实装时间'] || '').trim(),
    imageUrl: `https://wiki.biligame.com/blhx/Special:Redirect/file/${encodeURIComponent(imageFile)}`,
    wikiUrl: `https://wiki.biligame.com/blhx/${encodeURIComponent(shipName)}`, syncedAt
  }
}).filter(skin => skin.shipName && skin.name)

const rewardText = input.collection || ''
const headings = [...rewardText.matchAll(/^====([^=\r\n]+)====\s*$/gm)]
const cleanReward = value => String(value || '')
  .replace(/\{\{#info:[^]*?\}\}/g, '')
  .replace(/\{\{(?:小图标2?|道具)\|([^}|]+)[^}]*\}\}/g, '$1')
  .replace(/\[\[(?:File|文件):[^\]]+\]\]/gi, '').replace(/<[^>]+>/g, '').replace(/'{2,}/g, '').trim()
payload.collectionGroups = headings.map((heading, index) => {
  const name = heading[1].trim()
  const section = rewardText.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? rewardText.length)
  const shipBlock = section.match(/包含舰船[^]*?\|-\s*\n\|colspan=2[^|]*\|([^\n]+)/)?.[1] || ''
  const shipNames = [...shipBlock.matchAll(/\{\{小图标\|([^}|]+)[^}]*\}\}/g)].map(match => match[1].trim())
  const rewards = [...section.matchAll(/\|(\d+)★奖励\s*\|\|([^\r\n]+)/g)].map(match => ({ stars: Number(match[1]), label: cleanReward(match[2]) }))
  return { id: `collection:${encodeURIComponent(name)}`, name, shipNames, rewards, wikiUrl: 'https://wiki.biligame.com/blhx/收藏奖励' }
}).filter(group => group.shipNames.length && group.rewards.length)

for (const ship of payload.ships) {
  const groups = []
  const add = (key, label, kind) => { if (!groups.some(group => group.key === key)) groups.push({ key, label, kind }) }
  const source = `${ship.dropLocations || ''} ${ship.acquisitionText || ''}`
  for (const match of source.matchAll(/(?:^|[^0-9])((?:\d{1,2}-\d{1,2}|[A-Z]{1,2}\d{1,2}))(?![0-9])/gi)) {
    const stage = match[1].toUpperCase(); add(`stage:${stage}`, `关卡 ${stage}`, '关卡')
  }
  if (ship.releaseDate) add(`release:${ship.releaseDate}`, `同期实装 · ${ship.releaseDate}`, '同期实装')
  ship.acquisitionGroups = groups
}
payload.meta.lastSync = syncedAt
payload.meta.dataVersion = syncedAt.slice(0, 10)
await writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
console.log(`已合并 ${payload.ships.length} 艘舰船、${payload.skins.length} 款皮肤、${payload.collectionGroups.length} 组收藏奖励`)
