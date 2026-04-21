import jwt from 'jsonwebtoken'

const DEV_SENTINEL = 'dev-secret-change-me-please-32bytes-minimum-abcdefgh'

function resolveJwtSecret(): string {
  const raw = process.env.PULSAR_JWT_SECRET
  const isProd = process.env.NODE_ENV === 'production'

  if (isProd) {
    if (!raw || raw.length === 0) {
      throw new Error(
        '[pulsar-auth] PULSAR_JWT_SECRET is required in production but was null/empty.',
      )
    }
    if (raw === DEV_SENTINEL) {
      throw new Error(
        '[pulsar-auth] PULSAR_JWT_SECRET is the public dev sentinel in production; ' +
          'refusing to start. Set a real 32+ char secret.',
      )
    }
    if (raw.length < 32) {
      throw new Error(
        `[pulsar-auth] PULSAR_JWT_SECRET must be at least 32 characters in production; got ${raw.length}.`,
      )
    }
    return raw
  }

  const effective = raw && raw.length > 0 ? raw : DEV_SENTINEL
  if (effective === DEV_SENTINEL) {
    console.warn(
      '[pulsar-auth] PULSAR_JWT_SECRET is using the public dev sentinel. ' +
        'OK for local dev; MUST be overridden in any shared/deployed environment.',
    )
  }
  return effective
}

const JWT_SECRET = resolveJwtSecret()

export interface PulsarClaims {
  slug: string
  email: string
  role: string
}

export function validateToken(token: string): PulsarClaims {
  try {
    // Pulsar's jjwt auto-picks HS256/HS384/HS512 by key length. Our 56-char dev
    // secret lands on HS384; prod secrets of 64+ chars would sign HS512. Accept
    // the whole HMAC family so this service doesn't have to track which one.
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256', 'HS384', 'HS512'],
    }) as Record<string, unknown>
    const slug = payload.slug as string
    if (!slug) throw new Error('missing slug')
    return {
      slug,
      email: (payload.email as string) || '',
      role: (payload.role as string) || 'tenant_user',
    }
  } catch (e) {
    console.error('[pulsar-auth] JWT verify failed:', (e as Error).message)
    throw new AuthError('Invalid or expired token')
  }
}

export function requireAuth(req: Request): PulsarClaims {
  const auth = req.headers.get('Authorization')
  const fromHeader = auth?.startsWith('Bearer ') ? auth.slice(7) : null

  const cookie = req.headers.get('Cookie') || ''
  const cookieMatch = cookie.match(/(?:^|;\s*)pulsar_jwt=([^;]+)/)
  const token = fromHeader || (cookieMatch ? cookieMatch[1] : null)

  if (!token) throw new AuthError('Unauthorized')
  return validateToken(token)
}

export class AuthError extends Error {
  status = 401
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export function authErrorResponse(e: unknown): Response {
  if (e instanceof AuthError) {
    return Response.json({ error: e.message }, { status: 401 })
  }
  console.error('[auth] Unexpected error:', e)
  return Response.json({ error: 'Internal error' }, { status: 500 })
}
