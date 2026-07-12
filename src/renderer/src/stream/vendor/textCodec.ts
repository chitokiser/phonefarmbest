const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function stringToUtf8ByteArray(text: string): Uint8Array {
  return encoder.encode(text)
}

export function utf8ByteArrayToString(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function filterTrailingZeroes(bytes: Uint8Array): Uint8Array {
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  return bytes.subarray(0, end)
}
