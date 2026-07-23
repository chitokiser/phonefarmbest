import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DeviceInfo } from '../shared/deviceTypes'

const api = {
  onDeviceListChanged(callback: (devices: DeviceInfo[]) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, devices: DeviceInfo[]): void =>
      callback(devices)
    ipcRenderer.on(IPC_CHANNELS.DEVICE_LIST_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_LIST_CHANGED, listener)
  },
  typeUnicodeText(serial: string, text: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.TYPE_UNICODE_TEXT, serial, text)
  },
  postToFacebook(serial: string): Promise<{ title: string } | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.FACEBOOK_AUTO_POST, serial)
  },
  kakaoAutoReply(serial: string): Promise<{ incoming: string; reply: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.KAKAO_AUTO_REPLY, serial)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
