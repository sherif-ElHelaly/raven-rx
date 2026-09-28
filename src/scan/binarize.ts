// Minimal image primitives for reading printed marks off a case-sheet photo.
// Pure functions over a grayscale buffer so they run (and test) anywhere.

export interface Gray {
  w: number
  h: number
  px: Uint8Array | Uint8ClampedArray
}

export interface Blob2D {
  x0: number
  y0: number
  x1: number
  y1: number
  // Pixel indices into the source image.
  pts: number[]
}

export const blobW = (b: Blob2D) => b.x1 - b.x0 + 1
export const blobH = (b: Blob2D) => b.y1 - b.y0 + 1

export function crop(img: Gray, x: number, y: number, w: number, h: number): Gray {
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const cw = Math.max(1, Math.min(img.w - x0, Math.round(w)))
  const ch = Math.max(1, Math.min(img.h - y0, Math.round(h)))
  const px = new Uint8Array(cw * ch)
  for (let r = 0; r < ch; r++) px.set(img.px.subarray((y0 + r) * img.w + x0, (y0 + r) * img.w + x0 + cw), r * cw)
  return { w: cw, h: ch, px }
}

// Local-mean threshold: a pixel is ink when darker than k × the mean of its
// (2r+1)² neighbourhood. Copes with shadows and uneven light, unlike one global cut.
export function adaptiveThreshold(img: Gray, r: number, k: number): Uint8Array {
  const { w, h, px } = img
  const W = w + 1
  const integral = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += px[y * w + x]!
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1]! + row
    }
  }
  const ink = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum = integral[y1 * W + x1]! - integral[y0 * W + x1]! - integral[y1 * W + x0]! + integral[y0 * W + x0]!
      ink[y * w + x] = px[y * w + x]! < (sum / ((x1 - x0) * (y1 - y0))) * k ? 1 : 0
    }
  }
  return ink
}

// 8-connected blobs of ink.
export function connectedBlobs(ink: Uint8Array, w: number, h: number): Blob2D[] {
  const seen = new Uint8Array(ink.length)
  const blobs: Blob2D[] = []
  const stack: number[] = []
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || seen[i]) continue
    const b: Blob2D = { x0: w, y0: h, x1: -1, y1: -1, pts: [] }
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const p = stack.pop()!
      b.pts.push(p)
      const x = p % w
      const y = (p - x) / w
      if (x < b.x0) b.x0 = x
      if (x > b.x1) b.x1 = x
      if (y < b.y0) b.y0 = y
      if (y > b.y1) b.y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const q = ny * w + nx
          if (ink[q] && !seen[q]) {
            seen[q] = 1
            stack.push(q)
          }
        }
      }
    }
    blobs.push(b)
  }
  return blobs
}

export function mergeBlobs(a: Blob2D, b: Blob2D): Blob2D {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    pts: a.pts.concat(b.pts),
  }
}

// Erases blobs bigger than ordinary text (frames, ovals, table rules) so the
// text they surround can be read. Returns a clean black-on-white image.
export function eraseLargeShapes(img: Gray, textHeight: number): Gray {
  const r = Math.max(4, Math.round(textHeight * 0.3))
  const ink = adaptiveThreshold(img, r, 0.8)
  const out = new Uint8Array(img.w * img.h).fill(255)
  for (const b of connectedBlobs(ink, img.w, img.h)) {
    if (blobW(b) > 3 * textHeight || blobH(b) > 2 * textHeight || b.pts.length < 4) continue
    for (const p of b.pts) out[p] = 0
  }
  return { w: img.w, h: img.h, px: out }
}
