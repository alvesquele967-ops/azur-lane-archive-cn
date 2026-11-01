import { describe, expect, it } from 'vitest'
import data from '../data/ships.json'
import { getRarityOrder } from '../src/sync'

describe('bundled CN ship snapshot', () => {
  it('contains the normal and retrofit atlases', () => {
    const normal = data.ships.filter(ship => !ship.isRetrofit)
    const retrofit = data.ships.filter(ship => ship.isRetrofit)
    expect(normal.length).toBeGreaterThan(800)
    expect(retrofit.length).toBeGreaterThan(100)
  })

  it('provides artwork and source links for every entry', () => {
    expect(data.ships.every(ship => ship.avatarUrl && ship.artUrl)).toBe(true)
    expect(data.ships.every(ship => ship.wikiUrl.startsWith('https://wiki.biligame.com/blhx/'))).toBe(true)
  })

  it('uses stable unique IDs across atlases', () => {
    const ids = data.ships.map(ship => ship.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some(id => id.startsWith('ship:'))).toBe(true)
    expect(ids.some(id => id.startsWith('retrofit:'))).toBe(true)
  })

  it('keeps rarity sorting deterministic', () => {
    expect(getRarityOrder('海上传奇')).toBeGreaterThan(getRarityOrder('超稀有'))
    expect(getRarityOrder('超稀有')).toBeGreaterThan(getRarityOrder('精锐'))
  })
})
