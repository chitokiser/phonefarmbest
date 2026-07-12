import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { STREAM_RELAY_PORT } from '../../shared/streamConfig'
import { ensureScrcpyServerRunning } from './scrcpyServer'
import { ensureForward } from './adbForward'

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
    this.wss.on('connection', (browserSocket, request) => {
      void this.handleConnection(browserSocket, request.url ?? '')
    })
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
      await ensureScrcpyServerRunning(serial)
      const port = await ensureForward(serial)
      this.relay(browserSocket, port)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      browserSocket.close(4005, `Failed to start stream: ${message}`)
    }
  }

  private relay(browserSocket: WebSocket, devicePort: number): void {
    const deviceSocket = new WebSocket(`ws://127.0.0.1:${devicePort}`)
    deviceSocket.binaryType = 'nodebuffer'

    const pending: RawData[] = []

    deviceSocket.on('open', () => {
      while (pending.length) browserSocket.send(pending.shift() as RawData)
    })
    deviceSocket.on('message', (data) => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data)
    })
    deviceSocket.on('close', () => browserSocket.close())
    deviceSocket.on('error', (error) => browserSocket.close(4011, error.message))

    browserSocket.on('message', (data) => {
      if (deviceSocket.readyState === WebSocket.OPEN) {
        deviceSocket.send(data)
      } else {
        pending.push(data)
      }
    })
    browserSocket.on('close', () => deviceSocket.close())
  }
}
