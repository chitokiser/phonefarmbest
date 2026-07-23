/**
 * Maps a physical key (KeyboardEvent.code, not the layout-shifted .key) to its Android
 * AKEYCODE_* constant, so a PC keyboard can drive a device tile the same way scrcpy's
 * own desktop client does. Only covers standard QWERTY text-entry keys - anything else
 * is left unhandled and passes through to the browser as normal.
 */
export const CODE_TO_ANDROID_KEYCODE: Record<string, number> = {
  KeyA: 29,
  KeyB: 30,
  KeyC: 31,
  KeyD: 32,
  KeyE: 33,
  KeyF: 34,
  KeyG: 35,
  KeyH: 36,
  KeyI: 37,
  KeyJ: 38,
  KeyK: 39,
  KeyL: 40,
  KeyM: 41,
  KeyN: 42,
  KeyO: 43,
  KeyP: 44,
  KeyQ: 45,
  KeyR: 46,
  KeyS: 47,
  KeyT: 48,
  KeyU: 49,
  KeyV: 50,
  KeyW: 51,
  KeyX: 52,
  KeyY: 53,
  KeyZ: 54,
  Digit0: 7,
  Digit1: 8,
  Digit2: 9,
  Digit3: 10,
  Digit4: 11,
  Digit5: 12,
  Digit6: 13,
  Digit7: 14,
  Digit8: 15,
  Digit9: 16,
  Space: 62,
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowLeft: 21,
  ArrowRight: 22,
  ArrowUp: 19,
  ArrowDown: 20,
  ShiftLeft: 59,
  ShiftRight: 60,
  Comma: 55,
  Period: 56,
  Slash: 76,
  Semicolon: 74,
  Quote: 75,
  Backquote: 68,
  Minus: 69,
  Equal: 70,
  BracketLeft: 71,
  BracketRight: 72,
  Backslash: 73
}

const AMETA_SHIFT_ON = 0x1

export function metaStateFor(event: Pick<KeyboardEvent, 'shiftKey'>): number {
  return event.shiftKey ? AMETA_SHIFT_ON : 0
}
