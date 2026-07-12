import { useEffect } from 'react'
import { useDeviceStore, type LayoutMode } from '../store/deviceStore'
import { DeviceTile } from './DeviceTile/DeviceTile'

const LAYOUT_MODES: LayoutMode[] = ['auto', '2x2', '3x3', '4x4', '5x5']

function columnsFor(mode: LayoutMode): number | undefined {
  switch (mode) {
    case '2x2':
      return 2
    case '3x3':
      return 3
    case '4x4':
      return 4
    case '5x5':
      return 5
    case 'auto':
      return undefined
  }
}

export function GridView(): JSX.Element {
  const devices = useDeviceStore((s) => s.devices)
  const selectedSerial = useDeviceStore((s) => s.selectedSerial)
  const focusedSerial = useDeviceStore((s) => s.focusedSerial)
  const fullscreenSerial = useDeviceStore((s) => s.fullscreenSerial)
  const layoutMode = useDeviceStore((s) => s.layoutMode)
  const selectDevice = useDeviceStore((s) => s.selectDevice)
  const focusDevice = useDeviceStore((s) => s.focusDevice)
  const setFullscreen = useDeviceStore((s) => s.setFullscreen)
  const setLayoutMode = useDeviceStore((s) => s.setLayoutMode)
  const exitOverlay = useDeviceStore((s) => s.exitOverlay)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') exitOverlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exitOverlay])

  if (fullscreenSerial) {
    const device = devices.find((d) => d.serial === fullscreenSerial)
    if (device) {
      return (
        <div className="panel grid-view fullscreen-view">
          <DeviceTile
            device={device}
            selected
            onClick={() => undefined}
            onDoubleClick={() => setFullscreen(null)}
          />
        </div>
      )
    }
  }

  const columns = columnsFor(layoutMode)

  return (
    <div className="panel grid-view">
      <div className="grid-toolbar">
        {LAYOUT_MODES.map((mode) => (
          <button
            key={mode}
            className={mode === layoutMode ? 'active' : ''}
            onClick={() => setLayoutMode(mode)}
          >
            {mode === 'auto' ? '자동' : mode}
          </button>
        ))}
      </div>
      <div
        className="tile-grid"
        style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
      >
        {devices.map((device) => (
          <div
            key={device.serial}
            className={device.serial === focusedSerial ? 'tile-focused' : undefined}
          >
            <DeviceTile
              device={device}
              selected={device.serial === selectedSerial}
              onClick={() => {
                selectDevice(device.serial)
                focusDevice(device.serial === focusedSerial ? null : device.serial)
              }}
              onDoubleClick={() => setFullscreen(device.serial)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
