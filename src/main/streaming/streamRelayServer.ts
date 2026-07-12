import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { STREAM_RELAY_PORT } from '../../shared/streamConfig'
import { ensureScrcpyServerRunning, wakeDevice } from './scrcpyServer'
import { ensureForward } from './adbForward'

const MAX_DEVICE_CONNECT_ATTEMPTS = 8
const DEVICE_CONNECT_RETRY_MS = 400

/**
 * Local WebSocket server the renderer's canvas tiles connect to
 * (`ws://127.0.0.1:STREAM_RELAY_PORT/?serial=<serial>`).
 *
 * For each connection: makes sure the vendored scrcpy-server is running on the
 * device and forwarded to a local TCP port, then dumbly relays bytes both ways
 * between the browser socket and a WebSocket client connected to that forwarded
 * port (the device's own on-device WebSocket server does all the protocol work).
 */
export class StreamRelayServer {
  private wss: WebSocketServer | null = null

  start(): void {
    this.wss = new WebSocketServer({ port: STREAM_RELAY_PORT })
    console.log(`[StreamRelayServer] listening on ws://127.0.0.1:${STREAM_RELAY_PORT}`)
    this.wss.on('connection', (browserSocket, request) => {
      console.log(`[StreamRelayServer] incoming connection: ${request.url}`)
      void this.handleConnection(browserSocket, request.url ?? '')
    })
    this.wss.on('error', (error) => console.error('[StreamRelayServer] server error:', error))
  }

  stop(): void {
    this.wss?.close()
    this.wss = null
  }

  private async handleConnection(browserSocket: WebSocket, requestUrl: string): Promise<void> {
    const serial = new URL(requestUrl, 'http://localhost').searchParams.get('serial')
    if (!serial) {
      browserSocket.close(4003, 'Missing "serial" query parameter')
      return
    }

    try {
      await wakeDevice(serial)
      console.log(`[StreamRelayServer] [${serial}] ensuring scrcpy-server is running...`)
      await ensureScrcpyServerRunning(serial)
      console.log(`[StreamRelayServer] [${serial}] scrcpy-server running, setting up adb forward...`)
      const port = await ensureForward(serial)
      console.log(`[StreamRelayServer] [${serial}] forwarded to local port ${port}, relaying...`)
      this.relay(serial, browserSocket, port)
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      console.error(`[StreamRelayServer] [${serial}] failed to start stream:`, message)
      browserSocket.close(4005, `Failed to start stream: ${message}`.slice(0, 120))
    }
  }

  private relay(serial: string, browserSocket: WebSocket, devicePort: number): void {
    const pending: RawData[] = []
    let deviceSocket: WebSocket | null = null
    let closedByBrowser = false

    browserSocket.on('message', (data) => {
      if (deviceSocket?.readyState === WebSocket.OPEN) {
        deviceSocket.send(data)
      } else {
        pending.push(data)
      }
    })
    browserSocket.on('close', () => {
      closedByBrowser = true
      deviceSocket?.close()
    })

    const connect = (attempt: number): void => {
      const socket = new WebSocket(`ws://127.0.0.1:${devicePort}`)
      socket.binaryType = 'nodebuffer'
      let opened = false

      socket.on('open', () => {
        opened = true
        deviceSocket = socket
        console.log(`[StreamRelayServer] [${serial}] connected to on-device server`)
        while (pending.length) socket.send(pending.shift() as RawData)
      })
      socket.on('message', (data) => {
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data)
      })
      socket.on('close', () => {
        if (opened) browserSocket.close()
      })
      socket.on('error', (error) => {
        if (closedByBrowser) return
        if (!opened && attempt < MAX_DEVICE_CONNECT_ATTEMPTS) {
          console.warn(
            `[StreamRelayServer] [${serial}] device socket not ready yet (attempt ${attempt + 1}/${MAX_DEVICE_CONNECT_ATTEMPTS}): ${error.message}`
          )
          setTimeout(() => connect(attempt + 1), DEVICE_CONNECT_RETRY_MS)
          return
        }
        console.error(`[StreamRelayServer] [${serial}] device socket error:`, error.message)
        browserSocket.close(4011, error.message)
      })
    }

    connect(0)
  }
}
