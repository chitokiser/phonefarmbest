import { join } from 'path'

export const SERVER_PACKAGE = 'com.genymobile.scrcpy.Server'
export const SERVER_PROCESS_NAME = 'app_process'
export const SERVER_VERSION = '1.19-ws7'
export const SERVER_TYPE = 'web'
export const LOG_LEVEL = 'ERROR'
export const DEVICE_SERVER_PORT = 8886
const LISTEN_ON_ALL_INTERFACES = true

export const DEVICE_TEMP_PATH = '/data/local/tmp/'
export const DEVICE_JAR_NAME = 'scrcpy-server.jar'
export const DEVICE_JAR_PATH = `${DEVICE_TEMP_PATH}${DEVICE_JAR_NAME}`

export const LOCAL_JAR_PATH = join(__dirname, '../../resources/vendor/scrcpy-server/scrcpy-server.jar')

export function buildRunCommand(): string {
  const args = [SERVER_VERSION, SERVER_TYPE, LOG_LEVEL, DEVICE_SERVER_PORT, LISTEN_ON_ALL_INTERFACES]
  const argsString = `/ ${SERVER_PACKAGE} ${args.join(' ')} 2>&1 > /dev/null`
  return `CLASSPATH=${DEVICE_JAR_PATH} nohup ${SERVER_PROCESS_NAME} ${argsString}`
}
