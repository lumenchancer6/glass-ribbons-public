export interface HandPose {
  palmX: number
  palmY: number
  palmLen: number
  angle: number
  open: number
  speed: number
  tips: { x: number; y: number }[]
}

const TIPS = [4, 8, 12, 16, 20]

export function poseFromLandmarks(points: ArrayLike<number>, speed = 0): HandPose | null {
  if (points.length < 42) return null
  const at = (i: number) => ({ x: points[i * 2], y: points[i * 2 + 1] })
  const wrist = at(0)
  const middle = at(9)
  const palmLen = Math.hypot(middle.x - wrist.x, middle.y - wrist.y)
  if (palmLen < 0.02) return null
  let sx = 0
  let sy = 0
  for (const i of [0, 5, 9, 13, 17]) {
    sx += points[i * 2]
    sy += points[i * 2 + 1]
  }
  let reach = 0
  const tips = TIPS.map((i) => {
    const tip = at(i)
    reach += Math.hypot(tip.x - middle.x, tip.y - middle.y)
    return tip
  })
  const avg = reach / TIPS.length
  const open = clamp((avg / palmLen - 0.55) / 1.15, 0, 1)
  const angle = Math.atan2(middle.x - wrist.x, wrist.y - middle.y)
  return {
    palmX: sx / 5,
    palmY: sy / 5,
    palmLen,
    angle,
    open,
    speed,
    tips,
  }
}

export class HandFollow {
  pose: HandPose | null = null
  private filters = Array.from({ length: 42 }, () => new OneEuro())
  private smooth = new Float32Array(42)
  private missing = 0
  private prevX = 0
  private prevY = 0
  private primed = false

  update(raw: Float32Array | null, time: number, dt: number): HandPose | null {
    if (!raw) {
      this.missing += dt
      if (this.missing > 0.45) {
        this.pose = null
        this.primed = false
        for (const f of this.filters) f.reset()
      }
      return this.pose
    }
    this.missing = 0
    for (let i = 0; i < 42; i++) this.smooth[i] = this.filters[i].filter(time, raw[i])
    const palmX = (this.smooth[0] + this.smooth[10] + this.smooth[18] + this.smooth[26] + this.smooth[34]) / 5
    const palmY = (this.smooth[1] + this.smooth[11] + this.smooth[19] + this.smooth[27] + this.smooth[35]) / 5
    let speed = 0
    if (this.primed && dt > 0) speed = Math.hypot(palmX - this.prevX, palmY - this.prevY) / dt
    this.prevX = palmX
    this.prevY = palmY
    this.primed = true
    this.pose = poseFromLandmarks(this.smooth, speed)
    return this.pose
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

class OneEuro {
  minCutoff = 1.15
  beta = 0.045
  dCutoff = 1
  private ready = false
  private xPrev = 0
  private dxPrev = 0
  private tPrev = 0

  reset(): void {
    this.ready = false
  }

  filter(t: number, x: number): number {
    if (!this.ready || !Number.isFinite(x)) {
      this.ready = true
      this.xPrev = x
      this.dxPrev = 0
      this.tPrev = t
      return x
    }
    const dt = Math.min(0.1, Math.max(1e-4, t - this.tPrev))
    const dx = (x - this.xPrev) / dt
    const ad = alpha(dt, this.dCutoff)
    const dxHat = ad * dx + (1 - ad) * this.dxPrev
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat)
    const a = alpha(dt, cutoff)
    const xHat = a * x + (1 - a) * this.xPrev
    this.xPrev = xHat
    this.dxPrev = dxHat
    this.tPrev = t
    return xHat
  }
}

function alpha(dt: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * dt
  return r / (r + 1)
}
