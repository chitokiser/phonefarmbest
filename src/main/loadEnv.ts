import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Minimal .env loader (no dependency needed for one key). Looks in the project root
 * relative to the process's working directory, which is where electron-vite dev/build
 * runs from. Doesn't override variables already set in the real environment.
 */
export function loadEnvFile(): void {
  const path = join(process.cwd(), '.env')
  if (!existsSync(path)) return

  const content = readFileSync(path, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}
