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
  const transfer = await adbClient.getDevice(serial).push(LOCAL_JAR_PATH, DEVICE_JAR_PATH)
  await new Promise<void>((resolve, reject) => {
    transfer.on('end', resolve)
    transfer.on('error', reject)
  })
}

/**
 * Ensures the (vendored, ws-scrcpy patched) scrcpy-server is running on the device
 * in "web" mode, listening on DEVICE_SERVER_PORT. Idempotent: if already running, returns immediately.
 */
export async function ensureScrcpyServerRunning(serial: string): Promise<void> {
  const existingPid = await getServerPid(serial)
  if (existingPid) return

  await pushServerJar(serial)

  const command = buildRunCommand()
  adbClient
    .getDevice(serial)
    .shell(command)
    .catch((error: Error) => console.error(`[${serial}] scrcpy-server exec failed:`, error))

  for (let attempt = 0; attempt < MAX_PID_WAIT_ATTEMPTS; attempt++) {
    await sleep(PID_WAIT_INTERVAL_MS)
    const pid = await getServerPid(serial)
    if (pid) return
  }
  throw new Error(`[${serial}] scrcpy-server did not start in time`)
}
