import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'

export interface Mask {
  data: Uint8Array
  width: number
  height: number
}

export interface RawHand {
  confidence: number
  points: Float32Array
}

function asset(path: string): string {
  const base = import.meta.env.BASE_URL
  return `${base}${path}`.replace(/([^:])\/{2,}/g, '$1/')
}

function pack(mask: {
  width: number
  height: number
  getAsUint8Array: () => Uint8Array
  getAsFloat32Array: () => Float32Array
}): Mask | null {
  const width = mask.width
  const height = mask.height
  const count = width * height
  if (!count) return null
  const bytes = mask.getAsUint8Array()
  if (bytes.length === count) return { data: Uint8Array.from(bytes), width, height }
  if (bytes.length === count * 4) {
    const data = new Uint8Array(count)
    for (let i = 0; i < count; i++) data[i] = bytes[i * 4]
    return { data, width, height }
  }
  const floats = mask.getAsFloat32Array()
  if (floats.length >= count) {
    const data = new Uint8Array(count)
    for (let i = 0; i < count; i++) data[i] = Math.max(0, Math.min(255, Math.round(floats[i] * 255)))
    return { data, width, height }
  }
  return null
}

function blend(prev: Mask | null, next: Mask): Mask {
  if (!prev || prev.width !== next.width || prev.height !== next.height) return next
  const data = new Uint8Array(next.data.length)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(prev.data[i] * 0.4 + next.data[i] * 0.6)
  return { data, width: next.width, height: next.height }
}

export class Vision {
  ready = false
  status = 'Starting'
  mask: Mask | null = null
  private hands: HandLandmarker | null = null
  private segmenter: ImageSegmenter | null = null
  private handTs = 0
  private segTs = 0
  private scratch = document.createElement('canvas')
  private ctx = this.scratch.getContext('2d', { willReadFrequently: true })

  async init(): Promise<void> {
    this.status = 'Loading hand tracking'
    const files = await FilesetResolver.forVisionTasks(asset('wasm'))
    const handModel = asset('models/hand_landmarker.task')
    const segModel = asset('models/selfie_segmenter.tflite')
    this.hands = await this.makeHands(files, handModel, 'GPU').catch(() => this.makeHands(files, handModel, 'CPU'))
    try {
      this.segmenter = await this.makeSeg(files, segModel, 'GPU').catch(() => this.makeSeg(files, segModel, 'CPU'))
    } catch {
      this.segmenter = null
    }
    this.ready = true
    this.status = 'Ready'
  }

  private makeHands(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, model: string, delegate: 'GPU' | 'CPU') {
    return HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    })
  }

  private makeSeg(files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, model: string, delegate: 'GPU' | 'CPU') {
    return ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  }

  private fit(source: CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number }): boolean {
    if (!this.ctx) return false
    const sw = source.videoWidth || source.width || 0
    const sh = source.videoHeight || source.height || 0
    if (sw < 2 || sh < 2) return false
    const edge = Math.max(sw, sh)
    const scale = edge > 640 ? 640 / edge : 1
    const width = Math.max(2, Math.round(sw * scale))
    const height = Math.max(2, Math.round(sh * scale))
    if (this.scratch.width !== width) this.scratch.width = width
    if (this.scratch.height !== height) this.scratch.height = height
    this.ctx.drawImage(source, 0, 0, width, height)
    return true
  }

  detectHands(source: HTMLCanvasElement | HTMLVideoElement): RawHand | null {
    if (!this.hands || !this.fit(source)) return null
    this.handTs = Math.max(this.handTs + 1, performance.now())
    const result = this.hands.detectForVideo(this.scratch, this.handTs)
    const group = result.landmarks?.[0]
    if (!group || group.length < 21) return null
    const points = new Float32Array(42)
    for (let j = 0; j < 21; j++) {
      points[j * 2] = group[j].x
      points[j * 2 + 1] = group[j].y
    }
    return { confidence: result.handedness?.[0]?.[0]?.score ?? 0, points }
  }

  detectPerson(source: HTMLCanvasElement | HTMLVideoElement): void {
    if (!this.segmenter || !this.fit(source)) return
    this.segTs = Math.max(this.segTs + 1, performance.now())
    const result = this.segmenter.segmentForVideo(this.scratch, this.segTs)
    const masks = result.confidenceMasks ?? []
    const person = masks.length > 1 ? masks[masks.length - 1] : masks[0]
    const packed = person ? pack(person) : null
    for (const mask of masks) mask.close()
    if (packed) this.mask = blend(this.mask, packed)
  }
}
