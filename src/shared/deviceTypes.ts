export type DeviceStatus = 'device' | 'offline' | 'unauthorized' | 'connecting'

export interface DeviceInfo {
  serial: string
  status: DeviceStatus
  model?: string
  androidVersion?: string
  battery?: number
  cpuUsage?: number
  memUsagePercent?: number
}

export const IPC_CHANNELS = {
  DEVICE_LIST_CHANGED: 'device:list-changed'
} as const
