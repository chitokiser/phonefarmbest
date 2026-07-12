import { Adb } from '@devicefarmer/adbkit'
import { adbClient } from './adbClient'

export interface StaticDeviceInfo {
  model?: string
  androidVersion?: string
}

export interface DynamicDeviceInfo {
  battery?: number
  cpuUsage?: number
  memUsagePercent?: number
}

async function shellText(serial: string, command: string): Promise<string> {
  const stream = await adbClient.getDevice(serial).shell(command)
  const buffer = await Adb.util.readAll(stream)
  return buffer.toString('utf8')
}

export async function fetchStaticInfo(serial: string): Promise<StaticDeviceInfo> {
  const props = await adbClient.getDevice(serial).getProperties()
  return {
    model: props['ro.product.model'],
    androidVersion: props['ro.build.version.release']
  }
}

export async function fetchDynamicInfo(serial: string): Promise<DynamicDeviceInfo> {
  const [battery, cpuUsage, memUsagePercent] = await Promise.all([
    fetchBattery(serial),
    fetchCpuUsage(serial),
    fetchMemUsage(serial)
  ])
  return { battery, cpuUsage, memUsagePercent }
}

async function fetchBattery(serial: string): Promise<number | undefined> {
  const text = await shellText(serial, 'dumpsys battery')
  const match = /level:\s*(\d+)/.exec(text)
  return match ? Number(match[1]) : undefined
}

async function fetchCpuUsage(serial: string): Promise<number | undefined> {
  const text = await shellText(serial, 'dumpsys cpuinfo | head -n 1')
  const match = /(\d+(?:\.\d+)?)%\s*TOTAL/.exec(text)
  return match ? Number(match[1]) : undefined
}

async function fetchMemUsage(serial: string): Promise<number | undefined> {
  const text = await shellText(serial, 'cat /proc/meminfo')
  const total = /MemTotal:\s*(\d+)/.exec(text)
  const available = /MemAvailable:\s*(\d+)/.exec(text)
  if (!total || !available) return undefined
  const totalKb = Number(total[1])
  const availableKb = Number(available[1])
  if (totalKb <= 0) return undefined
  return Math.round(((totalKb - availableKb) / totalKb) * 100)
}
