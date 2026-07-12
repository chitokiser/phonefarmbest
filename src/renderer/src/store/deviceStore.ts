import { create } from 'zustand'
import type { DeviceInfo } from '../../../shared/deviceTypes'

export type LayoutMode = '2x2' | '3x3' | '4x4' | '5x5' | 'auto'

interface DeviceStoreState {
  devices: DeviceInfo[]
  selectedSerial: string | null
  focusedSerial: string | null
  fullscreenSerial: string | null
  layoutMode: LayoutMode
  setDevices: (devices: DeviceInfo[]) => void
  selectDevice: (serial: string | null) => void
  focusDevice: (serial: string | null) => void
  setFullscreen: (serial: string | null) => void
  setLayoutMode: (mode: LayoutMode) => void
  exitOverlay: () => void
}

export const useDeviceStore = create<DeviceStoreState>((set) => ({
  devices: [],
  selectedSerial: null,
  focusedSerial: null,
  fullscreenSerial: null,
  layoutMode: 'auto',
  setDevices: (devices) => set({ devices }),
  selectDevice: (serial) => set({ selectedSerial: serial }),
  focusDevice: (serial) => set({ focusedSerial: serial }),
  setFullscreen: (serial) => set({ fullscreenSerial: serial }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  exitOverlay: () =>
    set((state) => ({
      fullscreenSerial: null,
      focusedSerial: state.fullscreenSerial ? state.focusedSerial : null
    }))
}))
