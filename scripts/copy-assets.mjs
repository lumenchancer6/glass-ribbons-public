import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'

const MODELS = [
  {
    name: 'MediaPipe hand_landmarker float16',
    path: 'public/models/hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    name: 'MediaPipe selfie_segmenter float16',
    path: 'public/models/selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  },
]

await mkdir('public/wasm', { recursive: true })
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/wasm', { recursive: true })
console.log('MediaPipe wasm copied locally.')

await mkdir('public/models', { recursive: true })
const notes = []
for (const model of MODELS) {
  let bytes
  try {
    await access(model.path)
    bytes = await readFile(model.path)
    console.log(`${model.name} already present.`)
  } catch {
    console.log(`Downloading ${model.name}…`)
    const response = await fetch(model.url)
    if (!response.ok) throw new Error(`${model.url} -> ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(model.path, bytes)
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  notes.push(`name: ${model.name}\nurl: ${model.url}\nsha256: ${sha256}\nlicense: Apache-2.0\n`)
  console.log(`${model.name} sha256 ${sha256}`)
}
await writeFile('public/models/SOURCE.txt', notes.join('\n'))
