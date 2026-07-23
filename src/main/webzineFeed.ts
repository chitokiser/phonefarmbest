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

export type PostingPlatform = 'facebook' | 'blogger'

function postedIdsPath(platform: PostingPlatform): string {
  return join(app.getPath('userData'), `${platform}-posted-ids.json`)
}

// Keyed by device serial rather than global: different devices can be signed into
// different accounts (Facebook or Google), so the same article posted from two devices is
// two legitimate posts, not a duplicate. Separate per-platform files since posting an
// article to Facebook shouldn't count as "already posted" for Blogger and vice versa.
async function loadPostedIds(platform: PostingPlatform): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(postedIdsPath(platform), 'utf8')
    return JSON.parse(raw) as Record<string, string[]>
  } catch {
    return {}
  }
}

async function savePostedIds(platform: PostingPlatform, data: Record<string, string[]>): Promise<void> {
  await writeFile(postedIdsPath(platform), JSON.stringify(data, null, 2), 'utf8')
}

export async function fetchFeed(): Promise<FeedItem[]> {
  const response = await fetch(FEED_URL)
  if (!response.ok) throw new Error(`webzine feed request failed: ${response.status}`)
  const items = (await response.json()) as FeedItem[]
  // thumbnailUrl comes back as a path relative to the article's own origin (e.g.
  // "/images/rewards/foo.jpg") rather than a full URL - confirmed against the live feed.
  // Resolving it against item.url up front means every caller can just fetch() it directly.
  return items.map((item) =>
    item.thumbnailUrl ? { ...item, thumbnailUrl: new URL(item.thumbnailUrl, item.url).toString() } : item
  )
}

// Picks randomly rather than always "the latest unposted" - multiple devices calling this
// around the same time (none of them having posted anything yet) would otherwise all land
// on the exact same article, since they'd all see the same feed with nothing excluded yet.
export async function getRandomUnpostedItem(serial: string, platform: PostingPlatform): Promise<FeedItem | null> {
  const [items, posted] = await Promise.all([fetchFeed(), loadPostedIds(platform)])
  const postedForDevice = new Set(posted[serial] ?? [])
  const unposted = items.filter((item) => !postedForDevice.has(item.id))
  if (unposted.length === 0) return null
  return unposted[Math.floor(Math.random() * unposted.length)]
}

export async function markPosted(serial: string, platform: PostingPlatform, id: string): Promise<void> {
  const posted = await loadPostedIds(platform)
  const forDevice = posted[serial] ?? []
  if (!forDevice.includes(id)) forDevice.push(id)
  posted[serial] = forDevice
  await savePostedIds(platform, posted)
}
