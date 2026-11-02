import { drawCover } from './cover.ts'
import { HandFollow } from './hands.ts'
import { maskFromHand, paintGarden, paintHand, rehearsalPoints } from './preview.ts'
import { Stage } from './stage.ts'
import { Vision } from './vision.ts'

export class App {
  private canvas: HTMLCanvasElement
  private plate = document.createElement('canvas')
  private plateCtx: CanvasRenderingContext2D
  private garden = document.createElement('canvas')
  private stage: Stage
  private vision = new Vision()
  private hands = new HandFollow()
  private video = document.createElement('video')
  private preview: boolean
  private mirror = true
  private clean = false
  private recording = false
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private cameraReady = false
  private usingFile = false
  private last = 0
  private lastMask = 0
  private seenHand = false
  private status = 'Starting'
  private gardenKey = ''

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>('#view')
    if (!canvas) throw new Error('Missing canvas')
    this.canvas = canvas
    const ctx = this.plate.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not draw the camera plate')
    this.plateCtx = ctx
    this.stage = new Stage(canvas, this.plate)
    const params = new URLSearchParams(location.search)
    this.preview = params.has('preview')
    if (params.has('clean')) {
      this.clean = true
      document.body.classList.add('clean')
    }
    if (params.has('reel')) document.body.classList.add('reel')
    this.video.playsInline = true
    this.video.muted = true
    this.video.autoplay = true
    this.video.loop = true
    document.getElementById('retry')?.addEventListener('click', () => {
      void this.openCamera()
    })
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('dragover', (event) => event.preventDefault())
    window.addEventListener('drop', (event) => {
      event.preventDefault()
      const file = event.dataTransfer?.files?.[0]
      if (file && file.type.startsWith('video/')) this.playFile(file)
    })
    const src = params.get('src')
    if (src) this.playUrl(src)
  }

  async start(): Promise<void> {
    this.resize()
    requestAnimationFrame(this.loop)
    if (this.preview || this.usingFile) {
      this.status = ''
      this.showStatus()
      return
    }
    try {
      await this.vision.init()
      this.status = 'Ready'
    } catch (err) {
      this.status = err instanceof Error ? err.message : 'Hand tracking failed to load'
      this.showStatus()
      return
    }
    await this.openCamera()
  }

  private playFile(file: File): void {
    this.playUrl(URL.createObjectURL(file))
  }

  private playUrl(url: string): void {
    this.preview = false
    this.usingFile = true
    this.mirror = false
    this.video.srcObject = null
    this.video.src = url
    void this.video.play().then(() => {
      this.cameraReady = true
      this.status = ''
      this.showStatus()
    })
    if (!this.vision.ready) {
      void this.vision.init().catch((err) => {
        this.status = err instanceof Error ? err.message : 'Hand tracking failed to load'
        this.showStatus()
      })
    }
  }

  private async openCamera(): Promise<void> {
    this.status = 'Asking for the camera'
    this.showStatus()
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status = 'This browser has no camera'
      this.showStatus()
      return
    }
    try {
      this.stream?.getTracks().forEach((track) => track.stop())
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      })
    } catch (err) {
      this.status = err instanceof Error ? err.message : 'Camera permission was denied'
      this.showStatus()
      return
    }
    this.usingFile = false
    this.video.srcObject = this.stream
    await this.video.play()
    this.cameraReady = true
    this.status = ''
    this.showStatus()
  }

  private loop = (now: number): void => {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60
    this.last = now
    const time = now / 1000
    this.resize()
    const pose = this.drawPlate(time, dt, now)
    if (pose) this.seenHand = true
    this.stage.render(pose, time, dt)
    this.hint()
    requestAnimationFrame(this.loop)
  }

  private drawPlate(time: number, dt: number, now: number) {
    const box = this.canvas.getBoundingClientRect()
    const dpr = Math.min(1.75, window.devicePixelRatio || 1)
    const width = Math.max(2, Math.round(box.width * dpr))
    const height = Math.max(2, Math.round(box.height * dpr))
    if (this.plate.width !== width || this.plate.height !== height) {
      this.plate.width = width
      this.plate.height = height
    }
    if (this.preview) {
      this.ensureGarden(width, height)
      this.plateCtx.drawImage(this.garden, 0, 0, width, height)
      const points = rehearsalPoints(time)
      if (!points) {
        this.stage.setMask(null)
        return this.hands.update(null, time, dt)
      }
      paintHand(this.plateCtx, points, width, height, '#f0c2a4')
      this.stage.setMask(maskFromHand(points, 200, Math.max(200, Math.round(200 * height / width))))
      return this.hands.update(points, time, dt)
    }
    if (this.cameraReady && this.video.videoWidth > 0) {
      drawCover(this.plateCtx, this.video, this.video.videoWidth, this.video.videoHeight, width, height, this.mirror && !this.usingFile)
      if (this.vision.ready) {
        const raw = this.vision.detectHands(this.plate)
        if (now - this.lastMask > 120) {
          this.vision.detectPerson(this.plate)
          this.lastMask = now
        }
        this.stage.setMask(this.vision.mask)
        return this.hands.update(raw?.points ?? null, time, dt)
      }
    } else {
      this.plateCtx.fillStyle = '#07110c'
      this.plateCtx.fillRect(0, 0, width, height)
    }
    this.stage.setMask(null)
    return this.hands.update(null, time, dt)
  }

  private ensureGarden(width: number, height: number): void {
    const key = `${width}x${height}`
    if (key === this.gardenKey) return
    this.garden.width = width
    this.garden.height = height
    const ctx = this.garden.getContext('2d')
    if (!ctx) return
    paintGarden(ctx, width, height)
    this.gardenKey = key
  }

  private hint(): void {
    const hint = document.getElementById('hint')
    if (!hint) return
    if (this.clean || this.seenHand) hint.classList.add('off')
    else hint.classList.remove('off')
  }

  private showStatus(): void {
    const el = document.getElementById('status')
    const retry = document.getElementById('retry')
    if (el) {
      el.hidden = !this.status
      el.textContent = this.status
    }
    if (retry) retry.hidden = this.preview || this.cameraReady || this.usingFile || !this.status
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'c') {
      document.body.classList.toggle('reel')
      this.resize()
    } else if (key === 'h') {
      this.clean = !this.clean
      document.body.classList.toggle('clean', this.clean)
    } else if (key === 'm') {
      this.mirror = !this.mirror
    } else if (key === 'v') {
      this.toggleRecord()
    } else if (key === 'f') {
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen()
      else void document.exitFullscreen()
    }
  }

  private resize(): void {
    const box = this.canvas.getBoundingClientRect()
    const dpr = Math.min(1.75, window.devicePixelRatio || 1)
    const width = Math.max(2, Math.round(box.width * dpr))
    const height = Math.max(2, Math.round(box.height * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) this.stage.resize(width, height)
  }

  private toggleRecord(): void {
    const rec = document.getElementById('rec')
    if (this.recording && this.recorder) {
      this.recorder.stop()
      return
    }
    const stream = this.canvas.captureStream(30)
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
    this.chunks = []
    this.recorder = new MediaRecorder(stream, { mimeType: type })
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data)
    }
    this.recorder.onstop = () => {
      this.recording = false
      if (rec) rec.hidden = true
      const blob = new Blob(this.chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'glass-ribbons.webm'
      link.click()
      URL.revokeObjectURL(url)
    }
    this.recorder.start()
    this.recording = true
    if (rec) rec.hidden = false
  }
}
