import { stringToUtf8ByteArray, utf8ByteArrayToString } from './textCodec'

export const MAGIC_BYTES_MESSAGE = stringToUtf8ByteArray('scrcpy_message')

const TYPE_CLIPBOARD = 0

export default class DeviceMessage {
  constructor(
    public readonly type: number,
    private readonly buffer: Uint8Array
  ) {}

  public static fromBuffer(data: Uint8Array): DeviceMessage {
    const magicSize = MAGIC_BYTES_MESSAGE.length
    const buffer = data.subarray(magicSize)
    const type = buffer[0]
    return new DeviceMessage(type, buffer)
  }

  public getText(): string | undefined {
    if (this.type !== TYPE_CLIPBOARD) return undefined
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    const length = view.getInt32(1)
    return utf8ByteArrayToString(this.buffer.subarray(5, 5 + length))
  }
}
