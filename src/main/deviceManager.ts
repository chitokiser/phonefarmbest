import { EventEmitter } from 'events'
import { DeviceTracker } from './deviceTracker'
import { fetchStaticInfo, fetchDynamicInfo } from './deviceInfoService'
import type { DeviceInfo, DeviceStatus } from '../shared/deviceTypes'

const POLL_INTERVAL_MS = 3000

/**
 * Owns the live device list: merges ADB connection state (DeviceTracker) with
 * polled model/battery/cpu/mem info, and emits a full snapshot on every change.
 */
export class DeviceManager extends EventEmitter {
  private readonly devices = new Map<string, DeviceInfo>()
  private readonly tracker = new DeviceTracker()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  start(): void {
    this.tracker.on('add', (serial: string, status: DeviceStatus) => this.handleAdd(serial, status))
    this.tracker.on('remove', (serial: string) => this.handleRemove(serial))
    this.tracker.on('statusChange', (serial: string, status: DeviceStatus) =>
      this.handleStatusChange(serial, status)
    )
    this.tracker.start()
    this.pollTimer = setInterval(() => this.pollDynamicInfo(), POLL_INTERVAL_MS)
  }

  stop(): void {
    this.tracker.stop()
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private handleAdd(serial: string, status: DeviceStatus): void {
    this.devices.set(serial, { serial, status })
    this.emitUpdate()
    if (status === 'device') void this.loadStaticInfo(serial)
  }

  private handleRemove(serial: string): void {
    this.devices.delete(serial)
    this.emitUpdate()
  }

  private handleStatusChange(serial: string, status: DeviceStatus): void {
    const existing = this.devices.get(serial)
    this.devices.set(serial, { ...existing, serial, status })
    this.emitUpdate()
    if (status === 'device' && !existing?.model) void this.loadStaticInfo(serial)
  }

  private async loadStaticInfo(serial: string): Promise<void> {
    try {
      const info = await fetchStaticInfo(serial)
      const existing = this.devices.get(serial)
      if (!existing) return
      this.devices.set(serial, { ...existing, ...info })
      this.emitUpdate()
    } catch {
      // Device likely disconnected mid-fetch; next tracker event will reconcile state.
    }
  }

  private pollDynamicInfo(): void {
    for (const device of this.devices.values()) {
      if (device.status !== 'device') continue
      void this.refreshDynamicInfo(device.serial)
    }
  }

  private async refreshDynamicInfo(serial: string): Promise<void> {
    try {
      const info = await fetchDynamicInfo(serial)
      const existing = this.devices.get(serial)
      if (!existing) return
      this.devices.set(serial, { ...existing, ...info })
      this.emitUpdate()
    } catch {
      // Transient shell failure; will retry on next poll tick.
    }
  }

  private emitUpdate(): void {
    this.emit('updated', Array.from(this.devices.values()))
  }
}
