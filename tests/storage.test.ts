import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'

describe('local collection persistence', () => {
  it('keeps a lit ship after exporting and reopening SQLite', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run('CREATE TABLE collection (ship_id TEXT PRIMARY KEY, owned INTEGER NOT NULL)')
    db.run('INSERT INTO collection (ship_id, owned) VALUES (?, ?)', ['ship:test', 1])
    const reopened = new SQL.Database(db.export())
    const result = reopened.exec("SELECT owned FROM collection WHERE ship_id='ship:test'")
    expect(result[0].values[0][0]).toBe(1)
    reopened.close()
    db.close()
  })

  it('supports cancelling a lit state without deleting the record', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run('CREATE TABLE collection (ship_id TEXT PRIMARY KEY, owned INTEGER NOT NULL)')
    db.run('INSERT INTO collection VALUES (?, ?)', ['retrofit:test', 1])
    db.run('UPDATE collection SET owned=0 WHERE ship_id=?', ['retrofit:test'])
    expect(db.exec("SELECT owned FROM collection WHERE ship_id='retrofit:test'")[0].values[0][0]).toBe(0)
    db.close()
  })
})
