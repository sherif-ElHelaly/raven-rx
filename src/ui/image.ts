// Photo capture support — VISION.md §5.1: resized to ≤1024 px and ~150 KB.

const MAX_DIMENSION = 1024
const TARGET_BYTES = 150 * 1024
const MIN_QUALITY = 0.4

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load image'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// Resizes to fit within MAX_DIMENSION and re-encodes as JPEG, stepping the
// quality down until the file is near TARGET_BYTES (or MIN_QUALITY is hit).
export async function compressImage(file: File): Promise<Blob> {
  const img = await loadImage(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(img, 0, 0, width, height)

  let quality = 0.85
  let blob = await canvasToBlob(canvas, quality)
  while (blob && blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
    quality -= 0.15
    blob = await canvasToBlob(canvas, quality)
  }
  if (!blob) throw new Error('Could not encode image')
  return blob
}
