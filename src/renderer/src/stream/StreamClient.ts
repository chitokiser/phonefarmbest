import { DisplayInfo } from './vendor/DisplayInfo'
import ScreenInfo from './vendor/ScreenInfo'
import VideoSettings from './vendor/VideoSettings'
import DeviceMessage, { MAGIC_BYTES_MESSAGE } from './vendor/DeviceMessage'
import { MiniEmitter } from './vendor/MiniEmitter'
import { stringToUtf8ByteArray, utf8ByteArrayToString, filterTrailingZeroes } from './vendor/textCodec'
import { STREAM_RELAY_PORT } from '../../../shared/streamConfig'

const DEVICE_NAME_FIELD_LENGTH = 64
const MAGIC_BYTES_INITIAL = stringToUtf8ByteArray('scrcpy_initial')

export interface DeviceStreamInfo {
  deviceName: string
  displayInfo?: DisplayInfo
  screenInfo?: ScreenInfo
  videoSettings?: VideoSettings
}

interface StreamClientEvents {
  video: Uint8Array
  deviceInfo: DeviceStreamInfo
  connected: void
  disconnected: void
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Connects to MPCC's local stream relay (src/main/streaming/streamRelayServer.ts) for one
 * device and parses the handshake the vendored scrcpy-server emits, then surfaces raw
 * H.264 NAL chunks via the 'video' event.
 */
export class StreamClient extends MiniEmitter<StreamClientEvents> {
  private ws: WebSocket | null = null
  private deviceInfo: DeviceStreamInfo | null = null

  constructor(private readonly serial: string) {
    super()
  }

  connect(): void {
    const ws = new WebSocket(`ws://127.0.0.1:${STREAM_RELAY_PORT}/?serial=${encodeURIComponent(this.serial)}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => this.emit('connected', undefined)
    ws.onclose = () => this.emit('disconnected', undefined)
    ws.onmessage = (event) => this.handleMessage(event.data as ArrayBuffer)
    this.ws = ws
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  getDeviceInfo(): DeviceStreamInfo | null {
    return this.deviceInfo
  }

  private handleMessage(data: ArrayBuffer): void {
    if (data.byteLength <= MAGIC_BYTES_INITIAL.length) return
    const magic = new Uint8Array(data, 0, MAGIC_BYTES_INITIAL.length)
    if (equalBytes(magic, MAGIC_BYTES_INITIAL)) {
      this.handleInitialInfo(data)
      return
    }
    if (equalBytes(magic, MAGIC_BYTES_MESSAGE)) {
      DeviceMessage.fromBuffer(new Uint8Array(data))
      return
    }
    this.emit('video', new Uint8Array(data))
  }

  private handleInitialInfo(data: ArrayBuffer): void {
    let offset = MAGIC_BYTES_INITIAL.length
    const nameBytes = filterTrailingZeroes(new Uint8Array(data, offset, DEVICE_NAME_FIELD_LENGTH))
    const deviceName = utf8ByteArrayToString(nameBytes)
    offset += DEVICE_NAME_FIELD_LENGTH

    const view = new DataView(data)
    const displaysCount = view.getInt32(offset)
    offset += 4

    let displayInfo: DisplayInfo | undefined
    let screenInfo: ScreenInfo | undefined
    let videoSettings: VideoSettings | undefined

    for (let i = 0; i < displaysCount; i++) {
      const displayInfoBuffer = new Uint8Array(data, offset, DisplayInfo.BUFFER_LENGTH)
      const parsedDisplayInfo = DisplayInfo.fromBuffer(displayInfoBuffer)
      offset += DisplayInfo.BUFFER_LENGTH

      offset += 4 // connectionCount, unused

      const screenInfoBytesCount = view.getInt32(offset)
      offset += 4
      let parsedScreenInfo: ScreenInfo | undefined
      if (screenInfoBytesCount) {
        parsedScreenInfo = ScreenInfo.fromBuffer(new Uint8Array(data, offset, screenInfoBytesCount))
        offset += screenInfoBytesCount
      }

      const videoSettingsBytesCount = view.getInt32(offset)
      offset += 4
      let parsedVideoSettings: VideoSettings | undefined
      if (videoSettingsBytesCount) {
        parsedVideoSettings = VideoSettings.fromBuffer(new Uint8Array(data, offset, videoSettingsBytesCount))
        offset += videoSettingsBytesCount
      }

      if (i === 0) {
        displayInfo = parsedDisplayInfo
        screenInfo = parsedScreenInfo
        videoSettings = parsedVideoSettings
      }
    }

    const encodersCount = view.getInt32(offset)
    offset += 4
    for (let i = 0; i < encodersCount; i++) {
      const nameLength = view.getInt32(offset)
      offset += 4 + nameLength
    }

    this.deviceInfo = { deviceName, displayInfo, screenInfo, videoSettings }
    this.emit('deviceInfo', this.deviceInfo)
  }
}
