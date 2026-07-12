import { useEffect } from 'react'
import { useDeviceStore } from './store/deviceStore'
import { DeviceListPanel } from './components/DeviceListPanel'
import { DetailPanel } from './components/DetailPanel'
import { GridView } from './components/GridView'

export default function App(): JSX.Element {
  const setDevices = useDeviceStore((s) => s.setDevices)

  useEffect(() => {
    return window.api.onDeviceListChanged(setDevices)
  }, [setDevices])

  return (
    <div className="app">
      <DeviceListPanel />
      <GridView />
      <DetailPanel />
      <div className="panel log-panel">
        <h4>로그</h4>
        <p style={{ color: '#888', fontSize: 12 }}>logcat 연동은 이후 단계에서 추가됩니다.</p>
      </div>
    </div>
  )
}
