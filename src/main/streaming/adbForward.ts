import portfinder from 'portfinder'
import type { Forward } from '@devicefarmer/adbkit'
import { adbClient } from '../adbClient'
import { DEVICE_SERVER_PORT } from './constants'

const forwardedPorts = new Map<string, number>()

/**
 * Ensures a `adb forward tcp:<local> tcp:DEVICE_SERVER_PORT` exists for the device,
 * reusing a previously allocated local port if we already forwarded it.
 */
export async function ensureForward(serial: string): Promise<number> {
  const device = adbClient.getDevice(serial)
  const remote = `tcp:${DEVICE_SERVER_PORT}`
  const existing = await device.listForwards()

  // The device (and adb's forward table for it) can drop out from under us on USB
  // replug/reconnect, so a cached port is only trustworthy if adb still lists it.
  const cached = forwardedPorts.get(serial)
  if (cached && existing.some((f: Forward) => f.remote === remote && f.local === `tcp:${cached}`)) {
    return cached
  }

  const found = existing.find((f: Forward) => f.remote === remote && f.local.startsWith('tcp:'))
  if (found) {
    const port = Number(found.local.slice('tcp:'.length))
    forwardedPorts.set(serial, port)
    return port
  }

  const port = await portfinder.getPortPromise()
  console.log(`[${serial}] adb forward tcp:${port} -> ${remote}`)
  await device.forward(`tcp:${port}`, remote)
  forwardedPorts.set(serial, port)
  return port
}

export function clearForward(serial: string): void {
  forwardedPorts.delete(serial)
}
