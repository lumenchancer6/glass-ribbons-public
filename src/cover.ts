export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
  mirror: boolean,
): void {
  if (sw < 2 || sh < 2 || w < 2 || h < 2) return
  const scale = Math.max(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.save()
  ctx.clearRect(0, 0, w, h)
  if (mirror) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh)
  ctx.restore()
}
