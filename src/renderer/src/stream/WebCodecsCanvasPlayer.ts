import H264Parser from 'h264-converter/dist/h264-parser'
import NALU from 'h264-converter/dist/util/NALU'

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase()
}

/**
 * Minimal WebCodecs-based H.264 Annex-B decoder that draws straight to a canvas.
 * Adapted from ws-scrcpy's WebCodecsPlayer, trimmed of localStorage-backed settings,
 * on-canvas quality-stat overlays, and multi-display support (not needed for the MVP).
 */
export class WebCodecsCanvasPlayer {
  public static isSupported(): boolean {
    return typeof VideoDecoder === 'function'
  }

  private readonly context: CanvasRenderingContext2D
  private decoder: VideoDecoder
  private buffer: Uint8Array | undefined
  private hadIDR = false
  private bufferedSPS = false
  private bufferedPPS = false
  private onResize?: (width: number, height: number) => void

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Failed to get 2d context from canvas')
    this.context = context
    this.decoder = this.createDecoder()
  }

  setOnResize(callback: (width: number, height: number) => void): void {
    this.onResize = callback
  }

  private createDecoder(): VideoDecoder {
    return new VideoDecoder({
      output: (frame) => {
        this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height)
        frame.close()
      },
      error: (error) => console.error('[WebCodecsCanvasPlayer]', error)
    })
  }

  private addToBuffer(data: Uint8Array): Uint8Array {
    if (!this.buffer) return data
    const merged = new Uint8Array(this.buffer.byteLength + data.byteLength)
    merged.set(this.buffer)
    merged.set(data, this.buffer.byteLength)
    return merged
  }

  decode(data: Uint8Array): void {
    if (!data || data.length < 5) return
    const type = data[4] & 31
    const isIDR = type === NALU.IDR

    if (type === NALU.SPS) {
      const sps = H264Parser.parseSPS(data.subarray(4))
      const sarScale = sps.sar[0] / sps.sar[1]
      const codec = `avc1.${[sps.profile_idc, sps.constraint_set_flags, sps.level_idc].map(toHex).join('')}`
      const width = Math.ceil(
        ((sps.pic_width_in_mbs_minus1 + 1) * 16 -
          sps.frame_crop_left_offset * 2 -
          sps.frame_crop_right_offset * 2) *
          sarScale
      )
      const height =
        (2 - sps.frame_mbs_only_flag) * (sps.pic_height_in_map_units_minus1 + 1) * 16 -
        (sps.frame_mbs_only_flag ? 2 : 4) * (sps.frame_crop_top_offset + sps.frame_crop_bottom_offset)

      this.canvas.width = width
      this.canvas.height = height
      this.onResize?.(width, height)
      this.decoder.configure({ codec, optimizeForLatency: true })
      this.bufferedSPS = true
      this.buffer = this.addToBuffer(data)
      this.hadIDR = false
      return
    }

    if (type === NALU.PPS) {
      this.bufferedPPS = true
      this.buffer = this.addToBuffer(data)
      return
    }

    if (type === NALU.SEI && (!this.bufferedSPS || !this.bufferedPPS)) {
      return
    }

    const merged = this.addToBuffer(data)
    this.buffer = merged
    this.hadIDR = this.hadIDR || isIDR
    if (this.decoder.state === 'configured' && this.hadIDR) {
      this.buffer = undefined
      this.bufferedSPS = false
      this.bufferedPPS = false
      this.decoder.decode(
        new EncodedVideoChunk({
          type: 'key',
          timestamp: 0,
          data: merged
        })
      )
    }
  }

  stop(): void {
    if (this.decoder.state === 'configured') this.decoder.close()
  }
}
