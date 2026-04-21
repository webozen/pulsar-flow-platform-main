import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Shared JWT contract tests. Both pulsar-backend (jjwt) and this service
 * (jsonwebtoken) load docs/jwt-contract/fixtures.json and assert every token
 * verifies + produces the expected claims. If either library drifts, both
 * suites fail loudly before a deploy.
 *
 * See docs/jwt-contract/README.md.
 */

interface FixtureCase {
  name: string
  secret: string
  algorithm: 'HS256' | 'HS384' | 'HS512'
  token: string
  expected: Record<string, string>
}

interface Fixture {
  version: number
  description: string
  cases: FixtureCase[]
}

// Walk up from __dirname looking for docs/jwt-contract/fixtures.json; this
// keeps the test portable whether it's invoked from app/, the monorepo root,
// or some CI working dir.
function resolveFixturePath(): string {
  const override = process.env.JWT_CONTRACT_FIXTURE
  if (override && fs.existsSync(override)) return override

  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'docs', 'jwt-contract', 'fixtures.json')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fall back to the literal relative path for a clear error message.
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'docs',
    'jwt-contract',
    'fixtures.json',
  )
}

const fixturePath = resolveFixturePath()
let fixture: Fixture

describe('JWT contract (jsonwebtoken vs shared fixture)', () => {
  beforeAll(() => {
    if (!fs.existsSync(fixturePath)) {
      // Defensive: log the absolute path so debugging is obvious.
      // eslint-disable-next-line no-console
      console.error(
        `[jwt-contract] fixture not found at ${fixturePath}. ` +
          `Set JWT_CONTRACT_FIXTURE to an absolute path or ensure ` +
          `docs/jwt-contract/fixtures.json exists in the monorepo.`,
      )
      throw new Error(`JWT contract fixture missing: ${fixturePath}`)
    }
    fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Fixture
    expect(fixture.cases.length).toBeGreaterThan(0)
  })

  it('fixture has expected top-level shape', () => {
    expect(fixture.version).toBe(1)
    expect(Array.isArray(fixture.cases)).toBe(true)
  })

  // Build the per-case tests eagerly by reading the file at module-load.
  // Vitest needs the it()s registered synchronously; beforeAll only runs
  // inside the describe at runtime, so we also load once here.
  const preloaded: Fixture = fs.existsSync(fixturePath)
    ? (JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Fixture)
    : { version: 0, description: '', cases: [] }

  for (const c of preloaded.cases) {
    it(`verifies ${c.name}`, () => {
      // 1. jsonwebtoken must verify the token under the declared algorithm only.
      const payload = jwt.verify(c.token, c.secret, {
        algorithms: [c.algorithm],
      }) as Record<string, unknown>

      // 2. Every field in `expected` must be present and match.
      for (const [claim, wanted] of Object.entries(c.expected)) {
        expect(String(payload[claim]), `case=${c.name} claim=${claim}`).toBe(
          wanted,
        )
      }

      // 3. Header alg must match what the fixture declares.
      const decoded = jwt.decode(c.token, { complete: true })
      expect(decoded, `case=${c.name}`).not.toBeNull()
      expect(decoded!.header.alg, `case=${c.name} header.alg`).toBe(c.algorithm)
    })
  }
})
