import { EventEmitter } from 'events'
import type { Device } from '@devicefarmer/adbkit'
import type Tracker from '@devicefarmer/adbkit/dist/src/adb/tracker'
import { adbClient } from './adbClient'
import type { DeviceStatus } from '../shared/deviceTypes'

const RECONNECT_DELAY_MS = 2000

function toDeviceStatus(type: Device['type']): DeviceStatus {
  switch (type) {
    case 'device':
    case 'emulator':
      return 'device'
    case 'unauthorized':
      return 'unauthorized'
    default:
      return 'offline'
  }
}

/**
 * Wraps adbkit's trackDevices() and re-subscribes automatically if the
 * underlying adb server connection drops (e.g. `adb kill-server`, USB hub reset).
 */
export class DeviceTracker extends EventEmitter {
  private tracker: Tracker | null = null
  private stopped = false

  start(): void {
    this.stopped = false
    this.subscribe()
  }

  stop(): void {
    this.stopped = true
    this.tracker?.end()
    this.tracker = null
  }

  private subscribe(): void {
    adbClient
      .trackDevices()
      .then((tracker: Tracker) => {
        this.tracker = tracker
        tracker.on('add', (device: Device) => {
          this.emit('add', device.id, toDeviceStatus(device.type))
        })
        tracker.on('remove', (device: Device) => {
          this.emit('remove', device.id)
        })
        tracker.on('change', (device: Device) => {
          this.emit('statusChange', device.id, toDeviceStatus(device.type))
        })
        tracker.on('end', () => this.scheduleReconnect())
        tracker.on('error', () => this.scheduleReconnect())
      })
      .catch(() => this.scheduleReconnect())
  }

  private scheduleReconnect(): void {
    this.tracker = null
    if (this.stopped) return
    setTimeout(() => {
      if (!this.stopped) this.subscribe()
    }, RECONNECT_DELAY_MS)
  }
}
