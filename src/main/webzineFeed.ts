import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const FEED_URL = 'https://zentaro-backend-production.up.railway.app/api/webzine/feed'
const GENERATE_PROMO_URL = 'https://zentaro-backend-production.up.railway.app/api/ai-writer/external/generate-promo'
const CARD_NEWS_TAG = '📰 ZenTaro 카드뉴스'

export interface FeedItem {
  id: string
  url: string
  title: string
  excerpt: string
  thumbnailUrl?: string
  publishedAt: string
  tags?: string[]
}

export type PostingPlatform = 'facebook' | 'blogger' | 'instagram'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

/**
 * Triggers generation of one new card-news article via the external AI-writer API (no
 * topicId in the body - the backend auto-rotates topics) and waits for it to show up in the
 * public feed. The endpoint itself only queues the job and returns an id immediately -
 * confirmed empirically that the article appears in fetchFeed() a few seconds later, tagged
 * CARD_NEWS_TAG - so this polls for it instead of assuming a fixed delay.
 */
async function generateCardNewsItem(): Promise<FeedItem> {
  const apiKey = process.env.CARD_NEWS_API_KEY
  if (!apiKey) throw new Error('CARD_NEWS_API_KEY is not set')

  const response = await fetch(GENERATE_PROMO_URL, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  if (!response.ok) throw new Error(`generate-promo request failed: ${response.status}`)
  const { id } = (await response.json()) as { id: string }

  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(2000)
    const items = await fetchFeed()
    const created = items.find((item) => item.id === id)
    if (created) return created
  }
  throw new Error(`generated card-news article ${id} did not appear in the feed in time`)
}

// Instagram only ever posts card-news articles (tagged CARD_NEWS_TAG by the AI writer), not
// the full webzine pool getRandomUnpostedItem draws from - regular articles aren't meant for
// Instagram's image-first format. Unlike the other platforms, this never returns null: if
// every existing card-news article has already been posted from this device, it generates a
// fresh one on the spot rather than the caller having nothing to post.
export async function getRandomUnpostedCardNewsItem(serial: string): Promise<FeedItem> {
  const [items, posted] = await Promise.all([fetchFeed(), loadPostedIds('instagram')])
  const postedForDevice = new Set(posted[serial] ?? [])
  const unposted = items.filter((item) => item.tags?.includes(CARD_NEWS_TAG) && !postedForDevice.has(item.id))
  if (unposted.length > 0) return unposted[Math.floor(Math.random() * unposted.length)]
  return generateCardNewsItem()
}
