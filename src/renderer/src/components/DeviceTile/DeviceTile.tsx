import { useEffect, useRef } from 'react'
import type { DeviceInfo } from '../../../../shared/deviceTypes'
import { StreamClient } from '../../stream/StreamClient'
import { WebCodecsCanvasPlayer } from '../../stream/WebCodecsCanvasPlayer'
import { buildTouchEventMessage, TouchAction } from '../../stream/vendor/controlMessage'

interface DeviceTileProps {
  device: DeviceInfo
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}

export function DeviceTile({ device, selected, onClick, onDoubleClick }: DeviceTileProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerUp)
      client.disconnect()
      player.stop()
    }
  }, [device.serial, device.status])

  return (
    <div
      className={`device-tile${selected ? ' selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {device.status === 'device' ? (
        <canvas ref={canvasRef} className="device-tile-canvas" />
      ) : (
        <span>{device.model ?? device.serial}</span>
      )}
      <div className="device-tile-label">{device.model ?? device.serial}</div>
    </div>
  )
}
