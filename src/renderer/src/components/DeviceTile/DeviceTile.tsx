import { useEffect, useRef } from 'react'
import type { DeviceInfo } from '../../../../shared/deviceTypes'
import { StreamClient } from '../../stream/StreamClient'
import { WebCodecsCanvasPlayer } from '../../stream/WebCodecsCanvasPlayer'

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
    if (!WebCodecsCanvasPlayer.isSupported()) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const player = new WebCodecsCanvasPlayer(canvas)
    const client = new StreamClient(device.serial)
    client.on('video', (data) => player.decode(data))
    client.connect()

    return () => {
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
