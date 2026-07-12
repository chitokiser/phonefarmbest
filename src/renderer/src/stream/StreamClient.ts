import { DisplayInfo } from '../../../shared/scrcpy/DisplayInfo'
import ScreenInfo from '../../../shared/scrcpy/ScreenInfo'
import VideoSettings from '../../../shared/scrcpy/VideoSettings'
import Size from '../../../shared/scrcpy/Size'
import DeviceMessage, { MAGIC_BYTES_MESSAGE } from '../../../shared/scrcpy/DeviceMessage'
import { MiniEmitter } from '../../../shared/scrcpy/MiniEmitter'
import { buildSetVideoSettingsMessage } from '../../../shared/scrcpy/controlMessage'
import { stringToUtf8ByteArray, utf8ByteArrayToString, filterTrailingZeroes } from '../../../shared/scrcpy/textCodec'
import { STREAM_RELAY_PORT } from '../../../shared/streamConfig'

const DEVICE_NAME_FIELD_LENGTH = 64
const MAGIC_BYTES_INITIAL = stringToUtf8ByteArray('scrcpy_initial')

/**
 * The server only starts encoding once a client requests these (see
 * CommandControlMessage.createSetVideoSettingsCommand in ws-scrcpy) — sending nothing
 * leaves the connection open but silent.
 */
const DEFAULT_VIDEO_SETTINGS = new VideoSettings(
  4_000_000, // bitrate
  30, // maxFps
  5, // iFrameInterval
  new Size(720, 720), // bounds
  null, // crop
  false, // sendFrameMeta
  -1, // lockedVideoOrientation
  0, // displayId
  35
)

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
  private videoSettingsSent = false

  constructor(private readonly serial: string) {
    super()
  }

  connect(): void {
    this.videoSettingsSent = false
    const url = `ws://127.0.0.1:${STREAM_RELAY_PORT}/?serial=${encodeURIComponent(this.serial)}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      console.log(`[StreamClient] connected: ${url}`)
      this.emit('connected', undefined)
    }
    ws.onclose = (event) => {
      console.log(`[StreamClient] disconnected: code=${event.code} reason=${event.reason}`)
      this.emit('disconnected', undefined)
    }
    ws.onerror = () => console.error(`[StreamClient] websocket error for ${this.serial}`)
    ws.onmessage = (event) => this.handleMessage(event.data as ArrayBuffer)
    this.ws = ws
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  sendControlMessage(bytes: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(bytes)
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

    if (!this.videoSettingsSent && this.ws?.readyState === WebSocket.OPEN) {
      this.videoSettingsSent = true
      this.ws.send(buildSetVideoSettingsMessage(DEFAULT_VIDEO_SETTINGS))
    }
  }
}
