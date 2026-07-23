import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { loadEnvFile } from './loadEnv'
import { DeviceManager } from './deviceManager'
import { StreamRelayServer } from './streaming/streamRelayServer'
import { ensureAdbKeyboardIme, typeText } from './streaming/deviceControl'
import { postFeedItemToFacebook } from './streaming/facebookAutoPost'
import { autoReplyToOpenKakaoChat } from './streaming/kakaoAutoReply'
import { getNextUnpostedItem, markPosted } from './webzineFeed'
import { IPC_CHANNELS, type DeviceInfo } from '../shared/deviceTypes'

loadEnvFile()

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

  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer console] ${message}`)
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

// Korean/CJK can't go through the scrcpy keycode passthrough (KeyEvent synthesis can't
// represent it - see resources/vendor/adb-keyboard/NOTICE.md), so this routes text typed
// into the renderer's per-tile input box through the same ADB Keyboard IME broadcast the
// KakaoTalk auto-reply flow uses, into whatever field is currently focused on the device.
ipcMain.handle(IPC_CHANNELS.TYPE_UNICODE_TEXT, async (_event, serial: string, text: string) => {
  await ensureAdbKeyboardIme(serial)
  await typeText(serial, text)
})

// Posts the newest webzine article this device hasn't posted yet to its signed-in Facebook
// account. Returns null (rather than throwing) when there's nothing new, so the renderer
// can tell "already up to date" apart from a real failure.
ipcMain.handle(IPC_CHANNELS.FACEBOOK_AUTO_POST, async (_event, serial: string) => {
  const item = await getNextUnpostedItem(serial)
  if (!item) return null
  await postFeedItemToFacebook(serial, item)
  await markPosted(serial, item.id)
  return { title: item.title }
})

// Reads the last received message in whatever KakaoTalk chat room is open on this device
// and sends an AI-drafted reply immediately - see autoReplyToOpenKakaoChat for why there's
// no review step.
ipcMain.handle(IPC_CHANNELS.KAKAO_AUTO_REPLY, async (_event, serial: string) => {
  return autoReplyToOpenKakaoChat(serial)
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
