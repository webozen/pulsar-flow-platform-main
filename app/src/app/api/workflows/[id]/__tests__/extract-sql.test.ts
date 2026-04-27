import { describe, it, expect } from 'vitest'
import { extractSqlFromFlow } from '../route'

describe('extractSqlFromFlow', () => {
  it('returns empty for null/undefined/no-tasks input', () => {
    expect(extractSqlFromFlow(null)).toBe('')
    expect(extractSqlFromFlow(undefined)).toBe('')
    expect(extractSqlFromFlow({})).toBe('')
    expect(extractSqlFromFlow({ tasks: [] })).toBe('')
  })

  it('returns empty when no http.Request task is present', () => {
    const flow = { tasks: [{ id: 'log', type: 'io.kestra.plugin.core.log.Log', message: 'hi' }] }
    expect(extractSqlFromFlow(flow)).toBe('')
  })

  it('returns empty when the http.Request body has no SqlCommand', () => {
    const flow = {
      tasks: [{
        id: 'fetch', type: 'io.kestra.plugin.core.http.Request',
        body: '{"foo":"bar"}',
      }],
    }
    expect(extractSqlFromFlow(flow)).toBe('')
  })

  it('extracts the SqlCommand from the first http.Request task', () => {
    const sql = "SELECT a.AptNum, p.FName FROM appointment a JOIN patient p ON a.PatNum=p.PatNum WHERE a.AptStatus = 1"
    const flow = {
      tasks: [{
        id: 'fetch', type: 'io.kestra.plugin.core.http.Request',
        body: `{"SqlCommand":"${sql}"}`,
      }],
    }
    expect(extractSqlFromFlow(flow)).toBe(sql)
  })

  it('unescapes JSON-escaped quotes inside the SQL string', () => {
    const flow = {
      tasks: [{
        id: 'fetch', type: 'io.kestra.plugin.core.http.Request',
        body: `{"SqlCommand":"SELECT * FROM t WHERE name = \\"Smith\\""}`,
      }],
    }
    expect(extractSqlFromFlow(flow)).toBe('SELECT * FROM t WHERE name = "Smith"')
  })

  it('skips non-string body values (some Kestra payloads have body as object)', () => {
    const flow = {
      tasks: [{
        id: 'fetch', type: 'io.kestra.plugin.core.http.Request',
        body: { SqlCommand: 'SELECT 1' } as unknown as string,
      }],
    }
    expect(extractSqlFromFlow(flow)).toBe('')
  })

  it('finds the SQL even when later tasks are different types', () => {
    const flow = {
      tasks: [
        { id: 'fetch', type: 'io.kestra.plugin.core.http.Request', body: '{"SqlCommand":"SELECT 42"}' },
        { id: 'log', type: 'io.kestra.plugin.core.log.Log' },
        { id: 'loop', type: 'io.kestra.plugin.core.flow.ForEach' },
      ],
    }
    expect(extractSqlFromFlow(flow)).toBe('SELECT 42')
  })
})

