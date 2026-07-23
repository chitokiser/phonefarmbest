import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FeedItem } from '../webzineFeed'
import {
  assertForegroundPackage,
  centerOf,
  ensureAdbKeyboardIme,
  findElements,
  getDeviceModel,
  getScreenSize,
  lockPortraitRotation,
  pushFile,
  restoreIme,
  shell,
  tap,
  tapElement,
  typeText
} from './deviceControl'

const FACEBOOK_PACKAGE = 'com.facebook.katana'

/**
 * Per-model workarounds for composer flows that diverge too much for the pattern-based
 * lookups above to handle. Everything that's just a different label/class for the *same*
 * kind of element (text field class, confirm-button text, share-sheet shape) is handled by
 * broadening the regex patterns instead - this table is only for a device whose flow is
 * structurally different.
 *
 * Confirmed on a real SM_N976N: its composer has no "게시" button at all - the text editor's
 * "다음" button navigates past the plain composer straight into a "게시물 설정" screen whose
 * only way to actually post is a "공유하기" button in the top app bar. That screen's entire
 * content is collapsed into a single opaque accessibility node (content-desc only on the
 * screen title, nothing on individual rows/buttons) - confirmed by dumping the same screen
 * twice a second apart with no more detail appearing either time, so this isn't a settling/
 * timing issue, uiautomator genuinely can't see a target to tap there. `shareButtonRatio` is
 * that button's on-screen position as a fraction of the current display size (not a fixed
 * pixel pair) so it still lands correctly if the device's resolution/scaling ever changes.
 */
const DEVICE_QUIRKS: Record<string, { shareButtonRatio: { x: number; y: number } }> = {
  'SM-N976N': { shareButtonRatio: { x: 0.8, y: 0.074 } }
}

// Facebook's resource-ids are obfuscated app-wide ("(name removed)" in every uiautomator
// dump), unlike KakaoTalk - every lookup here has to key off content-desc/text/class
// instead.
const NEW_POST_ENTRY_PATTERN = /content-desc="무슨 생각을 하고 계신가요\?"/
// The composer's text field is a plain EditText on some devices and an AutoCompleteTextView
// on others (confirmed on a real device: same app version, different class for the same
// screen) - match either.
const POST_TEXT_FIELD_PATTERN = /class="android\.widget\.(EditText|AutoCompleteTextView)"/
// The full-screen text editor's confirm button reads "완료" on some devices and "다음" on
// others (confirmed on a real device: same app version, different label for the same screen).
const TEXT_EDITOR_DONE_PATTERN = /text="(완료|다음)"/
const POST_BUTTON_PATTERN = /content-desc="게시"/
const SHARE_TO_FEED_PATTERN = /text="피드"/
// Some devices show Android's own share sheet with a single collapsed "Facebook" entry
// instead of jumping straight into Facebook's own grid chooser (confirmed on a real device -
// same app version as one that goes straight to the grid). Opening that entry reveals the
// same "내 그룹/피드/내 스토리/..." options, but as a radio list that needs a separate
// confirm tap rather than navigating away immediately on tap.
const SHARE_SHEET_APP_ENTRY_PATTERN = /text="Facebook"/
const SHARE_SHEET_CONFIRM_ONCE_PATTERN = /text="한 번만"/

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Polls findElements for `pattern` instead of checking once - a cold Facebook launch racing
 * against the share-intent resolver appearing was confirmed flaky on a real device (a single
 * check right after a fixed delay sometimes caught a still-transitioning screen and found
 * neither target, landing somewhere unexpected instead of the resolver).
 */
async function waitForElements(
  serial: string,
  pattern: RegExp,
  attempts: number,
  intervalMs: number
): Promise<Awaited<ReturnType<typeof findElements>>> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = await findElements(serial, pattern)
    if (found.length > 0) return found
    await sleep(intervalMs)
  }
  return []
}

function postTextFor(item: FeedItem): string {
  return `${item.title}\n\n${item.excerpt}\n\n${item.url}`
}

/**
 * Downloads the item's thumbnail, pushes it to the device, and opens the composer with it
 * already attached via a SEND intent targeted directly at ComposerActivity (skipping the
 * "Feed / Story / Group" share-target chooser entirely).
 *
 * The MediaStore content:// URI is resolved by querying for the exact `_data` path we just
 * pushed to, rather than passing a `file://` path directly - confirmed on a real device
 * that scoped storage silently drops a bare file:// URI from the SEND intent's extras, and
 * Facebook falls back to attaching whatever photo is newest in the camera roll instead.
 * Querying by path is what guarantees the attached image is actually this one.
 */
async function attachThumbnail(serial: string, item: FeedItem, thumbnailUrl: string): Promise<void> {
  const response = await fetch(thumbnailUrl)
  if (!response.ok) throw new Error(`[${serial}] failed to download thumbnail: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const localPath = join(tmpdir(), `webzine-${item.id}.jpg`)
  await writeFile(localPath, bytes)

  // MediaStore normalizes _data to the canonical /storage/emulated/0/... path even though
  // /sdcard/... (a symlink to it) works fine for the push/broadcast - querying by the
  // symlinked path found nothing on a real device, so push and query both use this form.
  const remotePath = `/storage/emulated/0/Pictures/webzine_${item.id}.jpg`
  await pushFile(serial, localPath, remotePath)
  await shell(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${remotePath}"`)
  // The scan broadcast returning doesn't mean MediaStore has indexed the row yet.
  await sleep(500)

  const queryOutput = await shell(
    serial,
    `content query --uri content://media/external/images/media --projection _id --where "_data='${remotePath}'"`
  )
  const idMatch = queryOutput.match(/_id=(\d+)/)
  if (!idMatch) throw new Error(`[${serial}] pushed thumbnail not found in MediaStore: ${queryOutput}`)
  const contentUri = `content://media/external/images/media/${idMatch[1]}`

  // Targeting ComposerActivity directly with -n (skipping the chooser) was tried and
  // confirmed NOT to work on a real device - it silently no-ops and focus stays on
  // FbMainTabActivity. Facebook's own share-target chooser has to be gone through instead.
  await shell(
    serial,
    `am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM ${contentUri} -p ${FACEBOOK_PACKAGE} --grant-read-uri-permission`
  )
  // Tapping the chooser's "피드" target immediately after it appears was confirmed to miss
  // (the GridView item list is still settling/animating in), and a cold Facebook launch
  // racing the resolver's appearance was confirmed flaky with only a single delayed check -
  // poll for it instead of a single fixed-delay check.
  let feedTargets = await waitForElements(serial, SHARE_TO_FEED_PATTERN, 5, 600)
  if (feedTargets.length === 0) {
    // "피드" isn't on screen yet - this device is showing the OS share sheet's single
    // collapsed Facebook entry (see SHARE_SHEET_APP_ENTRY_PATTERN) rather than Facebook's
    // own chooser directly. Open it to reveal the same options as a radio list.
    const appEntry = await waitForElements(serial, SHARE_SHEET_APP_ENTRY_PATTERN, 5, 600)
    if (appEntry.length === 0) throw new Error(`[${serial}] neither "피드" nor the share sheet's Facebook entry appeared`)
    const entryPoint = centerOf(appEntry[appEntry.length - 1])
    await tap(serial, entryPoint.x, entryPoint.y)

    feedTargets = await waitForElements(serial, SHARE_TO_FEED_PATTERN, 5, 600)
    if (feedTargets.length === 0) throw new Error(`[${serial}] "피드" share target not found`)
  }

  const { x, y } = centerOf(feedTargets[feedTargets.length - 1])
  await tap(serial, x, y)
  await sleep(500)

  // Some devices navigate away as soon as "피드" is tapped (Facebook's own chooser); others
  // land on a radio list where the tap only selects it and a separate confirm tap is needed
  // (both the OS share sheet's collapsed-entry flow above, and - confirmed on a real device
  // after clearing a stale "always" default - a plain OS resolver radio list reached directly,
  // no collapsed entry in between). Confirm if the button showed up; if it didn't, the tap
  // above already navigated away and there's nothing left to confirm.
  const confirmButton = await findElements(serial, SHARE_SHEET_CONFIRM_ONCE_PATTERN)
  if (confirmButton.length > 0) {
    const confirmPoint = centerOf(confirmButton[confirmButton.length - 1])
    await tap(serial, confirmPoint.x, confirmPoint.y)
  }

  await sleep(1000)
  await assertForegroundPackage(serial, FACEBOOK_PACKAGE, 'image attached, composer opened')
}

/**
 * Posts one webzine feed item to whatever Facebook account is signed into this device, as
 * a new feed post with its thumbnail attached (if it has one). Unlike the KakaoTalk reply
 * flow, this launches Facebook itself rather than requiring it already open: the target
 * (the home tab's post composer) is always in the same place, so there's no equivalent of
 * KakaoTalk remembering the last-open chat/filter to work around.
 */
export interface PostFeedItemOptions {
  /**
   * Stops right after the post text/image are in place and the "게시" button is confirmed
   * enabled, without tapping it - lets a human verify the attached image/text on the real
   * device before anything actually goes live. Used by __testFacebookPost.ts.
   */
  dryRun?: boolean
}

export async function postFeedItemToFacebook(
  serial: string,
  item: FeedItem,
  options: PostFeedItemOptions = {}
): Promise<void> {
  await shell(serial, `monkey -p ${FACEBOOK_PACKAGE} -c android.intent.category.LAUNCHER 1`)
  await sleep(2000)
  await assertForegroundPackage(serial, FACEBOOK_PACKAGE, 'facebook launched')
  await lockPortraitRotation(serial)

  const previousIme = await ensureAdbKeyboardIme(serial)
  try {
    if (item.thumbnailUrl) {
      await attachThumbnail(serial, item, item.thumbnailUrl)
    } else {
      // The home feed can reopen scrolled to wherever it was left (confirmed on a real
      // device: the compose entry was scrolled off past several posts/reels) - scroll to
      // the top a few times first so the entry is actually on screen to tap.
      for (let i = 0; i < 3; i++) {
        await shell(serial, 'input swipe 540 500 540 2000 300')
      }
      await sleep(300)
      await tapElement(serial, NEW_POST_ENTRY_PATTERN, 'new post composer entry')
      await sleep(1500)
      await assertForegroundPackage(serial, FACEBOOK_PACKAGE, 'composer opened')
    }

    // Tapping the text field opens a separate full-screen "add text" editor first (confirmed
    // on a real device) before landing back on the plain composer - it's still the same
    // Activity throughout, so this can't tell the two screens apart; just settle.
    await tapElement(serial, POST_TEXT_FIELD_PATTERN, 'post text field')
    await sleep(500)

    await typeText(serial, postTextFor(item))
    await sleep(500)

    await tapElement(serial, TEXT_EDITOR_DONE_PATTERN, 'text editor done button')
    await sleep(500)
    await assertForegroundPackage(serial, FACEBOOK_PACKAGE, 'text applied')

    const postButtons = await findElements(serial, POST_BUTTON_PATTERN)
    let finalTap: { x: number; y: number }
    if (postButtons.length > 0) {
      const enabledPostButton = postButtons.find((bounds) => bounds.enabled)
      if (!enabledPostButton) {
        throw new Error(`[${serial}] post button not enabled - text or image attach likely failed`)
      }
      finalTap = centerOf(enabledPostButton)
    } else {
      // No "게시" button anywhere in the tree - this device's flow has already moved past the
      // composer into a screen DEVICE_QUIRKS knows how to finish instead (see its comment).
      const model = await getDeviceModel(serial)
      const quirk = DEVICE_QUIRKS[model]
      if (!quirk) {
        throw new Error(`[${serial}] post button not found and no coordinate fallback for model "${model}"`)
      }
      const { width, height } = await getScreenSize(serial)
      finalTap = { x: width * quirk.shareButtonRatio.x, y: height * quirk.shareButtonRatio.y }
    }

    if (options.dryRun) {
      console.log(`[facebookAutoPost] [${serial}] dry run: ready to post, stopping before tap`)
      return
    }

    await tap(serial, finalTap.x, finalTap.y)

    await sleep(1500)
    await assertForegroundPackage(serial, FACEBOOK_PACKAGE, 'posted')
  } catch (error) {
    console.error(`[facebookAutoPost] [${serial}] aborting:`, error)
    throw error
  } finally {
    await restoreIme(serial, previousIme).catch((error) =>
      console.warn(`[facebookAutoPost] [${serial}] failed to restore IME:`, error)
    )
  }
}
