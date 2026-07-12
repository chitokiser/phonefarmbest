import Rect from './Rect'
import Size from './Size'

export default class ScreenInfo {
  public static readonly BUFFER_LENGTH = 25

  constructor(
    readonly contentRect: Rect,
    readonly videoSize: Size,
    readonly deviceRotation: number
  ) {}

  public static fromBuffer(buffer: Uint8Array): ScreenInfo {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const left = view.getInt32(0)
    const top = view.getInt32(4)
    const right = view.getInt32(8)
    const bottom = view.getInt32(12)
    const width = view.getInt32(16)
    const height = view.getInt32(20)
    const deviceRotation = view.getUint8(24)
    return new ScreenInfo(new Rect(left, top, right, bottom), new Size(width, height), deviceRotation)
  }
}
