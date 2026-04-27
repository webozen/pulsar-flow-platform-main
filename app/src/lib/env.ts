/**
 * Read an environment variable with explicit dev/prod semantics.
 *
 * - Production (`NODE_ENV === 'production'`): missing value throws at
 *   module-load time — boot fails fast instead of silently falling back
 *   to a localhost URL that 502s in prod.
 * - Non-prod: missing value returns the dev default if provided, or
 *   throws if no default was passed.
 */
export function requireEnv(name: string, devDefault?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`[env] ${name} is required in production (no fallback)`);
  }
  if (devDefault === undefined) {
    throw new Error(`[env] ${name} is required (no dev default supplied)`);
  }
  return devDefault;
}
