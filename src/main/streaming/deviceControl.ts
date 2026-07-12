import { join } from 'path'
import { Adb } from '@devicefarmer/adbkit'
import { adbClient } from '../adbClient'

const ADB_KEYBOARD_PACKAGE = 'com.android.adbkeyboard'
const ADB_KEYBOARD_IME = `${ADB_KEYBOARD_PACKAGE}/.AdbIME`
const LOCAL_ADB_KEYBOARD_APK = join(__dirname, '../../resources/vendor/adb-keyboard/ADBKeyboard.apk')
const DEVICE_UI_DUMP_PATH = '/data/local/tmp/mpcc_ui_dump.xml'

async function shell(serial: string, command: string): Promise<string> {
  const stream = await adbClient.getDevice(serial).shell(command)
  const buffer = await Adb.util.readAll(stream)
  return buffer.toString('utf8')
}

/**
 * Real device-pixel tap via `adb shell input tap`. Deliberately not going through
 * scrcpy's touch-injection protocol: this class is for headless automation (no
 * DeviceTile mounted to show a video frame), and empirically, scrcpy's touch
 * coordinates only land correctly when expressed relative to the *negotiated video
 * resolution* (see DeviceTile's use of the same protocol) - getting that resolution
 * requires parsing the H.264 SPS, opening a control connection, etc. Native
 * `adb shell input tap` operates directly in real screen coordinates and needs none
 * of that, and was confirmed reliable in testing where the scrcpy-relative approach
 * was fragile and hard to verify.
 */
export async function tap(serial: string, x: number, y: number): Promise<void> {
  await shell(serial, `input tap ${Math.round(x)} ${Math.round(y)}`)
}

export interface ElementBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function centerOf(bounds: ElementBounds): { x: number; y: number } {
  return { x: Math.round((bounds.left + bounds.right) / 2), y: Math.round((bounds.top + bounds.bottom) / 2) }
}

/**
 * Dumps the current screen's accessibility tree (`uiautomator dump`) and returns the
 * bounds of every node whose raw XML attributes match `pattern`. Locating UI elements
 * this way (vs. pre-calibrated coordinate ratios from a screenshot) is what makes taps
 * survive layout differences between a cold app launch and a warm one, keyboard
 * open/closed, etc. - confirmed necessary in testing, where hardcoded ratios broke as
 * soon as the target screen's layout shifted even slightly.
 */
export async function findElements(serial: string, pattern: RegExp): Promise<ElementBounds[]> {
  await shell(serial, `uiautomator dump ${DEVICE_UI_DUMP_PATH}`)
  const xml = await shell(serial, `cat ${DEVICE_UI_DUMP_PATH}`)
  await shell(serial, `rm ${DEVICE_UI_DUMP_PATH}`).catch(() => undefined)

  const bounds: ElementBounds[] = []
  const nodeRegex = /<node[^>]*>/g
  let match: RegExpExecArray | null
  while ((match = nodeRegex.exec(xml))) {
    const node = match[0]
    if (!pattern.test(node)) continue
    const boundsMatch = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!boundsMatch) continue
    bounds.push({
      left: Number(boundsMatch[1]),
      top: Number(boundsMatch[2]),
      right: Number(boundsMatch[3]),
      bottom: Number(boundsMatch[4])
    })
  }
  return bounds
}

/** Taps the center of the last element matching `pattern` (throws if none match). */
export async function tapElement(serial: string, pattern: RegExp, description: string): Promise<void> {
  const matches = await findElements(serial, pattern)
  if (matches.length === 0) throw new Error(`[${serial}] no UI element found for "${description}"`)
  const { x, y } = centerOf(matches[matches.length - 1])
  await tap(serial, x, y)
}

/**
 * Sends Unicode text to whatever field is currently focused, via the vendored ADB
 * Keyboard IME (see resources/vendor/adb-keyboard/NOTICE.md for why this exists:
 * both scrcpy's TYPE_INJECT_TEXT and `adb shell input text` go through KeyEvent
 * synthesis, which can't represent Korean/CJK text - confirmed on a real device,
 * `input text` with Korean crashes with a NullPointerException). Call
 * `ensureAdbKeyboardIme` first so ADB Keyboard is actually the active IME.
 */
export async function typeText(serial: string, text: string): Promise<void> {
  const escaped = text.replace(/'/g, `'\\''`)
  await shell(serial, `am broadcast -a ADB_INPUT_TEXT --es msg '${escaped}'`)
}

/**
 * Installs (if missing), enables, and activates the ADB Keyboard IME, returning the
 * previously-active IME id so the caller can switch back afterward and not leave the
 * device's normal keyboard changed.
 */
export async function ensureAdbKeyboardIme(serial: string): Promise<string> {
  const device = adbClient.getDevice(serial)
  const previousIme = (await shell(serial, 'settings get secure default_input_method')).trim()

  const installed = await shell(serial, `pm list packages ${ADB_KEYBOARD_PACKAGE}`)
  if (!installed.includes(ADB_KEYBOARD_PACKAGE)) {
    const transfer = await device.push(LOCAL_ADB_KEYBOARD_APK, '/data/local/tmp/ADBKeyboard.apk')
    await new Promise<void>((resolve, reject) => {
      transfer.on('end', resolve)
      transfer.on('error', reject)
    })
    await shell(serial, 'pm install -r /data/local/tmp/ADBKeyboard.apk')
  }

  await shell(serial, `ime enable ${ADB_KEYBOARD_IME}`)
  await shell(serial, `ime set ${ADB_KEYBOARD_IME}`)
  return previousIme
}

export async function restoreIme(serial: string, imeId: string): Promise<void> {
  if (!imeId) return
  await shell(serial, `ime set ${imeId}`)
}

/**
 * scrcpy's own connection lifecycle appears to toggle the device's rotation-lock
 * setting (observed repeatedly in testing: `accelerometer_rotation` flips back to 1
 * on its own), and a mid-sequence rotation silently invalidates every coordinate a
 * tap sequence hands out. Automation should pin the device to portrait before acting.
 */
export async function lockPortraitRotation(serial: string): Promise<void> {
  await shell(serial, 'settings put system accelerometer_rotation 0')
  await shell(serial, 'settings put system user_rotation 0')
}
