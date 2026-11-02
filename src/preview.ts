import type { Mask } from './vision.ts'

const BONES = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
]

export function rehearsalPoints(time: number): Float32Array | null {
  // The hand is away for the last few seconds so the hanging stroke shows.
  const loop = time % 11
  if (loop > 7.3) return null
  const u = loop / 7.3
  const wristX = 0.72 - 0.28 * Math.sin(u * Math.PI)
  const wristY = 0.8 - 0.16 * Math.sin(u * Math.PI * 0.85)
  const scale = 0.2 + 0.05 * Math.sin(u * Math.PI)
  const angle = -0.45 + 0.7 * Math.sin(u * 2.1)
  // Closed, open, closed, open: enough to rehearse the spray and the coil.
  const open = 0.05 + 0.95 * (0.5 + 0.5 * Math.sin(u * Math.PI * 3 - Math.PI / 2))
  return layoutHand(wristX, wristY, scale, angle, open)
}

export function paintGarden(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#1d3a28')
  sky.addColorStop(0.45, '#2f6a3a')
  sky.addColorStop(1, '#163322')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(88, 62, 42, 0.55)'
  ctx.lineWidth = Math.max(2, w * 0.012)
  for (let i = 0; i < 7; i++) {
    const x = w * (0.08 + i * 0.14)
    ctx.beginPath()
    ctx.moveTo(x, h * 0.08)
    ctx.lineTo(x + w * 0.01, h * 0.72)
    ctx.stroke()
  }

  for (let i = 0; i < 16; i++) {
    const x = w * (0.05 + ((i * 47) % 90) / 100)
    const y = h * (0.15 + ((i * 29) % 70) / 100)
    ctx.fillStyle = i % 2 ? '#1a4d2e' : '#3e8f45'
    ctx.beginPath()
    ctx.ellipse(x, y, w * 0.09, h * 0.045, (i * 0.7) % 1.2, 0, Math.PI * 2)
    ctx.fill()
  }

  lily(ctx, w * 0.28, h * 0.42, Math.min(w, h) * 0.16, 0.2)
  lily(ctx, w * 0.62, h * 0.36, Math.min(w, h) * 0.2, -0.4)
  lily(ctx, w * 0.74, h * 0.62, Math.min(w, h) * 0.15, 0.6)
  lily(ctx, w * 0.4, h * 0.7, Math.min(w, h) * 0.13, 1.1)
  lily(ctx, w * 0.18, h * 0.68, Math.min(w, h) * 0.11, -0.8)
}

export function paintHand(ctx: CanvasRenderingContext2D, points: Float32Array, w: number, h: number, color: string): void {
  const px = (i: number) => points[i * 2] * w
  const py = (i: number) => points[i * 2 + 1] * h
  const palm = Math.hypot(px(9) - px(0), py(9) - py(0))
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(8, palm * 0.42)
  ctx.beginPath()
  ctx.moveTo(px(0), py(0))
  for (const i of [5, 9, 13, 17]) ctx.lineTo(px(i), py(i))
  ctx.closePath()
  ctx.fill()
  for (const bone of BONES) {
    ctx.beginPath()
    ctx.moveTo(px(bone[0]), py(bone[0]))
    for (let k = 1; k < bone.length; k++) ctx.lineTo(px(bone[k]), py(bone[k]))
    ctx.stroke()
  }
  ctx.restore()
}

export function maskFromHand(points: Float32Array, width = 180, height = 320): Mask {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { data: new Uint8Array(width * height), width, height }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  paintHand(ctx, points, width, height, '#fff')
  const image = ctx.getImageData(0, 0, width, height)
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = image.data[i * 4]
  return { data, width, height }
}

function lily(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3)
    ctx.fillStyle = i % 2 ? '#e85a9a' : '#ffd2e6'
    ctx.beginPath()
    ctx.ellipse(0, -s * 0.42, s * 0.2, s * 0.46, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#f0c14a'
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function layoutHand(wristX: number, wristY: number, scale: number, angle: number, open: number): Float32Array {
  const local: [number, number][] = [
    [0, 0],
    [-0.25, 0.22],
    [-0.48, 0.48],
    [-0.58, 0.78],
    [-0.52, 1.12],
    [-0.32, 0.42],
    [-0.36, 0.86],
    [-0.38, 1.18],
    [-0.4, 1.52],
    [-0.02, 0.48],
    [0.0, 0.98],
    [0.02, 1.34],
    [0.03, 1.72],
    [0.28, 0.44],
    [0.3, 0.88],
    [0.32, 1.18],
    [0.34, 1.46],
    [0.5, 0.36],
    [0.54, 0.72],
    [0.56, 0.98],
    [0.58, 1.2],
  ]
  const tips = new Set([4, 8, 12, 16, 20])
  const out = new Float32Array(42)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  for (let i = 0; i < 21; i++) {
    let x = local[i][0]
    let y = local[i][1]
    if (tips.has(i)) {
      x *= 0.45 + open * 0.7
      y *= 0.42 + open * 0.62
    }
    const rx = x * c - y * s
    const ry = x * s + y * c
    out[i * 2] = wristX + rx * scale
    out[i * 2 + 1] = wristY - ry * scale
  }
  return out
}
