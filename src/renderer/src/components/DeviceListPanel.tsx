import type { DeviceInfo } from '../../../shared/deviceTypes'
import { useDeviceStore } from '../store/deviceStore'

function statusLabel(status: DeviceInfo['status']): string {
  switch (status) {
    case 'device':
      return '연결됨'
    case 'offline':
      return '오프라인'
    case 'unauthorized':
      return '승인 대기'
    case 'connecting':
      return '연결 중'
  }
}

export function DeviceListPanel(): JSX.Element {
  const devices = useDeviceStore((s) => s.devices)
  const selectedSerial = useDeviceStore((s) => s.selectedSerial)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  return (
    <div className="panel device-list">
      <h4>기기 ({devices.length})</h4>
      {devices.length === 0 && <p style={{ color: '#888', fontSize: 12 }}>연결된 기기가 없습니다.</p>}
      {devices.map((device) => (
        <div
          key={device.serial}
          className={`device-item${device.serial === selectedSerial ? ' selected' : ''}`}
          onClick={() => selectDevice(device.serial)}
        >
          <span className={`status-dot status-${device.status}`} />
          {device.model ?? device.serial}
          <div style={{ fontSize: 11, color: '#999' }}>
            {device.serial} · {statusLabel(device.status)}
          </div>
        </div>
      ))}
    </div>
  )
}
