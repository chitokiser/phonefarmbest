import { useEffect, useRef, useState } from 'react'
import type { DeviceInfo } from '../../../../shared/deviceTypes'
import { StreamClient } from '../../stream/StreamClient'
import { WebCodecsCanvasPlayer } from '../../stream/WebCodecsCanvasPlayer'
import { buildTouchEventMessage, buildKeycodeMessage, TouchAction, KeyAction } from '../../../../shared/scrcpy/controlMessage'
import { CODE_TO_ANDROID_KEYCODE, metaStateFor } from '../../stream/androidKeycodes'

interface DeviceTileProps {
  device: DeviceInfo
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}

export function DeviceTile({ device, selected, onClick, onDoubleClick }: DeviceTileProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [unicodeInput, setUnicodeInput] = useState('')
  const [sendingUnicode, setSendingUnicode] = useState(false)
  const [facebookPostStatus, setFacebookPostStatus] = useState<'idle' | 'posting' | 'no-new-post'>('idle')
  const [kakaoReplyStatus, setKakaoReplyStatus] = useState<'idle' | 'replying' | 'sent' | 'failed'>('idle')

  useEffect(() => {
    if (device.status !== 'device') return undefined
    if (!WebCodecsCanvasPlayer.isSupported()) {
      console.warn(`[DeviceTile] ${device.serial}: WebCodecs VideoDecoder not supported in this renderer`)
      return undefined
    }
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let videoFrameCount = 0
    const resolution = { width: 0, height: 0 }
    const player = new WebCodecsCanvasPlayer(canvas)
    player.setOnResize((width, height) => {
      resolution.width = width
      resolution.height = height
    })
    const client = new StreamClient(device.serial)
    client.on('video', (data) => {
      videoFrameCount++
      if (videoFrameCount <= 3) console.log(`[DeviceTile] ${device.serial}: video chunk #${videoFrameCount}, ${data.byteLength} bytes`)
      player.decode(data)
    })
    client.connect()

    // Maps pointer events on the canvas to touch-event control messages so the
    // rendered stream can be tapped/dragged (e.g. to unlock the device), scaled
    // from the canvas's on-screen CSS size to the video's actual pixel resolution.
    const toVideoCoords = (event: PointerEvent): { x: number; y: number } | null => {
      if (!resolution.width || !resolution.height) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const x = ((event.clientX - rect.left) / rect.width) * resolution.width
      const y = ((event.clientY - rect.top) / rect.height) * resolution.height
      return {
        x: Math.min(Math.max(x, 0), resolution.width - 1),
        y: Math.min(Math.max(y, 0), resolution.height - 1)
      }
    }

    const sendTouch = (action: TouchAction, event: PointerEvent, pressure: number): void => {
      const point = toVideoCoords(event)
      if (!point) return
      client.sendControlMessage(
        buildTouchEventMessage(action, point.x, point.y, resolution.width, resolution.height, pressure)
      )
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      canvas.setPointerCapture(event.pointerId)
      sendTouch(TouchAction.Down, event, 1)
    }
    const handlePointerMove = (event: PointerEvent): void => {
      if (!(event.buttons & 1)) return
      sendTouch(TouchAction.Move, event, 1)
    }
    const handlePointerUp = (event: PointerEvent): void => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      sendTouch(TouchAction.Up, event, 0)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerUp)

    // PC keyboard passthrough: only fires while this tile's canvas has DOM focus (click
    // the tile first), mapped by physical key (KeyboardEvent.code) so it matches
    // whatever's printed on the keycap regardless of layout-shifted characters. Only
    // covers ASCII/KeyEvent-representable input - same platform limitation as scrcpy's
    // own keyboard passthrough, Korean/CJK needs the ADB Keyboard IME path instead.
    const handleKeyDown = (event: KeyboardEvent): void => {
      const keycode = CODE_TO_ANDROID_KEYCODE[event.code]
      if (keycode === undefined) return
      event.preventDefault()
      if (event.repeat) return
      client.sendControlMessage(buildKeycodeMessage(KeyAction.Down, keycode, 0, metaStateFor(event)))
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      const keycode = CODE_TO_ANDROID_KEYCODE[event.code]
      if (keycode === undefined) return
      event.preventDefault()
      client.sendControlMessage(buildKeycodeMessage(KeyAction.Up, keycode, 0, metaStateFor(event)))
    }
    canvas.addEventListener('keydown', handleKeyDown)
    canvas.addEventListener('keyup', handleKeyUp)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerUp)
      canvas.removeEventListener('keydown', handleKeyDown)
      canvas.removeEventListener('keyup', handleKeyUp)
      client.disconnect()
      player.stop()
    }
  }, [device.serial, device.status])

  // Korean/CJK can't go through the keycode passthrough above (KeyEvent synthesis can't
  // represent it), so this field routes through the main process's ADB Keyboard IME
  // broadcast instead - typed with the browser's own IME composition, sent as one string
  // on Enter into whatever field is currently focused on the device.
  const sendUnicodeText = async (): Promise<void> => {
    const text = unicodeInput.trim()
    if (!text || sendingUnicode) return
    setSendingUnicode(true)
    try {
      await window.api.typeUnicodeText(device.serial, text)
      setUnicodeInput('')
    } catch (error) {
      console.error(`[DeviceTile] ${device.serial}: failed to type unicode text:`, error)
    } finally {
      setSendingUnicode(false)
    }
  }

  // Posts the newest not-yet-posted webzine article to this device's Facebook account
  // (main process picks the article and does the on-device tapping - see
  // facebookAutoPost.ts). A manual per-tile button rather than any kind of schedule, so
  // each post is a deliberate click.
  const postLatestToFacebook = async (): Promise<void> => {
    if (facebookPostStatus === 'posting') return
    setFacebookPostStatus('posting')
    try {
      const result = await window.api.postToFacebook(device.serial)
      setFacebookPostStatus(result ? 'idle' : 'no-new-post')
    } catch (error) {
      console.error(`[DeviceTile] ${device.serial}: failed to post to Facebook:`, error)
      setFacebookPostStatus('idle')
    }
  }

  // Reads the last received message in whatever KakaoTalk chat room is open on this device,
  // drafts a reply with Gemini, and sends it immediately - no review step (see
  // autoReplyToOpenKakaoChat). Requires the target chat room already open on the device.
  const sendKakaoAutoReply = async (): Promise<void> => {
    if (kakaoReplyStatus === 'replying') return
    setKakaoReplyStatus('replying')
    try {
      const { incoming, reply } = await window.api.kakaoAutoReply(device.serial)
      console.log(`[DeviceTile] ${device.serial}: kakao auto-reply sent`, { incoming, reply })
      setKakaoReplyStatus('sent')
    } catch (error) {
      console.error(`[DeviceTile] ${device.serial}: failed to send kakao auto-reply:`, error)
      setKakaoReplyStatus('failed')
    }
  }

  return (
    <div
      className={`device-tile${selected ? ' selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {device.status === 'device' ? (
        <canvas ref={canvasRef} className="device-tile-canvas" tabIndex={0} />
      ) : (
        <span>{device.model ?? device.serial}</span>
      )}
      <div className="device-tile-label">{device.model ?? device.serial}</div>
      {device.status === 'device' ? (
        <button
          type="button"
          className="device-tile-facebook-post-button"
          disabled={facebookPostStatus === 'posting'}
          onClick={(event) => {
            event.stopPropagation()
            void postLatestToFacebook()
          }}
        >
          {facebookPostStatus === 'posting'
            ? '게시 중...'
            : facebookPostStatus === 'no-new-post'
              ? '새 글 없음'
              : 'FB 자동 게시'}
        </button>
      ) : null}
      {device.status === 'device' ? (
        <button
          type="button"
          className="device-tile-kakao-reply-button"
          disabled={kakaoReplyStatus === 'replying'}
          onClick={(event) => {
            event.stopPropagation()
            void sendKakaoAutoReply()
          }}
        >
          {kakaoReplyStatus === 'replying'
            ? '답장 중...'
            : kakaoReplyStatus === 'sent'
              ? '답장 전송됨'
              : kakaoReplyStatus === 'failed'
                ? '실패 (채팅방 열림?)'
                : '카톡 자동응답'}
        </button>
      ) : null}
      {device.status === 'device' ? (
        <input
          type="text"
          className="device-tile-unicode-input"
          placeholder="한글 입력 후 Enter"
          value={unicodeInput}
          disabled={sendingUnicode}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setUnicodeInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void sendUnicodeText()
          }}
        />
      ) : null}
    </div>
  )
}
