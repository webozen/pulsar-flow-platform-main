#!/usr/bin/env node
/**
 * Minimal Flyway-style migration runner for Postgres.
 *
 * Reads db/migrations/*.sql in lexical order, records each applied filename
 * in flowcore._migrations, and re-runs nothing already applied.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-pg.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()

await client.query('CREATE SCHEMA IF NOT EXISTS flowcore')
await client.query(`
  CREATE TABLE IF NOT EXISTS flowcore._migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    checksum text NOT NULL
  )
`)

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
if (files.length === 0) {
  console.log('No migrations found.')
  await client.end()
  process.exit(0)
}

const { rows: applied } = await client.query('SELECT filename, checksum FROM flowcore._migrations')
const appliedMap = new Map(applied.map((r) => [r.filename, r.checksum]))

let runCount = 0
for (const filename of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
  const { createHash } = await import('node:crypto')
  const checksum = createHash('sha256').update(sql).digest('hex')

  if (appliedMap.has(filename)) {
    if (appliedMap.get(filename) !== checksum) {
      console.error(
        `[migrate] CHECKSUM MISMATCH on ${filename} — the migration was modified after being applied. ` +
          `Revert the file or write a new migration.`,
      )
      process.exit(1)
    }
    continue
  }

  console.log(`[migrate] applying ${filename}`)
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query(
      'INSERT INTO flowcore._migrations (filename, checksum) VALUES ($1, $2)',
      [filename, checksum],
    )
    await client.query('COMMIT')
    runCount++
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`[migrate] failed ${filename}:`, err.message)
    process.exit(1)
  }
}

console.log(`[migrate] done. applied=${runCount} total=${files.length}`)
await client.end()
