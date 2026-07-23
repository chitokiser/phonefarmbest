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
  DEVICE_LIST_CHANGED: 'device:list-changed',
  TYPE_UNICODE_TEXT: 'device:type-unicode-text',
  FACEBOOK_AUTO_POST: 'device:facebook-auto-post',
  BLOGGER_AUTO_POST: 'device:blogger-auto-post',
  KAKAO_AUTO_REPLY: 'device:kakao-auto-reply'
} as const
