import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FeedItem } from '../webzineFeed'
import {
  assertForegroundPackage,
  centerOf,
  currentFocus,
  ensureAdbKeyboardIme,
  findElements,
  lockPortraitRotation,
  pushFile,
  restoreIme,
  shell,
  tap,
  tapElement,
  typeText,
  waitForElements
} from './deviceControl'

const BLOGGER_PACKAGE = 'com.google.android.apps.blogger'
// Which app opens for "갤러리에서 이미지 삽입" differs by device/OS version (confirmed on two
// real devices): newer ones show Google's own Photo Picker, older ones fall back to the
// classic DocumentsUI file browser. Both are handled - see insertThumbnail.
const PHOTO_PICKER_PACKAGE = 'com.google.android.photopicker'
const DOCUMENTS_UI_PACKAGE = 'com.android.documentsui'

// Confirmed on a real device (Blogger app, mobile) - unlike Facebook, every element here has
// a proper content-desc/text, so there's no need for class-based fallbacks - except the
// title field, whose `hint="제목"` attribute is present in the dump on some devices but
// missing entirely on others (confirmed on a real device: same app version, uiautomator just
// didn't serialize it) - matched by position instead (see EDIT_TEXT_PATTERN below).
const NEW_POST_ENTRY_PATTERN = /content-desc="새 글 작성"/
const EDIT_TEXT_PATTERN = /class="android\.widget\.EditText"/
const BODY_FIELD_ENTRY_PATTERN = /content-desc="글 작성 시작…, 글 본문 편집기를 엽니다\."/
const GALLERY_INSERT_PATTERN = /content-desc="갤러리에서 이미지 삽입"/
const BODY_EDITOR_CONFIRM_PATTERN = /content-desc="업데이트"/
const PUBLISH_BUTTON_PATTERN = /content-desc="게시"/
// The system photo picker's grid is sorted newest-first (confirmed on a real device: pushing
// a file and immediately dumping the picker put it in the very first slot) - since this
// automation always pushes its own image right before opening the picker, with no other
// gallery activity expected on these devices, the first match is reliably ours.
const PICKER_ITEM_PATTERN = /content-desc="[^"]*촬영한 사진"/
const PICKER_DONE_PATTERN = /text="완료"/

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bodyTextFor(item: FeedItem): string {
  return `${item.excerpt}\n\n${item.url}`
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Downloads the item's thumbnail, pushes it to the device, and inserts it into the body
 * editor via the Blogger app's own "갤러리에서 이미지 삽입" (insert image from gallery) button,
 * which opens Android's system photo picker. Must be called with the body editor already
 * open (see postFeedItemToBlogger) - that's the only place this button appears.
 */
async function insertThumbnail(serial: string, item: FeedItem, thumbnailUrl: string): Promise<void> {
  const response = await fetch(thumbnailUrl)
  if (!response.ok) throw new Error(`[${serial}] failed to download thumbnail: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const localPath = join(tmpdir(), `blogger-${item.id}.jpg`)
  await writeFile(localPath, bytes)

  const filename = `webzine_blogger_${item.id}.jpg`
  const remotePath = `/storage/emulated/0/Pictures/${filename}`
  await pushFile(serial, localPath, remotePath)
  await shell(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${remotePath}"`)
  // The scan broadcast returning doesn't mean MediaStore has indexed the row yet.
  await sleep(500)

  await tapElement(serial, GALLERY_INSERT_PATTERN, 'insert image from gallery')
  await sleep(1000)

  const pickerFocus = await currentFocus(serial)
  console.log(`[bloggerAutoPost] [${serial}] image picker opened: mCurrentFocus=${pickerFocus}`)

  if (pickerFocus?.startsWith(`${PHOTO_PICKER_PACKAGE}/`)) {
    // Google's Photo Picker grid has no filename in its content-desc, only a capture-date
    // label, and is sorted newest-first - the item we just pushed is reliably the first one
    // (see PICKER_ITEM_PATTERN's comment). Tapping selects it; a separate confirm is needed.
    const pickerItems = await waitForElements(serial, PICKER_ITEM_PATTERN, 5, 600)
    if (pickerItems.length === 0) throw new Error(`[${serial}] pushed thumbnail not found in photo picker`)
    const newest = centerOf(pickerItems[0])
    await tap(serial, newest.x, newest.y)
    await sleep(400)
    await tapElement(serial, PICKER_DONE_PATTERN, 'photo picker done button')
  } else if (pickerFocus?.startsWith(`${DOCUMENTS_UI_PACKAGE}/`)) {
    // The older DocumentsUI file browser (confirmed on a real device: shows up instead of
    // the Photo Picker depending on OS version) puts the exact filename in each grid item's
    // content-desc - match it precisely instead of relying on grid position, and tapping it
    // navigates straight back to the caller with no separate confirm step (single-select
    // ACTION_GET_CONTENT), unlike the Photo Picker's multi-select flow above.
    const filePattern = new RegExp(`content-desc="${escapeRegExp(filename)},`)
    const fileItems = await waitForElements(serial, filePattern, 5, 600)
    if (fileItems.length === 0) throw new Error(`[${serial}] pushed thumbnail "${filename}" not found in file picker`)
    const target = centerOf(fileItems[0])
    await tap(serial, target.x, target.y)
  } else {
    throw new Error(`[${serial}] unrecognized image picker in foreground: ${pickerFocus}`)
  }

  await sleep(1000)
  await assertForegroundPackage(serial, BLOGGER_PACKAGE, 'thumbnail inserted, back in body editor')
}

export interface PostFeedItemOptions {
  /**
   * Stops right after the title/body/image are in place and the "게시" button is confirmed
   * enabled, without tapping it - lets a human verify the post on the real device before
   * anything actually goes live.
   */
  dryRun?: boolean
}

/**
 * Posts one webzine feed item to whatever Blogger blog is signed into this device's Google
 * account, as a new post with its thumbnail inserted inline (if it has one). Uses the
 * Blogger Android app rather than the mobile web site - confirmed on a real device that
 * Chrome doesn't expose the mobile site's content to uiautomator at all (the page renders
 * into a bare SurfaceView with no accessibility tree), which would have made this
 * unworkable; the native app exposes every element normally.
 */
export async function postFeedItemToBlogger(
  serial: string,
  item: FeedItem,
  options: PostFeedItemOptions = {}
): Promise<void> {
  await shell(serial, `monkey -p ${BLOGGER_PACKAGE} -c android.intent.category.LAUNCHER 1`)
  await sleep(2000)
  await assertForegroundPackage(serial, BLOGGER_PACKAGE, 'blogger launched')
  await lockPortraitRotation(serial)

  const previousIme = await ensureAdbKeyboardIme(serial)
  try {
    await tapElement(serial, NEW_POST_ENTRY_PATTERN, 'new post entry')
    await sleep(1500)
    await assertForegroundPackage(serial, BLOGGER_PACKAGE, 'composer opened')

    // First EditText in document order is the title field, the label field further down is
    // the only other one - document order matches top-to-bottom screen order (see
    // findElements' docstring), so this is the topmost of the two regardless of device.
    const editTextFields = await findElements(serial, EDIT_TEXT_PATTERN)
    if (editTextFields.length === 0) throw new Error(`[${serial}] no UI element found for "title field"`)
    const titleField = centerOf(editTextFields[0])
    await tap(serial, titleField.x, titleField.y)
    await sleep(300)
    await typeText(serial, item.title)
    await sleep(300)

    await tapElement(serial, BODY_FIELD_ENTRY_PATTERN, 'body field entry')
    await sleep(800)
    await assertForegroundPackage(serial, BLOGGER_PACKAGE, 'body editor opened')

    if (item.thumbnailUrl) {
      await insertThumbnail(serial, item, item.thumbnailUrl)
    }

    await typeText(serial, bodyTextFor(item))
    await sleep(300)

    await tapElement(serial, BODY_EDITOR_CONFIRM_PATTERN, 'body editor confirm')
    await sleep(800)
    await assertForegroundPackage(serial, BLOGGER_PACKAGE, 'body applied, back in composer')

    const publishButtons = await findElements(serial, PUBLISH_BUTTON_PATTERN)
    const enabledPublish = publishButtons.find((bounds) => bounds.enabled)
    if (!enabledPublish) {
      throw new Error(`[${serial}] publish button not enabled - title or body likely missing`)
    }

    if (options.dryRun) {
      console.log(`[bloggerAutoPost] [${serial}] dry run: publish button is enabled, stopping before tap`)
      return
    }

    const { x, y } = centerOf(enabledPublish)
    await tap(serial, x, y)
    await sleep(800)

    // A second "글을 게시하시겠습니까?" dialog can appear with its own confirm button (same
    // content-desc="게시" as the composer's) - confirmed on a real device where skipping this
    // left the post sitting unpublished behind the dialog even though the foreground
    // package/Activity never changed, so nothing about the earlier checks would have caught
    // it. Not every account/device necessarily shows this dialog, so this only acts if one
    // actually appears rather than assuming it will.
    const confirmDialogButtons = await waitForElements(serial, PUBLISH_BUTTON_PATTERN, 5, 400)
    if (confirmDialogButtons.length > 0) {
      const confirm = centerOf(confirmDialogButtons[confirmDialogButtons.length - 1])
      await tap(serial, confirm.x, confirm.y)
    }

    await sleep(1500)
    await assertForegroundPackage(serial, BLOGGER_PACKAGE, 'posted')
  } catch (error) {
    console.error(`[bloggerAutoPost] [${serial}] aborting:`, error)
    throw error
  } finally {
    await restoreIme(serial, previousIme).catch((error) =>
      console.warn(`[bloggerAutoPost] [${serial}] failed to restore IME:`, error)
    )
  }
}
