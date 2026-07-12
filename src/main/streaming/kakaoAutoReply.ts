import { Adb } from '@devicefarmer/adbkit'
import { adbClient } from '../adbClient'
import { ensureAdbKeyboardIme, findElements, lockPortraitRotation, restoreIme, tap, tapElement, typeText } from './deviceControl'

const KAKAO_CHAT_ROOM_ACTIVITY = 'com.kakao.talk/com.kakao.talk.activity.chatroom.ChatRoomHolderActivity'

const MESSAGE_INPUT_PATTERN = /class="android\.widget\.MultiAutoCompleteTextView"/
// Kakao reuses the same resource-id for both the "+" attach button and the
// send/mic toggle - tapElement takes the *last* match, which is the rightmost one
// (send/mic) given the toolbar's left-to-right layout/traversal order.
const SEND_BUTTON_PATTERN = /resource-id="com\.kakao\.talk:id\/action_button"/

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function currentFocus(serial: string): Promise<string | null> {
  const stream = await adbClient.getDevice(serial).shell('dumpsys window')
  const output = (await Adb.util.readAll(stream)).toString('utf8')
  const match = output.match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)
  return match ? match[1].trim() : null
}

/**
 * Throws if the foreground activity isn't what this step expects. Screen state can
 * drift out from under a blind action sequence, so every step checks before the next
 * one acts instead of hoping the previous tap landed correctly.
 */
async function assertFocus(serial: string, expected: string, step: string): Promise<void> {
  const focus = await currentFocus(serial)
  console.log(`[kakaoAutoReply] [${serial}] ${step}: mCurrentFocus=${focus}`)
  if (focus !== expected) {
    throw new Error(`[${serial}] aborting at "${step}": expected foreground "${expected}", got "${focus}"`)
  }
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
