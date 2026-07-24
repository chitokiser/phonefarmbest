import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FeedItem } from '../webzineFeed'
import {
  assertForegroundPackage,
  centerOf,
  ensureAdbKeyboardIme,
  findElements,
  getScreenSize,
  lockPortraitRotation,
  pushFile,
  restoreIme,
  shell,
  tap,
  tapElement,
  typeText,
  waitForElements
} from './deviceControl'

const INSTAGRAM_PACKAGE = 'com.instagram.android'

// The new-post "+" button has no content-desc, resource-id, or text at all (confirmed on a
// real device: an otherwise-empty ImageView) - unlike everything else in this flow, which
// does have a stable content-desc. Tapped by position instead, as a fraction of the current
// display size like DEVICE_QUIRKS in bloggerAutoPost.ts, so it still lands correctly if the
// device's resolution changes.
const NEW_POST_BUTTON_RATIO = { x: 0.063, y: 0.068 }
const NEXT_BUTTON_PATTERN = /content-desc="다음"/
// The gallery grid's items carry a selection-state prefix ("선택됨"/"선택 취소됨") followed by
// a capture-date label, sorted newest-first, and Instagram auto-selects the newest photo by
// default when the picker opens (confirmed on a real device). Re-tapping an already-selected
// item would deselect it, so the two states are matched separately - only tap if nothing is
// selected yet, and always take the leftmost/first match (our just-pushed image).
const GALLERY_SELECTED_PATTERN = /content-desc="선택됨[^"]*사진 썸네일 생성됨"/
const GALLERY_UNSELECTED_PATTERN = /content-desc="선택 취소됨[^"]*사진 썸네일 생성됨"/
// A one-time "게시물 공유" (post sharing) education dialog appears on an account's first-ever
// post and never again afterward (confirmed on a real device) - checked for and dismissed
// only if it actually shows up.
const SHARE_INFO_CONFIRM_PATTERN = /text="확인"/
const CAPTION_FIELD_PATTERN = /content-desc="문구 입력"/
const SHARE_BUTTON_PATTERN = /resource-id="com\.instagram\.android:id\/share_footer_button"/
// A one-time "게시물을 Facebook에도 공유해보세요" (share to Facebook too) dialog can appear after
// the very first post on an account, sitting on top of the same window - confirmed on a real
// device where it doesn't fail assertForegroundPackage (package-only check) since the package
// and even the Activity can stay the same, but the post sits uncompleted behind the dialog
// until "나중에 하기" is tapped. Same shape as bloggerAutoPost's second-confirm-dialog bug. Not
// every account necessarily shows this, so this only acts if it actually appears.
const FACEBOOK_CROSSPOST_DISMISS_PATTERN = /content-desc="나중에 하기"/
// A one-time "Instagram 평가하기" (rate this app) dialog can appear right after launch, sitting
// on top of the home feed - confirmed on a real device where it silently absorbed the
// position-based "+" tap below (landing on the dialog instead of the real button) and sent the
// rest of the flow off into an unrelated screen with no error until several steps later. Same
// shape as the other one-time dialogs in this file - only acts if it actually appears.
const RATE_APP_DISMISS_PATTERN = /resource-id="com\.instagram\.android:id\/appirater_rate_later_button"/

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function captionFor(item: FeedItem): string {
  return `${item.title}\n\n${item.excerpt}\n\n${item.url}`
}

export interface PostFeedItemOptions {
  /**
   * Stops right after the caption is typed and the "공유" button is confirmed enabled,
   * without tapping it - lets a human verify the post on the real device before anything
   * actually goes live.
   */
  dryRun?: boolean
}

/**
 * Posts one card-news webzine item to whatever Instagram account is signed into this device,
 * as a single-image feed post with a caption. Instagram has no text-only post type, so
 * `item.thumbnailUrl` is required here (unlike Facebook/Blogger, where it's optional).
 */
export async function postFeedItemToInstagram(
  serial: string,
  item: FeedItem,
  options: PostFeedItemOptions = {}
): Promise<void> {
  if (!item.thumbnailUrl) throw new Error(`[${serial}] item "${item.id}" has no thumbnail - Instagram requires one`)

  const response = await fetch(item.thumbnailUrl)
  if (!response.ok) throw new Error(`[${serial}] failed to download thumbnail: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const localPath = join(tmpdir(), `instagram-${item.id}.jpg`)
  await writeFile(localPath, bytes)
  const remotePath = `/storage/emulated/0/Pictures/webzine_instagram_${item.id}.jpg`
  await pushFile(serial, localPath, remotePath)
  await shell(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${remotePath}"`)
  // The scan broadcast returning doesn't mean MediaStore has indexed the row yet - bumped up
  // from 500ms after repeated "pushed thumbnail not found in gallery grid" failures on a
  // device with many prior pushes already in MediaStore.
  await sleep(2000)

  await shell(serial, `monkey -p ${INSTAGRAM_PACKAGE} -c android.intent.category.LAUNCHER 1`)
  await sleep(2000)
  await assertForegroundPackage(serial, INSTAGRAM_PACKAGE, 'instagram launched')
  await lockPortraitRotation(serial)

  const previousIme = await ensureAdbKeyboardIme(serial)
  try {
    const rateAppDialog = await findElements(serial, RATE_APP_DISMISS_PATTERN)
    if (rateAppDialog.length > 0) {
      const dismiss = centerOf(rateAppDialog[rateAppDialog.length - 1])
      await tap(serial, dismiss.x, dismiss.y)
      await sleep(500)
    }

    const { width, height } = await getScreenSize(serial)
    await tap(serial, width * NEW_POST_BUTTON_RATIO.x, height * NEW_POST_BUTTON_RATIO.y)
    await sleep(2500)
    await assertForegroundPackage(serial, INSTAGRAM_PACKAGE, 'new post screen opened')

    // Polled rather than a single check - on a slower device the gallery grid (and Instagram's
    // own auto-selection of the newest photo) can still be loading at this point, and a single
    // findElements() caught a moment with nothing yet rendered (confirmed on a real device: a
    // manual re-check well over 10s later found the exact same push correctly selected).
    const alreadySelected = await waitForElements(serial, GALLERY_SELECTED_PATTERN, 10, 1000)
    if (alreadySelected.length === 0) {
      const unselected = await waitForElements(serial, GALLERY_UNSELECTED_PATTERN, 10, 1000)
      if (unselected.length === 0) throw new Error(`[${serial}] pushed thumbnail not found in gallery grid`)
      const target = centerOf(unselected[0])
      await tap(serial, target.x, target.y)
      await sleep(400)
    }

    await tapElement(serial, NEXT_BUTTON_PATTERN, 'next (select step)')
    await sleep(1500)
    await tapElement(serial, NEXT_BUTTON_PATTERN, 'next (edit step)')
    await sleep(1500)
    await assertForegroundPackage(serial, INSTAGRAM_PACKAGE, 'caption screen opened')

    const shareInfoDialog = await findElements(serial, SHARE_INFO_CONFIRM_PATTERN)
    if (shareInfoDialog.length > 0) {
      const confirm = centerOf(shareInfoDialog[shareInfoDialog.length - 1])
      await tap(serial, confirm.x, confirm.y)
      await sleep(500)
    }

    await tapElement(serial, CAPTION_FIELD_PATTERN, 'caption field')
    await sleep(300)
    await typeText(serial, captionFor(item))
    await sleep(300)

    const shareButtons = await findElements(serial, SHARE_BUTTON_PATTERN)
    const enabledShare = shareButtons.find((bounds) => bounds.enabled)
    if (!enabledShare) throw new Error(`[${serial}] share button not enabled - image or caption likely missing`)

    if (options.dryRun) {
      console.log(`[instagramAutoPost] [${serial}] dry run: share button is enabled, stopping before tap`)
      return
    }

    // Confirmed on a real device: with ADB Keyboard still the active IME (set earlier for the
    // caption field and otherwise only restored in the `finally` block at the very end), taps
    // on the share button specifically failed 12/12 times in a row across several separate
    // runs - regardless of tap mechanism, wait duration, or retry count - while a tap issued
    // once the IME had been restored back to the device's normal keyboard succeeded almost
    // immediately, every time tried. Nothing else in this flow types text after this point, so
    // it's safe to restore early instead of waiting for the `finally` block.
    await restoreIme(serial, previousIme)
    await sleep(500)

    let { x: tapX, y: tapY } = centerOf(enabledShare)
    let posted = false
    const maxAttempts = 12
    for (let attempt = 0; attempt < maxAttempts && !posted; attempt++) {
      await tap(serial, tapX, tapY)
      await sleep(2500)
      const shareStillThere = await findElements(serial, SHARE_BUTTON_PATTERN)
      const stillEnabled = shareStillThere.find((bounds) => bounds.enabled)
      posted = !stillEnabled
      if (!posted && stillEnabled) {
        ;({ x: tapX, y: tapY } = centerOf(stillEnabled))
      }
    }
    if (!posted) {
      throw new Error(
        `[${serial}] still on the compose screen after ${maxAttempts} tap attempts on share - post likely did not go through`
      )
    }

    const crosspostDialog = await findElements(serial, FACEBOOK_CROSSPOST_DISMISS_PATTERN)
    if (crosspostDialog.length > 0) {
      const dismiss = centerOf(crosspostDialog[crosspostDialog.length - 1])
      await tap(serial, dismiss.x, dismiss.y)
      await sleep(1000)
    }

    await assertForegroundPackage(serial, INSTAGRAM_PACKAGE, 'posted')
  } catch (error) {
    console.error(`[instagramAutoPost] [${serial}] aborting:`, error)
    throw error
  } finally {
    await restoreIme(serial, previousIme).catch((error) =>
      console.warn(`[instagramAutoPost] [${serial}] failed to restore IME:`, error)
    )
  }
}
