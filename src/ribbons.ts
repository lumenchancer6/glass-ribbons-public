import * as THREE from 'three'
import type { HandPose } from './hands.ts'
import { RIBBON_FRAG, RIBBON_VERT } from './shaders.ts'

export interface RibbonInput {
  pose: HandPose | null
  viewW: number
  viewH: number
}

// Each ribbon is a line of points released from an emitter that circles the
// hand. Once released, a point keeps part of the hand's speed and then floats
// on a slow swirling current. Strips released side by side drift together, so
// a bundle stays parallel and bends into wide loops and S shapes on its own.
interface Spec {
  bundle: number
  lane: number
  points: number
  width: number
  twist: number
  seed: number
  alpha: number
  segments: number
  // This strip's own loop around the hand: size, tilt, proportions and offset
  // relative to the shared ring, so strips form separate loops, not a cable.
  ringScale: number
  ringTilt: number
  ringAspect: number
  ringShiftX: number
  ringShiftY: number
  // Where on the release orbit this strip leaves from, relative to its bundle.
  releaseAngle: number
  releaseReach: number
  // Most strips keep clear of the hand; one per bundle may cross it, as a
  // couple of the reel's loops pass over the fingers.
  crosses: boolean
}

const BUNDLES = 2
const LANES = 4
// Gap between neighbouring strips at release, in world units.
const LANE_GAP = 0.15
const STEP = 1 / 60
const SMOOTH_PASSES = 4
// Outward speed a point leaves the palm with, in world units per second.
const THROW = 0.4
// Strips float gently upward, as the reel's do, while the hand is in frame.
const LIFT = 0.08
// A loose elastic toward a ring around the hand, per second, so loops circle the
// hand at a distance instead of cutting across it, and stay in view.
const TETHER = 0.8
// Ring radius as a multiple of the release orbit.
const RING = 1.7
// Smallest ring half-width, as a multiple of the hand scale.
const RING_MIN = 0.62
// Largest release orbit half-size, as a share of the frame.
const ORBIT_FIT = 0.3
// How strongly strips are carried around the ring, per second.
const ORBIT_SWIRL = 0.6
// Margin around the hand's outline that most strips keep clear of, as a
// multiple of the hand scale, and how hard they are pushed out, per second.
const HAND_MARGIN = 0.14
const KEEP_CLEAR = 12
// How far the loops' centre moves from the palm toward the middle of the hand.
const HAND_CENTRE = 1
// Extra depth behind the hand for strips released while it is closed.
const CLOSED_DEPTH = 0.12
// Released points start this far behind the hand so the strips pass behind it
// about as often as in front.
const DEPTH_BIAS = 0.07
// When the hand leaves, the strips settle side by side into one tall S down the
// middle of the frame, as the last stroke does at the end of the reel.
const HANG_GAP = 0.075
const HANG_HEIGHT = 0.86
const HANG_SWING = 0.23
// Most of the hand's own speed a released point can inherit.
const MAX_FLING = 1.4

const SPECS: Spec[] = []
for (let b = 0; b < BUNDLES; b++) {
  for (let lane = 0; lane < LANES; lane++) {
    const seed = 1 + b * LANES + lane
    SPECS.push({
      bundle: b,
      lane,
      points: 160 + Math.round(hash(seed + 7) * 60),
      width: 0.08 + hash(seed + 11) * 0.03,
      twist: 0.4 + hash(seed + 13) * 0.6,
      seed,
      alpha: 0.94,
      segments: 96,
      ringScale: 0.9 + hash(seed + 51) * 1.0,
      ringTilt: (hash(seed + 53) - 0.5) * 1.0,
      ringAspect: 0.85 + hash(seed + 57) * 0.3,
      ringShiftX: (hash(seed + 59) - 0.5) * 0.16,
      ringShiftY: (hash(seed + 61) - 0.5) * 0.2,
      releaseAngle: (lane - (LANES - 1) / 2) * 0.55 + (hash(seed + 63) - 0.5) * 0.3,
      releaseReach: 1.05 + hash(seed + 67) * 0.4,
      crosses: lane === 0,
    })
  }
}

// Slow swirling current: the curl of a few drifting sine waves, so it has no
// sinks where ribbons would bunch up. Wavelengths are about a frame wide.
const WAVES = [
  { kx: 2.2, ky: 1.35, w: 0.35, p: 0.0, a: 0.125 },
  { kx: -1.5, ky: 2.7, w: -0.27, p: 1.7, a: 0.09 },
  { kx: 3.2, ky: -2.3, w: 0.41, p: 4.1, a: 0.04 },
]

function current(x: number, y: number, time: number, out: { x: number; y: number }): void {
  let vx = 0
  let vy = 0
  for (const wave of WAVES) {
    const c = Math.cos(wave.kx * x + wave.ky * y + wave.p + wave.w * time) * wave.a
    vx += c * wave.ky
    vy -= c * wave.kx
  }
  // The frame is tall, so the current leans vertical.
  out.x = vx * 0.8
  out.y = vy * 1.35
}

const tmp = new THREE.Vector3()
const prev = new THREE.Vector3()
const next = new THREE.Vector3()
const tangent = new THREE.Vector3()
const side = new THREE.Vector3()
const bin = new THREE.Vector3()
const rotated = new THREE.Vector3()
const faceN = new THREE.Vector3()
const carried = new THREE.Vector3()
const flow = { x: 0, y: 0 }
const relax = new THREE.Vector3()
const inPlane = new THREE.Vector3()
const SCREEN_Z = new THREE.Vector3(0, 0, 1)
// How far a strip's width is turned toward the screen plane (0 to 1).
const FACE_CAMERA = 0.85

interface Emitter {
  x: number
  y: number
  z: number
  angle: number
  // Centre and half-sizes of the release orbit this step.
  cx: number
  cy: number
  rx: number
  ry: number
}

export class Ribbons {
  private strands: Strand[]
  private emitters: Emitter[] = Array.from({ length: BUNDLES }, (_, b) => ({
    x: 0,
    y: 0,
    z: 0,
    cx: 0,
    cy: 0,
    rx: 0,
    ry: 0,
    angle: (b / BUNDLES) * Math.PI * 2,
  }))
  private carry = 0
  private seen = false
  private tracking = false
  private cx = 0
  private cy = 0.1
  private hx = 0
  private hy = 0
  private scale = 1
  private radius = 0.35
  private open = 0.5
  private kick = 0
  private pace = 1
  private hang = 0
  // The hand's outline as an oval (centre and half-sizes), and whether a hand
  // is there to keep clear of.
  private zoneX = 0
  private zoneY = 0
  private zoneRx = 0
  private zoneRy = 0
  private zoneOn = false
  private gone = 0
  private viewW = 1.6
  private viewH = 3.44

  constructor(scene: THREE.Scene, plate: THREE.Texture, resolution: THREE.Vector2, time: { value: number }) {
    this.strands = SPECS.map((spec) => this.make(scene, spec, plate, resolution, time))
  }

  update(input: RibbonInput, time: number, dt: number): void {
    const pose = input.pose
    this.viewW = input.viewW
    this.viewH = input.viewH
    let vx = 0
    let vy = 0
    if (pose) {
      const tx = (pose.palmX - 0.5) * input.viewW
      const ty = (0.5 - pose.palmY) * input.viewH
      // A hand that comes back lands where it is; the jump is not a fling.
      if (!this.tracking) {
        this.cx = tx
        this.cy = ty
        this.hx = 0
        this.hy = 0
      }
      this.seen = true
      this.tracking = true
      let sx = tx
      let sy = ty
      for (const tip of pose.tips) {
        sx += (tip.x - 0.5) * input.viewW
        sy += (0.5 - tip.y) * input.viewH
      }
      const zx = sx / (pose.tips.length + 1)
      const zy = sy / (pose.tips.length + 1)
      let ex = Math.abs(tx - zx)
      let ey = Math.abs(ty - zy)
      for (const tip of pose.tips) {
        ex = Math.max(ex, Math.abs((tip.x - 0.5) * input.viewW - zx))
        ey = Math.max(ey, Math.abs((0.5 - tip.y) * input.viewH - zy))
      }
      const margin = HAND_MARGIN * this.scale
      this.zoneX = zx
      this.zoneY = zy
      this.zoneRx = ex + margin
      this.zoneRy = ey + margin
      const scale = clamp((pose.palmLen * input.viewH) / 0.4, 0.72, 1.8)
      const follow = 1 - Math.exp(-dt * 12)
      const nx = this.cx + (tx - this.cx) * follow
      const ny = this.cy + (ty - this.cy) * follow
      vx = (nx - this.cx) / Math.max(dt, 1e-3)
      vy = (ny - this.cy) / Math.max(dt, 1e-3)
      this.cx = nx
      this.cy = ny
      this.scale += (scale - this.scale) * follow
      // Opening throws the strips wider and faster; a closed hand releases them
      // close in so they coil around the palm.
      const opening = Math.max(0, pose.open - this.open) / Math.max(dt, 1e-3)
      this.open = pose.open
      this.kick = Math.min(2, this.kick + opening * dt * 2.5)
      const radius = (0.34 + pose.open * 0.4) * this.scale
      this.radius += (radius - this.radius) * (1 - Math.exp(-dt * 6))
    } else {
      this.tracking = false
    }
    this.zoneOn = pose !== null
    if (!pose && !this.seen) {
      // Before any hand shows up, a slow idle emitter keeps the frame alive.
      this.cx = Math.sin(time * 0.3) * 0.2
      this.cy = 0.1 + Math.cos(time * 0.23) * 0.3
    }
    this.kick *= Math.exp(-dt * 2)
    const fling = Math.hypot(vx, vy)
    if (fling > MAX_FLING) {
      vx *= MAX_FLING / fling
      vy *= MAX_FLING / fling
    }
    this.hx += (vx - this.hx) * (1 - Math.exp(-dt * 8))
    this.hy += (vy - this.hy) * (1 - Math.exp(-dt * 8))

    // With the hand gone nothing new is released and the current slows, so the
    // last strokes hang in the frame and only slowly change shape.
    const emitting = pose !== null || !this.seen
    this.gone = emitting ? 0 : this.gone + dt
    this.hang += ((emitting ? 0 : 1) - this.hang) * (1 - Math.exp(-dt * (emitting ? 6 : 1.2)))
    this.pace = (1 + this.kick * 0.8) * (1 - this.hang * 0.92)

    this.carry += dt
    let steps = 0
    while (this.carry >= STEP && steps < 6) {
      this.carry -= STEP
      steps++
      this.advance(time, emitting)
    }
    if (steps === 6) this.carry = 0

    const ranks: { strand: Strand; z: number }[] = []
    for (const strand of this.strands) {
      const z = this.write(strand, time)
      ranks.push({ strand, z })
    }
    ranks.sort((a, b) => a.z - b.z)
    ranks.forEach((item, index) => {
      item.strand.mesh.renderOrder = 1 + index
    })
  }

  private advance(time: number, emitting: boolean): void {
    const spin = 0.9 + this.kick * 2
    for (let b = 0; b < this.emitters.length; b++) {
      const e = this.emitters[b]
      e.angle += STEP * spin * (b % 2 ? -0.8 : 1)
      const r = this.radius * (1 + 0.25 * Math.sin(time * 0.8 + b * 2))
      // The release orbit fits inside the frame, with its centre kept in from
      // the edges, so strips are never released off screen.
      const rx = Math.min(r * 0.9, this.viewW * ORBIT_FIT)
      const ry = Math.min(r * 1.2, this.viewH * ORBIT_FIT)
      const ex = clamp(this.cx, -(this.viewW / 2 - rx), this.viewW / 2 - rx)
      const ey = clamp(this.cy, -(this.viewH / 2 - ry), this.viewH / 2 - ry)
      e.cx = ex
      e.cy = ey
      e.rx = rx
      e.ry = ry
      e.x = ex + Math.cos(e.angle) * rx
      e.y = ey + Math.sin(e.angle) * ry
      // Tip the circle out of the screen so strips leave in front of the hand
      // on one side and behind it on the other.
      e.z = Math.sin(e.angle + b * 1.3) * 0.2
    }
    const speed = 1.0 * this.pace
    // Never smaller than the hand itself, so a closed fist is circled rather
    // than wrapped.
    const ringBase = Math.max(this.radius * RING, RING_MIN * this.scale)
    // A smaller base ring, so each strip's own loop can be larger or smaller
    // than it without all of them hitting the frame-size cap together.
    const ringX = Math.min(ringBase, this.viewW * 0.24)
    const ringY = Math.min(ringBase * 1.35, this.viewH * 0.23)
    // Keep the whole ring inside the frame: when the hand is near an edge, the
    // ring's centre stays in from it, so loops lean back into view.
    // Centre the loops on the whole hand, between palm and fingertips, rather
    // than on the palm, which sits low and left the loops crowding below.
    const midX = this.zoneOn ? this.cx + (this.zoneX - this.cx) * HAND_CENTRE : this.cx
    const midY = this.zoneOn ? this.cy + (this.zoneY - this.cy) * HAND_CENTRE : this.cy
    const ringCx = clamp(midX, -(this.viewW / 2 - ringX), this.viewW / 2 - ringX)
    const ringCy = clamp(midY, -(this.viewH / 2 - ringY), this.viewH / 2 - ringY)
    // Ease in over the first couple of seconds after the hand leaves.
    const ramp = smoothstep(0.15, 1.8, this.gone)
    const settle = ramp > 0 ? 1 - Math.exp(-STEP * 3.2 * ramp) : 0
    for (const strand of this.strands) {
      const n = strand.count
      // This strip's loop, with a slow wobble so it stays a little irregular.
      const sp = strand.spec
      const wob = Math.sin(time * 0.45 + sp.seed * 1.7)
      // Never smaller than the hand, so a fist stays clear of every loop.
      const floor = RING_MIN * this.scale
      const sRx = clamp(ringX * sp.ringScale * (1 + 0.08 * wob), floor, this.viewW * 0.45)
      const sRy = clamp(ringY * sp.ringScale * sp.ringAspect * (1 - 0.06 * wob), floor * 1.35, this.viewH * 0.43)
      const tilt = sp.ringTilt + 0.15 * Math.sin(time * 0.3 + sp.seed)
      const tc = Math.cos(tilt)
      const ts = Math.sin(tilt)
      const sCx = ringCx + sp.ringShiftX * this.scale
      const sCy = ringCy + sp.ringShiftY * this.scale
      for (let i = 0; i < n; i++) {
        const k = (strand.head - i + strand.cap) % strand.cap
        const x = strand.px[k]
        const y = strand.py[k]
        current(x, y, time, flow)
        strand.vx[k] *= 1 - STEP * 1.6
        strand.vy[k] *= 1 - STEP * 1.6
        // Work in this strip's own tilted oval.
        const wx = x - sCx
        const wy = y - sCy
        const ox = wx * tc + wy * ts
        const oy = -wx * ts + wy * tc
        const d = Math.hypot(ox / sRx, oy / sRy) || 1e-3
        // Capped, so the ring guides strips rather than walling them in; an
        // uncapped pull shoved strips flat against it and squared the loops.
        const pull = clamp((1 - d) / d, -1.2, 1.2) * TETHER
        // Near the ring, strips are also carried around it, so a loop keeps
        // bending the whole way round like the reel's ovals.
        const near = Math.exp(-((d - 1) * (d - 1)) / 0.18) * ORBIT_SWIRL
        const lx = ox * pull - (oy / sRy) * sRx * near
        const ly = oy * pull + (ox / sRx) * sRy * near
        const backX = lx * tc - ly * ts
        const backY = lx * ts + ly * tc
        let clearX = 0
        let clearY = 0
        if (this.zoneOn && !sp.crosses) {
          const hx = (x - this.zoneX) / this.zoneRx
          const hy = (y - this.zoneY) / this.zoneRy
          const hd = Math.hypot(hx, hy)
          if (hd < 1 && hd > 1e-4) {
            const push = (1 - hd) * KEEP_CLEAR
            clearX = (hx / hd) * this.zoneRx * push
            clearY = (hy / hd) * this.zoneRy * push
          }
        }
        strand.px[k] = x + (flow.x * speed + strand.vx[k] + backX * this.pace + clearX) * STEP
        strand.py[k] = y + (flow.y * speed + LIFT * this.pace + strand.vy[k] + backY * this.pace + clearY) * STEP
        strand.pz[k] += (Math.sin(x * 1.7 + time * 0.5 + strand.spec.seed) * 0.12 - strand.pz[k] * 0.5) * STEP * this.pace
      }
      if (settle > 0) this.settle(strand, time, settle)
      if (!emitting) continue
      const e = this.emitters[strand.spec.bundle]
      // Each strip leaves from its own point on the orbit, a little ahead of or
      // behind its neighbours and at its own radius, so the strips separate into
      // their own loops instead of travelling together as one cable.
      const a = e.angle + sp.releaseAngle
      const reach = sp.releaseReach
      let relX = e.cx + Math.cos(a) * e.rx * reach
      let relY = e.cy + Math.sin(a) * e.ry * reach
      if (this.zoneOn && !sp.crosses) {
        const hx = (relX - this.zoneX) / this.zoneRx
        const hy = (relY - this.zoneY) / this.zoneRy
        const hd = Math.hypot(hx, hy)
        if (hd < 1 && hd > 1e-4) {
          relX = this.zoneX + (hx / hd) * this.zoneRx
          relY = this.zoneY + (hy / hd) * this.zoneRy
        }
      }
      const relZ = Math.sin(a + sp.bundle * 1.3) * 0.2
      const rx = relX - this.cx
      const ry = relY - this.cy
      const rl = Math.hypot(rx, ry) || 1
      const lane = (sp.lane - (LANES - 1) / 2) * LANE_GAP * 0.4 * Math.sqrt(this.scale)
      strand.head = (strand.head + 1) % strand.cap
      strand.count = Math.min(strand.cap, strand.count + 1)
      const h = strand.head
      strand.px[h] = relX + (rx / rl) * lane
      strand.py[h] = relY + (ry / rl) * lane
      strand.pz[h] = relZ - DEPTH_BIAS - (1 - this.open) * CLOSED_DEPTH + (strand.spec.lane % 2 ? 0.03 : -0.03)
      // A released point keeps some of the hand's own speed and is thrown
      // outward when the hand snaps open.
      // Every point is also thrown out from the palm, so strips reach across
      // the frame instead of piling up where they were released.
      const out = THROW + this.kick * 0.5
      strand.vx[h] = this.hx * 0.55 + (rx / rl) * out
      strand.vy[h] = this.hy * 0.55 + (ry / rl) * out
    }
  }

  // Pull each point of a strip toward its lane on the tall S. Strips cover
  // slightly different stretches of the S so their tips stay staggered.
  private settle(strand: Strand, time: number, amount: number): void {
    const n = strand.count
    if (n < 2) return
    const s = strand.spec
    const span = 0.72 + hash(s.seed + 41) * 0.28
    const start = (1 - span) * hash(s.seed + 43)
    const lane = (s.bundle * LANES + s.lane - (BUNDLES * LANES - 1) / 2) * HANG_GAP
    const height = this.viewH * HANG_HEIGHT
    const swing = this.viewW * HANG_SWING
    const midX = clamp(this.cx * 0.3, -this.viewW * 0.12, this.viewW * 0.12)
    const top = height / 2
    for (let i = 0; i < n; i++) {
      const k = (strand.head - i + strand.cap) % strand.cap
      const u = start + (i / (n - 1)) * span
      const a = u * Math.PI * 2 + 0.35
      // One full sine period down the frame reads as an S.
      const tx = midX + Math.sin(a) * swing
      const ty = top - u * height
      const dxu = Math.cos(a) * swing * Math.PI * 2
      const dyu = -height
      const len = Math.hypot(dxu, dyu) || 1
      const ripple = Math.sin(u * 9 + time * 1.1 + s.seed) * 0.012
      const off = lane + ripple
      const gx = tx + (-dyu / len) * off
      const gy = ty + (dxu / len) * off
      const gz = (s.lane % 2 ? 0.04 : -0.04) + Math.sin(u * 6 + s.bundle * 1.7) * 0.08 - DEPTH_BIAS
      strand.px[k] += (gx - strand.px[k]) * amount
      strand.py[k] += (gy - strand.py[k]) * amount
      strand.pz[k] += (gz - strand.pz[k]) * amount
    }
  }

  private pointAt(out: THREE.Vector3, strand: Strand, t: number): void {
    if (strand.count === 0) {
      out.set(this.cx, this.cy, 0)
      return
    }
    const f = t * (strand.count - 1)
    const i = Math.floor(f)
    const j = Math.min(i + 1, strand.count - 1)
    const a = (strand.head - i + strand.cap) % strand.cap
    const b = (strand.head - j + strand.cap) % strand.cap
    const u = f - i
    out.set(
      strand.px[a] + (strand.px[b] - strand.px[a]) * u,
      strand.py[a] + (strand.py[b] - strand.py[a]) * u,
      strand.pz[a] + (strand.pz[b] - strand.pz[a]) * u,
    )
  }

  private write(strand: Strand, time: number): number {
    const count = strand.spec.segments + 1
    const pos = strand.positions.array as Float32Array
    const nor = strand.normals.array as Float32Array
    const tan = strand.tangents.array as Float32Array
    let zSum = 0
    for (let i = 0; i < count; i++) {
      const t = i / strand.spec.segments
      this.pointAt(tmp, strand, t)
      strand.samples[i].copy(tmp)
    }
    // Relax the centreline a few times so points released during a quick turn
    // do not leave a hard corner in the strip. The ends stay put.
    const pts = strand.samples
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
      for (let i = 1; i < count - 1; i++) {
        relax.copy(pts[i - 1]).add(pts[i + 1]).multiplyScalar(0.5)
        pts[i].lerp(relax, 0.5)
      }
    }
    for (let i = 0; i < count; i++) zSum += pts[i].z
    const grown = Math.min(1, strand.count / 24)
    for (let i = 0; i < count; i++) {
      const t = i / strand.spec.segments
      const curr = strand.samples[i]
      prev.copy(i === 0 ? curr : strand.samples[i - 1])
      next.copy(i === count - 1 ? curr : strand.samples[i + 1])
      tangent.subVectors(next, prev)
      if (!normalize(tangent)) tangent.set(0, 1, 0)
      // Carry the side vector from the last sample (and the root from the last
      // frame) instead of picking a fresh axis, so the strip never flips over.
      carried.copy(i === 0 ? strand.root : side)
      carried.addScaledVector(tangent, -carried.dot(tangent))
      if (!normalize(carried)) {
        carried.set(Math.abs(tangent.y) > 0.9 ? 1 : 0, Math.abs(tangent.y) > 0.9 ? 0 : 1, 0)
        carried.addScaledVector(tangent, -carried.dot(tangent))
        normalize(carried)
      }
      // Lean the width direction into the screen plane so strips read as flat
      // bands facing the camera, as in the reel. Keep the carried side's sign
      // so the lean never flips a strip over.
      inPlane.crossVectors(tangent, SCREEN_Z)
      if (normalize(inPlane)) {
        if (inPlane.dot(carried) < 0) inPlane.negate()
        carried.lerp(inPlane, FACE_CAMERA)
        normalize(carried)
      }
      side.copy(carried)
      if (i === 0) strand.root.copy(side)
      bin.crossVectors(tangent, side)
      normalize(bin)
      // Mostly flat, with an occasional half twist that drifts along the strip
      // and shows its edge for a moment.
      const bump = Math.max(0, Math.sin(t * Math.PI * 2.6 + strand.spec.seed * 1.9 + time * 0.35))
      const twist = Math.PI * 0.5 * Math.pow(bump, 6) * strand.spec.twist
      const c = Math.cos(twist)
      const s = Math.sin(twist)
      rotated.copy(side).multiplyScalar(c).addScaledVector(bin, s)
      normalize(rotated)
      faceN.crossVectors(tangent, rotated)
      if (!normalize(faceN)) faceN.set(0, 0, 1)
      const half = strand.spec.width * Math.sqrt(this.scale) * taper(t) * grown * 0.5
      writeEnd(pos, nor, tan, i * 2, curr, rotated, tangent, faceN, half)
      writeEnd(pos, nor, tan, i * 2 + 1, curr, rotated, tangent, faceN, -half)
    }
    strand.positions.needsUpdate = true
    strand.tangents.needsUpdate = true
    strand.normals.needsUpdate = true
    return zSum / count
  }

  private make(
    scene: THREE.Scene,
    spec: Spec,
    plate: THREE.Texture,
    resolution: THREE.Vector2,
    time: { value: number },
  ): Strand {
    const segments = spec.segments
    const verts = (segments + 1) * 2
    const positions = new Float32Array(verts * 3)
    const normals = new Float32Array(verts * 3)
    const tangents = new Float32Array(verts * 3)
    const uvs = new Float32Array(verts * 2)
    const indices: number[] = []
    for (let i = 0; i <= segments; i++) {
      const v = i / segments
      uvs[i * 4] = 0
      uvs[i * 4 + 1] = v
      uvs[i * 4 + 2] = 1
      uvs[i * 4 + 3] = v
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const geometry = new THREE.BufferGeometry()
    const positionAttr = new THREE.BufferAttribute(positions, 3)
    const normalAttr = new THREE.BufferAttribute(normals, 3)
    const tangentAttr = new THREE.BufferAttribute(tangents, 3)
    positionAttr.setUsage(THREE.DynamicDrawUsage)
    normalAttr.setUsage(THREE.DynamicDrawUsage)
    tangentAttr.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', positionAttr)
    geometry.setAttribute('normal', normalAttr)
    geometry.setAttribute('aTangent', tangentAttr)
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        plate: { value: plate },
        resolution: { value: resolution },
        time,
        seed: { value: spec.seed },
        alphaScale: { value: spec.alpha },
      },
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    scene.add(mesh)
    const cap = spec.points
    return {
      spec,
      cap,
      head: -1,
      count: 0,
      px: new Float32Array(cap),
      py: new Float32Array(cap),
      pz: new Float32Array(cap),
      vx: new Float32Array(cap),
      vy: new Float32Array(cap),
      root: new THREE.Vector3(1, 0, 0),
      mesh,
      positions: positionAttr,
      normals: normalAttr,
      tangents: tangentAttr,
      samples: Array.from({ length: segments + 1 }, () => new THREE.Vector3()),
    }
  }
}

interface Strand {
  spec: Spec
  cap: number
  head: number
  count: number
  px: Float32Array
  py: Float32Array
  pz: Float32Array
  vx: Float32Array
  vy: Float32Array
  root: THREE.Vector3
  mesh: THREE.Mesh
  positions: THREE.BufferAttribute
  normals: THREE.BufferAttribute
  tangents: THREE.BufferAttribute
  samples: THREE.Vector3[]
}

function writeEnd(
  pos: Float32Array,
  nor: Float32Array,
  tan: Float32Array,
  index: number,
  curr: THREE.Vector3,
  across: THREE.Vector3,
  along: THREE.Vector3,
  normal: THREE.Vector3,
  signed: number,
): void {
  const o = index * 3
  pos[o] = curr.x + across.x * signed
  pos[o + 1] = curr.y + across.y * signed
  pos[o + 2] = curr.z + across.z * signed
  nor[o] = normal.x
  nor[o + 1] = normal.y
  nor[o + 2] = normal.z
  tan[o] = along.x
  tan[o + 1] = along.y
  tan[o + 2] = along.z
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Long straight sides that run to a point at each end, like cut ribbon.
function taper(t: number): number {
  const ramp = Math.min(1, t / 0.12, (1 - t) / 0.2)
  return Math.pow(Math.max(ramp, 0), 0.85)
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function normalize(v: THREE.Vector3): boolean {
  const len = v.length()
  if (len < 1e-5) return false
  v.multiplyScalar(1 / len)
  return true
}
