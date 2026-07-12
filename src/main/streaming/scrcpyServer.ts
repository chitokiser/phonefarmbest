import { existsSync } from 'fs'
import type { Duplex } from 'stream'
import { Adb } from '@devicefarmer/adbkit'
import { adbClient } from '../adbClient'
import { buildRunCommand, DEVICE_JAR_PATH, LOCAL_JAR_PATH, SERVER_PROCESS_NAME } from './constants'

const MAX_PID_WAIT_ATTEMPTS = 10
const PID_WAIT_INTERVAL_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function shellText(serial: string, command: string): Promise<string> {
  const stream = await adbClient.getDevice(serial).shell(command)
  const buffer = await Adb.util.readAll(stream)
  return buffer.toString('utf8').trim()
}

async function getServerPid(serial: string): Promise<number | undefined> {
  const output = await shellText(serial, `pidof ${SERVER_PROCESS_NAME}`).catch(() => '')
  const pid = output
    .split(/\s+/)
    .map((token) => Number(token))
    .find((num) => !Number.isNaN(num))
  return pid
}

async function pushServerJar(serial: string): Promise<void> {
  if (!existsSync(LOCAL_JAR_PATH)) {
    throw new Error(`Vendored scrcpy-server.jar not found at ${LOCAL_JAR_PATH}`)
  }
  console.log(`[${serial}] pushing ${LOCAL_JAR_PATH} -> ${DEVICE_JAR_PATH}`)
  const transfer = await adbClient.getDevice(serial).push(LOCAL_JAR_PATH, DEVICE_JAR_PATH)
  await new Promise<void>((resolve, reject) => {
    transfer.on('end', resolve)
    transfer.on('error', reject)
  })
  console.log(`[${serial}] push complete`)
}

/**
 * Wakes the device's screen and pins it awake for as long as it's on USB power.
 * scrcpy only ever captures whatever the display is currently showing, so a
 * dozing/locked screen streams as solid black. A bare KEYCODE_WAKEUP isn't
 * enough on its own: without disabling the idle timeout, some devices (seen on
 * a Galaxy S9) slide right back into doze within ~10s even with a 10-minute
 * screen-off timeout configured. `svc power stayon usb` is the same call
 * scrcpy's own `--stay-awake` flag makes; KEYCODE_WAKEUP just turns the screen
 * on immediately instead of waiting for the next USB (re)plug event.
 */
export async function wakeDevice(serial: string): Promise<void> {
  await shellText(serial, 'svc power stayon usb').catch((error) =>
    console.warn(`[${serial}] failed to set stay-awake:`, error)
  )
  await shellText(serial, 'input keyevent KEYCODE_WAKEUP').catch((error) =>
    console.warn(`[${serial}] failed to wake device:`, error)
  )
}

/**
 * Ensures the (vendored, ws-scrcpy patched) scrcpy-server is running on the device
 * in "web" mode, listening on DEVICE_SERVER_PORT. Idempotent: if already running, returns immediately.
 */
export async function ensureScrcpyServerRunning(serial: string): Promise<void> {
  const existingPid = await getServerPid(serial)
  if (existingPid) {
    console.log(`[${serial}] scrcpy-server already running (pid ${existingPid})`)
    return
  }

  await pushServerJar(serial)

  const command = buildRunCommand()
  console.log(`[${serial}] launching scrcpy-server: ${command}`)
  adbClient
    .getDevice(serial)
    .shell(command)
    .then((stream: Duplex) => Adb.util.readAll(stream))
    .then((output: Buffer) => console.log(`[${serial}] scrcpy-server process exited, output:`, output.toString('utf8')))
    .catch((error: Error) => console.error(`[${serial}] scrcpy-server exec failed:`, error))

  for (let attempt = 0; attempt < MAX_PID_WAIT_ATTEMPTS; attempt++) {
    await sleep(PID_WAIT_INTERVAL_MS)
    const pid = await getServerPid(serial)
    if (pid) {
      console.log(`[${serial}] scrcpy-server started (pid ${pid})`)
      return
    }
  }
  throw new Error(`[${serial}] scrcpy-server did not start in time`)
}
