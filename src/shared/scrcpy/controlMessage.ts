import VideoSettings from './VideoSettings'

const TYPE_INJECT_TEXT = 1
const TYPE_INJECT_TOUCH_EVENT = 2
const TYPE_CHANGE_STREAM_PARAMETERS = 101

const AMOTION_EVENT_BUTTON_PRIMARY = 1

export const enum TouchAction {
  Down = 0,
  Up = 1,
  Move = 2
}

/** The server only starts encoding once a client sends this (see CommandControlMessage in ws-scrcpy). */
export function buildSetVideoSettingsMessage(videoSettings: VideoSettings): Uint8Array {
  const settingsBytes = videoSettings.toBuffer()
  const message = new Uint8Array(1 + settingsBytes.length)
  message[0] = TYPE_CHANGE_STREAM_PARAMETERS
  message.set(settingsBytes, 1)
  return message
}

/**
 * Mirrors scrcpy's ControlMessageReader#parseTouchEvent (28-byte fixed layout: type,
 * action, pointerId as int64, position as int32 x/int32 y/uint16 screenW/uint16 screenH,
 * uint16 fixed-point pressure, int32 buttons). screenWidth/screenHeight must match the
 * video resolution the coordinates were computed against — the server scales x/y against
 * it, not against the device's real screen size.
 */
export function buildTouchEventMessage(
  action: TouchAction,
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pressure: number,
  pointerId = 0n
): Uint8Array {
  const buffer = new Uint8Array(28)
  const view = new DataView(buffer.buffer)
  let offset = 0
  view.setUint8(offset, TYPE_INJECT_TOUCH_EVENT)
  offset += 1
  view.setUint8(offset, action)
  offset += 1
  view.setBigUint64(offset, pointerId)
  offset += 8
  view.setInt32(offset, Math.round(x))
  offset += 4
  view.setInt32(offset, Math.round(y))
  offset += 4
  view.setUint16(offset, screenWidth)
  offset += 2
  view.setUint16(offset, screenHeight)
  offset += 2
  view.setUint16(offset, Math.round(pressure * 0xffff))
  offset += 2
  view.setInt32(offset, action === TouchAction.Up ? 0 : AMOTION_EVENT_BUTTON_PRIMARY)
  return buffer
}

/** Mirrors scrcpy's ControlMessageReader#parseInjectTextEvent (type, uint16 BE byte length, utf8 bytes). */
export function buildInjectTextMessage(text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text)
  const buffer = new Uint8Array(3 + textBytes.length)
  const view = new DataView(buffer.buffer)
  buffer[0] = TYPE_INJECT_TEXT
  view.setUint16(1, textBytes.length)
  buffer.set(textBytes, 3)
  return buffer
}
