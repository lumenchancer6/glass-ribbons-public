import * as THREE from 'three'
import type { HandPose } from './hands.ts'
import { Ribbons } from './ribbons.ts'
import { HAND_FRAG, PLATE_FRAG, PLATE_VERT } from './shaders.ts'
import type { Mask } from './vision.ts'

export class Stage {
  private renderer: THREE.WebGLRenderer
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40)
  private scene = new THREE.Scene()
  private plate: HTMLCanvasElement
  private plateTex: THREE.CanvasTexture
  private maskCanvas = document.createElement('canvas')
  private maskTex: THREE.CanvasTexture
  private maskCtx: CanvasRenderingContext2D
  private resolution = new THREE.Vector2(2, 2)
  private time = { value: 0 }
  private bg: THREE.Mesh
  private hand: THREE.Mesh
  private ribbons: Ribbons
  private maskImage: ImageData | null = null
  private plateW = 0
  private plateH = 0

  constructor(canvas: HTMLCanvasElement, plate: HTMLCanvasElement) {
    this.plate = plate
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x07110c, 1)
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.autoClear = true
    this.camera.position.set(0, 0, 6)
    this.camera.lookAt(0, 0, 0)

    this.plateTex = new THREE.CanvasTexture(plate)
    this.plateTex.colorSpace = THREE.LinearSRGBColorSpace
    this.plateTex.minFilter = THREE.LinearFilter
    this.plateTex.magFilter = THREE.LinearFilter
    this.plateTex.generateMipmaps = false

    this.maskCanvas.width = 4
    this.maskCanvas.height = 4
    const maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })
    if (!maskCtx) throw new Error('Could not draw the hand mask')
    this.maskCtx = maskCtx
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas)
    this.maskTex.colorSpace = THREE.LinearSRGBColorSpace
    this.maskTex.minFilter = THREE.LinearFilter
    this.maskTex.magFilter = THREE.LinearFilter
    this.maskTex.generateMipmaps = false

    const plateMat = new THREE.ShaderMaterial({
      uniforms: { plate: { value: this.plateTex } },
      vertexShader: PLATE_VERT,
      fragmentShader: PLATE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), plateMat)
    this.bg.position.z = -2.2
    this.bg.renderOrder = 0
    this.bg.frustumCulled = false
    this.scene.add(this.bg)

    const handMat = new THREE.ShaderMaterial({
      uniforms: { plate: { value: this.plateTex }, mask: { value: this.maskTex } },
      vertexShader: PLATE_VERT,
      fragmentShader: HAND_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    })
    this.hand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), handMat)
    this.hand.position.z = 0
    this.hand.renderOrder = 80
    this.hand.frustumCulled = false
    this.hand.visible = false
    this.scene.add(this.hand)

    this.ribbons = new Ribbons(this.scene, this.plateTex, this.resolution, this.time)
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.resolution.set(width, height)
    const distBg = this.camera.position.z - this.bg.position.z
    const distHand = this.camera.position.z - this.hand.position.z
    const bg = this.frustum(distBg)
    const hand = this.frustum(distHand)
    this.bg.scale.set(bg.w, bg.h, 1)
    this.hand.scale.set(hand.w, hand.h, 1)
  }

  setMask(mask: Mask | null): void {
    if (!mask) {
      this.hand.visible = false
      return
    }
    if (this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas.width = mask.width
      this.maskCanvas.height = mask.height
      this.maskImage = null
      this.maskTex.dispose()
    }
    if (!this.maskImage || this.maskImage.width !== mask.width || this.maskImage.height !== mask.height) {
      this.maskImage = this.maskCtx.createImageData(mask.width, mask.height)
    }
    const pixels = this.maskImage.data
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i]
      const o = i * 4
      pixels[o] = v
      pixels[o + 1] = v
      pixels[o + 2] = v
      pixels[o + 3] = 255
    }
    this.maskCtx.putImageData(this.maskImage, 0, 0)
    this.maskTex.needsUpdate = true
    this.hand.visible = true
  }

  render(pose: HandPose | null, time: number, dt: number): void {
    this.time.value = time
    // GPU textures keep the size they were first uploaded at, so a resized
    // plate has to be reallocated or the old corner gets stretched over the view.
    if (this.plate.width !== this.plateW || this.plate.height !== this.plateH) {
      this.plateW = this.plate.width
      this.plateH = this.plate.height
      this.plateTex.dispose()
    }
    this.plateTex.needsUpdate = true
    const view = this.frustum(this.camera.position.z)
    this.ribbons.update({ pose, viewW: view.w, viewH: view.h }, time, dt)
    this.renderer.render(this.scene, this.camera)
  }

  private frustum(distance: number): { w: number; h: number } {
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * distance
    return { w: h * this.camera.aspect, h }
  }
}
