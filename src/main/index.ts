import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { DeviceManager } from './deviceManager'
import { StreamRelayServer } from './streaming/streamRelayServer'
import { IPC_CHANNELS, type DeviceInfo } from '../shared/deviceTypes'

let mainWindow: BrowserWindow | null = null
const deviceManager = new DeviceManager()
const streamRelayServer = new StreamRelayServer()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

deviceManager.on('updated', (devices: DeviceInfo[]) => {
  mainWindow?.webContents.send(IPC_CHANNELS.DEVICE_LIST_CHANGED, devices)
})

app.whenReady().then(() => {
  createWindow()
  deviceManager.start()
  streamRelayServer.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  deviceManager.stop()
  streamRelayServer.stop()
  if (process.platform !== 'darwin') app.quit()
})
