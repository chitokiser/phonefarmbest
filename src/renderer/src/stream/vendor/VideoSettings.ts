import Rect from './Rect'
import Size from './Size'

export default class VideoSettings {
  constructor(
    public readonly bitrate: number,
    public readonly maxFps: number,
    public readonly iFrameInterval: number,
    public readonly bounds: Size | null,
    public readonly crop: Rect | null,
    public readonly sendFrameMeta: boolean,
    public readonly lockedVideoOrientation: number,
    public readonly displayId: number,
    public readonly bytesLength: number
  ) {}

  public static fromBuffer(buffer: Uint8Array): VideoSettings {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let offset = 0
    const bitrate = view.getInt32(offset)
    offset += 4
    const maxFps = view.getInt32(offset)
    offset += 4
    const iFrameInterval = view.getInt8(offset)
    offset += 1
    const width = view.getInt16(offset)
    offset += 2
    const height = view.getInt16(offset)
    offset += 2
    const left = view.getInt16(offset)
    offset += 2
    const top = view.getInt16(offset)
    offset += 2
    const right = view.getInt16(offset)
    offset += 2
    const bottom = view.getInt16(offset)
    offset += 2
    const sendFrameMeta = !!view.getInt8(offset)
    offset += 1
    const lockedVideoOrientation = view.getInt8(offset)
    offset += 1
    const displayId = view.getInt32(offset)
    offset += 4

    const bounds = width !== 0 && height !== 0 ? new Size(width, height) : null
    const crop = left || top || right || bottom ? new Rect(left, top, right, bottom) : null

    const codecOptionsLength = view.getInt32(offset)
    offset += 4
    if (codecOptionsLength) offset += codecOptionsLength

    const encoderNameLength = view.getInt32(offset)
    offset += 4
    if (encoderNameLength) offset += encoderNameLength

    return new VideoSettings(
      bitrate,
      maxFps,
      iFrameInterval,
      bounds,
      crop,
      sendFrameMeta,
      lockedVideoOrientation,
      displayId,
      offset
    )
  }

  /** Mirrors VideoSettings.fromBuffer's layout (BASE_BUFFER_LENGTH = 35 bytes, no codec options/encoder name). */
  public toBuffer(): Uint8Array {
    const buffer = new Uint8Array(35)
    const view = new DataView(buffer.buffer)
    const { width = 0, height = 0 } = this.bounds ?? {}
    const { left = 0, top = 0, right = 0, bottom = 0 } = this.crop ?? {}
    let offset = 0
    view.setInt32(offset, this.bitrate)
    offset += 4
    view.setInt32(offset, this.maxFps)
    offset += 4
    view.setInt8(offset, this.iFrameInterval)
    offset += 1
    view.setInt16(offset, width)
    offset += 2
    view.setInt16(offset, height)
    offset += 2
    view.setInt16(offset, left)
    offset += 2
    view.setInt16(offset, top)
    offset += 2
    view.setInt16(offset, right)
    offset += 2
    view.setInt16(offset, bottom)
    offset += 2
    view.setInt8(offset, this.sendFrameMeta ? 1 : 0)
    offset += 1
    view.setInt8(offset, this.lockedVideoOrientation)
    offset += 1
    view.setInt32(offset, this.displayId)
    offset += 4
    view.setInt32(offset, 0) // codecOptionsLength
    offset += 4
    view.setInt32(offset, 0) // encoderNameLength
    return buffer
  }
}
