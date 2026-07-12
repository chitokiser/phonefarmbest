import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DeviceInfo } from '../shared/deviceTypes'

const api = {
  onDeviceListChanged(callback: (devices: DeviceInfo[]) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, devices: DeviceInfo[]): void =>
      callback(devices)
    ipcRenderer.on(IPC_CHANNELS.DEVICE_LIST_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_LIST_CHANGED, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
