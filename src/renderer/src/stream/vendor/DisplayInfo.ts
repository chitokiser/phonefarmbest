import Size from './Size'

export class DisplayInfo {
  public static readonly DEFAULT_DISPLAY = 0
  public static readonly BUFFER_LENGTH = 24

  constructor(
    public readonly displayId: number,
    public readonly size: Size,
    public readonly rotation: number,
    public readonly layerStack: number,
    public readonly flags: number
  ) {}

  public static fromBuffer(buffer: Uint8Array): DisplayInfo {
    if (buffer.length !== DisplayInfo.BUFFER_LENGTH) {
      throw Error(`Incorrect buffer length. Expected: ${DisplayInfo.BUFFER_LENGTH}, received: ${buffer.length}`)
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const displayId = view.getInt32(0)
    const width = view.getInt32(4)
    const height = view.getInt32(8)
    const rotation = view.getInt32(12)
    const layerStack = view.getInt32(16)
    const flags = view.getInt32(20)
    return new DisplayInfo(displayId, new Size(width, height), rotation, layerStack, flags)
  }
}
