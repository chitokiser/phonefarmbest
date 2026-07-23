import { generateReplyDraft } from '../ai/geminiReply'
import {
  assertFocus,
  ensureAdbKeyboardIme,
  findElements,
  lockPortraitRotation,
  restoreIme,
  shell,
  tap,
  tapElement,
  typeText
} from './deviceControl'

const KAKAO_CHAT_ROOM_ACTIVITY = 'com.kakao.talk/com.kakao.talk.activity.chatroom.ChatRoomHolderActivity'
const MESSAGE_DUMP_PATH = '/data/local/tmp/mpcc_kakao_dump.xml'

const MESSAGE_INPUT_PATTERN = /class="android\.widget\.MultiAutoCompleteTextView"/
// Kakao reuses the same resource-id for both the "+" attach button and the
// send/mic toggle - tapElement takes the *last* match, which is the rightmost one
// (send/mic) given the toolbar's left-to-right layout/traversal order.
const SEND_BUTTON_PATTERN = /resource-id="com\.kakao\.talk:id\/action_button"/

const NODE_TAG_PATTERN = /<node[^>]*>/g
const CONTENT_DESC_PATTERN = /content-desc="([^"]*)"/
const BOUNDS_PATTERN = /bounds="\[(\d+),\d+\]\[(\d+),\d+\]"/
// Sent bubbles are right-aligned with a small, fixed margin from the screen edge no matter
// how long the text is (confirmed: a one-word and a full-sentence outgoing bubble both sat
// 37px from the edge). Received bubbles are left-aligned, so their right edge only gets this
// close to the edge for a message that fills almost the entire bubble max-width - generous
// enough margin below that to not misfire.
const SENT_RIGHT_EDGE_MARGIN = 100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Reads the most recent *received* message bubble's text out of whatever chat room is on
 * screen. Message bubbles all share `resource-id="com.kakao.talk:id/message"` regardless of
 * direction, with the text in `content-desc` (not `text`) - confirmed on a real chat room
 * dump.
 *
 * Direction is told apart by how close the bubble's *right* edge sits to the screen's right
 * edge (sent bubbles are right-aligned with a fixed small margin regardless of text length;
 * received bubbles are left-aligned, so their right edge trails off by a wide margin except
 * for the rare one that fills the whole bubble max-width). Two earlier approaches were tried
 * and confirmed broken on a real device before this one: (1) a preceding `.../id/profile`
 * (sender avatar) node only renders once per consecutive run of messages from the same
 * sender, not on every bubble, so it picked the *first* message of the latest incoming group
 * instead of the true last one (missed "읽씹?", returned "야" from three messages sent back
 * to back); (2) splitting left vs right at the screen midpoint misfired on a long *sent*
 * reply, because a sent bubble's left edge moves left as the text gets longer (it's anchored
 * on the right) and crossed the midpoint. Screen width comes from the root node's own bounds
 * in the same dump rather than a hardcoded resolution, so it works regardless of
 * device/orientation.
 *
 * Non-text bubbles (photos, stickers) don't use this resource-id and are silently skipped -
 * if the true latest message is one of those, this returns an older text message instead, a
 * known limitation.
 */
async function getLastIncomingMessage(serial: string): Promise<string | null> {
  await shell(serial, `uiautomator dump ${MESSAGE_DUMP_PATH}`)
  const xml = await shell(serial, `cat ${MESSAGE_DUMP_PATH}`)
  await shell(serial, `rm ${MESSAGE_DUMP_PATH}`).catch(() => undefined)

  const screenBounds = xml.match(BOUNDS_PATTERN)
  if (!screenBounds) return null
  const screenWidth = Number(screenBounds[2])

  let lastIncoming: string | null = null

  let match: RegExpExecArray | null
  while ((match = NODE_TAG_PATTERN.exec(xml))) {
    const node = match[0]
    if (!node.includes('resource-id="com.kakao.talk:id/message"')) continue

    const bounds = node.match(BOUNDS_PATTERN)
    if (!bounds) continue
    const right = Number(bounds[2])
    if (screenWidth - right < SENT_RIGHT_EDGE_MARGIN) continue // right-anchored = sent by this account

    const contentDesc = node.match(CONTENT_DESC_PATTERN)
    if (contentDesc) lastIncoming = contentDesc[1].trim()
  }

  return lastIncoming
}

/**
 * Sends a disclosed auto-reply into whatever KakaoTalk chat room is *already open* on
 * screen. Deliberately does not try to launch KakaoTalk or navigate to a chat itself:
 * KakaoTalk remembers which tab/filter it was last showing, so a cold launch can land
 * on the friends list, an empty "unread" filter, etc. - state `dumpsys window` can't
 * distinguish (it only reports the Activity, not what's selected inside it), which
 * made a "start from home screen" flow unreliable in testing. Opening the right chat
 * is left to whatever calls this (the user, or a future notification-tap trigger).
 *
 * `replyText` should make clear to the recipient that it's automated (e.g. prefixed
 * with "[자동응답]") - this drives real taps into the user's own KakaoTalk account.
 */
export async function replyToOpenKakaoChat(serial: string, replyText: string): Promise<void> {
  await assertFocus(serial, KAKAO_CHAT_ROOM_ACTIVITY, 'precondition: chat room open')
  await lockPortraitRotation(serial)

  const previousIme = await ensureAdbKeyboardIme(serial)
  try {
    await tapElement(serial, MESSAGE_INPUT_PATTERN, 'message input field')
    await sleep(400)
    await assertFocus(serial, KAKAO_CHAT_ROOM_ACTIVITY, 'input field tapped')

    await typeText(serial, replyText)
    await sleep(500)
    await assertFocus(serial, KAKAO_CHAT_ROOM_ACTIVITY, 'text injected')

    // Re-locate the send button after typing: the toolbar row that appears above the
    // keyboard while a field is focused can shift its bounds, so bounds found before
    // typing aren't trustworthy for the tap after.
    const sendCandidates = await findElements(serial, SEND_BUTTON_PATTERN)
    if (sendCandidates.length === 0) throw new Error(`[${serial}] send button not found after typing`)
    const rightmost = sendCandidates.reduce((a, b) => (b.left > a.left ? b : a))
    await tap(serial, (rightmost.left + rightmost.right) / 2, (rightmost.top + rightmost.bottom) / 2)
    await sleep(600)
    await assertFocus(serial, KAKAO_CHAT_ROOM_ACTIVITY, 'sent')
  } catch (error) {
    console.error(`[kakaoAutoReply] [${serial}] aborting:`, error)
    throw error
  } finally {
    await restoreIme(serial, previousIme).catch((error) => console.warn(`[kakaoAutoReply] [${serial}] failed to restore IME:`, error))
  }
}

/**
 * Reads the last received message in whatever chat room is open, drafts a reply with
 * Gemini, and sends it immediately - no human review step. Same "chat must already be open"
 * precondition as replyToOpenKakaoChat, checked there.
 */
export async function autoReplyToOpenKakaoChat(serial: string): Promise<{ incoming: string; reply: string }> {
  await assertFocus(serial, KAKAO_CHAT_ROOM_ACTIVITY, 'precondition: chat room open')

  const incoming = await getLastIncomingMessage(serial)
  if (!incoming) throw new Error(`[${serial}] no incoming message found to reply to`)

  const reply = await generateReplyDraft(incoming)
  await replyToOpenKakaoChat(serial, reply)
  return { incoming, reply }
}
