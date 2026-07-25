import { join } from 'path'
import { Adb } from '@devicefarmer/adbkit'
import { adbClient } from '../adbClient'

const ADB_KEYBOARD_PACKAGE = 'com.android.adbkeyboard'
const ADB_KEYBOARD_IME = `${ADB_KEYBOARD_PACKAGE}/.AdbIME`
const LOCAL_ADB_KEYBOARD_APK = join(__dirname, '../../resources/vendor/adb-keyboard/ADBKeyboard.apk')
const DEVICE_UI_DUMP_PATH = '/data/local/tmp/mpcc_ui_dump.xml'

export async function shell(serial: string, command: string): Promise<string> {
  const stream = await adbClient.getDevice(serial).shell(command)
  const buffer = await Adb.util.readAll(stream)
  return buffer.toString('utf8')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Pushes a local file to the device and resolves once the transfer completes. */
export async function pushFile(serial: string, localPath: string, remotePath: string): Promise<void> {
  const transfer = await adbClient.getDevice(serial).push(localPath, remotePath)
  await new Promise<void>((resolve, reject) => {
    transfer.on('end', resolve)
    transfer.on('error', reject)
  })
}

export async function getDeviceModel(serial: string): Promise<string> {
  const output = await shell(serial, 'getprop ro.product.model')
  return output.trim()
}

/** Current display resolution in pixels - matches the coordinate space `input tap` and the
 *  bounds reported by `uiautomator dump` both use (the "Override size" from `wm size`, not
 *  the physical panel resolution, when the two differ). */
export async function getScreenSize(serial: string): Promise<{ width: number; height: number }> {
  const output = await shell(serial, 'wm size')
  const override = output.match(/Override size: (\d+)x(\d+)/)
  const physical = output.match(/Physical size: (\d+)x(\d+)/)
  const match = override ?? physical
  if (!match) throw new Error(`[${serial}] could not parse "wm size" output: ${output}`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

export async function currentFocus(serial: string): Promise<string | null> {
  const output = await shell(serial, 'dumpsys window')
  const match = output.match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)
  return match ? match[1].trim() : null
}

/**
 * Throws if the foreground activity isn't what this step expects. Screen state can
 * drift out from under a blind action sequence, so every step checks before the next
 * one acts instead of hoping the previous tap landed correctly.
 */
export async function assertFocus(serial: string, expected: string, step: string): Promise<void> {
  const focus = await currentFocus(serial)
  console.log(`[deviceControl] [${serial}] ${step}: mCurrentFocus=${focus}`)
  if (focus !== expected) {
    throw new Error(`[${serial}] aborting at "${step}": expected foreground "${expected}", got "${focus}"`)
  }
}

/**
 * Looser version of assertFocus that only checks *which app* is foreground, not which
 * Activity within it - some apps report a different foreground Activity class per
 * device/account for the exact same screen (confirmed on a real device: Facebook reported
 * `LoginActivity` as focused while fully logged in and showing the normal home feed on one
 * phone, but `FbMainTabActivity` for the identical screen on another - same app version on
 * both). Exact-Activity assertions are too fragile across a fleet of different devices/
 * accounts for apps that do this; checking the package survives it while still catching
 * real failures like the app crashing back to the launcher.
 */
export async function assertForegroundPackage(serial: string, packageName: string, step: string): Promise<void> {
  const focus = await currentFocus(serial)
  console.log(`[deviceControl] [${serial}] ${step}: mCurrentFocus=${focus}`)
  if (!focus?.startsWith(`${packageName}/`)) {
    throw new Error(`[${serial}] aborting at "${step}": expected foreground package "${packageName}", got "${focus}"`)
  }
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
  enabled: boolean
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
    const enabledMatch = node.match(/enabled="(true|false)"/)
    bounds.push({
      left: Number(boundsMatch[1]),
      top: Number(boundsMatch[2]),
      right: Number(boundsMatch[3]),
      bottom: Number(boundsMatch[4]),
      enabled: enabledMatch ? enabledMatch[1] === 'true' : true
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
 * Polls findElements for `pattern` instead of checking once - a cold app launch racing
 * against a transitioning screen was confirmed flaky on a real device (a single check right
 * after a fixed delay sometimes caught a still-transitioning screen and found nothing, landing
 * somewhere unexpected instead of the intended target).
 */
export async function waitForElements(
  serial: string,
  pattern: RegExp,
  attempts: number,
  intervalMs: number
): Promise<ElementBounds[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = await findElements(serial, pattern)
    if (found.length > 0) return found
    await sleep(intervalMs)
  }
  return []
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
  const previousIme = (await shell(serial, 'settings get secure default_input_method')).trim()

  const installed = await shell(serial, `pm list packages ${ADB_KEYBOARD_PACKAGE}`)
  if (!installed.includes(ADB_KEYBOARD_PACKAGE)) {
    await pushFile(serial, LOCAL_ADB_KEYBOARD_APK, '/data/local/tmp/ADBKeyboard.apk')
    await shell(serial, 'pm install -r /data/local/tmp/ADBKeyboard.apk')
  }

  await shell(serial, `ime enable ${ADB_KEYBOARD_IME}`)
  await shell(serial, `ime set ${ADB_KEYBOARD_IME}`)
  // Switching the active IME isn't instantaneous - the new IME needs a moment to actually
  // bind to the focused view's InputConnection. Broadcasting text immediately after `ime
  // set` can silently land on nothing (confirmed empirically: back-to-back calls with no
  // delay dropped the text about half the time).
  await sleep(400)
  return previousIme
}

export async function restoreIme(serial: string, imeId: string): Promise<void> {
  if (!imeId) return
  await shell(serial, `ime set ${imeId}`)
}

/**
 * `ime set` writes a persistent device setting, not something tied to the ADB connection - if
 * an automation run gets interrupted before its `finally` block runs (e.g. the device is
 * unplugged mid-run), ADB Keyboard is left as the active IME indefinitely. It has no visible
 * on-screen keyboard, so the phone becomes untypeable by hand until something switches back.
 * Called whenever a device is (re)detected, to catch exactly that case automatically - there's
 * no stored "previous IME" to restore at this point (that only ever lived in memory for the
 * duration of the run that got interrupted), so this falls back to whatever other IME the
 * device has enabled instead.
 */
export async function recoverStuckAdbKeyboardIme(serial: string): Promise<void> {
  const current = (await shell(serial, 'settings get secure default_input_method')).trim()
  if (current !== ADB_KEYBOARD_IME) return

  const enabled = (await shell(serial, 'ime list -s'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const fallback = enabled.find((ime) => !ime.startsWith(ADB_KEYBOARD_PACKAGE))
  if (!fallback) {
    console.warn(`[deviceControl] [${serial}] ADB Keyboard is stuck active with no other IME enabled to fall back to`)
    return
  }

  await shell(serial, `ime set ${fallback}`)
  console.warn(
    `[deviceControl] [${serial}] ADB Keyboard was left active (likely an interrupted automation run) - restored ${fallback}`
  )
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
