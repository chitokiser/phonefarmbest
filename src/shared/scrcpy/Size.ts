export default class Size {
  public readonly w: number
  public readonly h: number

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.w = width
    this.h = height
  }

  public equals(o: Size | null | undefined): boolean {
    if (this === o) return true
    if (!o) return false
    return this.width === o.width && this.height === o.height
  }

  public intersect(o: Size | undefined | null): Size {
    if (!o) return this
    return new Size(Math.min(this.width, o.width), Math.min(this.height, o.height))
  }
}
