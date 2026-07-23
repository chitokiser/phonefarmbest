import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const FEED_URL = 'https://zentaro-backend-production.up.railway.app/api/webzine/feed'

export interface FeedItem {
  id: string
  url: string
  title: string
  excerpt: string
  thumbnailUrl?: string
  publishedAt: string
}

function postedIdsPath(): string {
  return join(app.getPath('userData'), 'facebook-posted-ids.json')
}

// Keyed by device serial rather than global: different devices can be signed into
// different Facebook accounts, so the same article posted from two devices is two
// legitimate posts, not a duplicate.
async function loadPostedIds(): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(postedIdsPath(), 'utf8')
    return JSON.parse(raw) as Record<string, string[]>
  } catch {
    return {}
  }
}

async function savePostedIds(data: Record<string, string[]>): Promise<void> {
  await writeFile(postedIdsPath(), JSON.stringify(data, null, 2), 'utf8')
}

export async function fetchFeed(): Promise<FeedItem[]> {
  const response = await fetch(FEED_URL)
  if (!response.ok) throw new Error(`webzine feed request failed: ${response.status}`)
  return (await response.json()) as FeedItem[]
}

export async function getNextUnpostedItem(serial: string): Promise<FeedItem | null> {
  const [items, posted] = await Promise.all([fetchFeed(), loadPostedIds()])
  const postedForDevice = new Set(posted[serial] ?? [])
  const sorted = [...items].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
  return sorted.find((item) => !postedForDevice.has(item.id)) ?? null
}

export async function markPosted(serial: string, id: string): Promise<void> {
  const posted = await loadPostedIds()
  const forDevice = posted[serial] ?? []
  if (!forDevice.includes(id)) forDevice.push(id)
  posted[serial] = forDevice
  await savePostedIds(posted)
}
