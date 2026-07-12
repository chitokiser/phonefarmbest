import { useDeviceStore } from '../store/deviceStore'

export function DetailPanel(): JSX.Element {
  const devices = useDeviceStore((s) => s.devices)
  const selectedSerial = useDeviceStore((s) => s.selectedSerial)
  const device = devices.find((d) => d.serial === selectedSerial)

  return (
    <div className="panel detail-panel">
      <h4>상세정보</h4>
      {!device && <p style={{ color: '#888', fontSize: 12 }}>기기를 선택하세요.</p>}
      {device && (
        <dl style={{ fontSize: 13 }}>
          <dt>기기명</dt>
          <dd>{device.model ?? '-'}</dd>
          <dt>Android 버전</dt>
          <dd>{device.androidVersion ?? '-'}</dd>
          <dt>배터리</dt>
          <dd>{device.battery !== undefined ? `${device.battery}%` : '-'}</dd>
          <dt>CPU 사용률</dt>
          <dd>{device.cpuUsage !== undefined ? `${device.cpuUsage}%` : '-'}</dd>
          <dt>메모리 사용률</dt>
          <dd>{device.memUsagePercent !== undefined ? `${device.memUsagePercent}%` : '-'}</dd>
          <dt>시리얼</dt>
          <dd>{device.serial}</dd>
        </dl>
      )}
    </div>
  )
}
