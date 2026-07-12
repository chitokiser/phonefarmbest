import VideoSettings from './VideoSettings'

const TYPE_CHANGE_STREAM_PARAMETERS = 101

/** The server only starts encoding once a client sends this (see CommandControlMessage in ws-scrcpy). */
export function buildSetVideoSettingsMessage(videoSettings: VideoSettings): Uint8Array {
  const settingsBytes = videoSettings.toBuffer()
  const message = new Uint8Array(1 + settingsBytes.length)
  message[0] = TYPE_CHANGE_STREAM_PARAMETERS
  message.set(settingsBytes, 1)
  return message
}
