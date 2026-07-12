export default class Rect {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly right: number,
    readonly bottom: number
  ) {}

  public getWidth(): number {
    return this.right - this.left
  }

  public getHeight(): number {
    return this.bottom - this.top
  }
}
