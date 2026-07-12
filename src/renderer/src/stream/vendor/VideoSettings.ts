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
}
