// On-device OCR for case sheets (Tesseract). Free and private: photos never
// leave the phone. The engine and models (Arabic ~3 MB, English ~2 MB for the
// starred card number) are fetched from jsDelivr on first use, then served from
// cache (the service worker caches the engine; Tesseract keeps models in IndexedDB).
//
// Per page: one full Arabic read for the text and line positions, then three
// targeted reads — the "*119244*" card number, the مرتب شهرين oval, and the
// الكمية column (see quantities.ts).

import type { Line, PSM as PSMEnum, Worker } from 'tesseract.js'
import { crop, eraseLargeShapes, type Gray } from './binarize'
import { cardFromStars, parseCase, type PageRead } from './parseCase'
import { quantityColumnSpan, readQuantities } from './quantities'

// Phone photos are 3000–4000 px; ~2400 px keeps small print legible while
// keeping recognition to a few seconds per page.
const MAX_DIMENSION = 2400

type Progress = (fraction: number, stage: string) => void

async function toCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

function toGray(canvas: HTMLCanvasElement): Gray {
  const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  const px = new Uint8Array(width * height)
  for (let i = 0; i < px.length; i++) {
    px[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000
  }
  return { w: width, h: height, px }
}

function grayToCanvas(img: Gray, scale = 1): HTMLCanvasElement {
  const src = document.createElement('canvas')
  src.width = img.w
  src.height = img.h
  const ctx = src.getContext('2d')!
  const out = ctx.createImageData(img.w, img.h)
  for (let i = 0; i < img.px.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = img.px[i]!
    out.data[i * 4 + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  if (scale === 1) return src
  const big = document.createElement('canvas')
  big.width = Math.round(img.w * scale)
  big.height = Math.round(img.h * scale)
  const bctx = big.getContext('2d')!
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(src, 0, 0, big.width, big.height)
  return big
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

async function readStarCard(eng: Worker, gray: Gray, lines: Line[], lineHeight: number): Promise<string | undefined> {
  const words = lines.flatMap((l) => l.words)
  const title = lines.find((l) => /المرتبات|العلاجية|بالمريض/.test(l.text))
  const word =
    words.find((w) => /\*/.test(w.text) && /[0-9]{3,}/.test(w.text)) ??
    title?.words.find((w) => /^\*?[0-9]{5,8}\*?$/.test(w.text.trim()))
  if (!word) return undefined
  const { x0, y0, x1, y1 } = word.bbox
  const pad = lineHeight
  const region = crop(gray, x0 - pad * 1.5, y0 - pad * 0.4, x1 - x0 + pad * 3, y1 - y0 + pad * 0.8)
  const { data } = await eng.recognize(grayToCanvas(region, 3))
  return cardFromStars(data.text) ?? data.text.match(/[0-9]{5,}/)?.[0]
}

async function readOval(
  ara: Worker,
  gray: Gray,
  lines: Line[],
  lineHeight: number,
  PSM: typeof PSMEnum,
): Promise<string> {
  // The stamp sits above the report title; erase its outline so the text inside reads.
  const title = lines.find((l) => /المرتبات|العلاجية/.test(l.text))
  const bottom = title ? title.bbox.y0 : gray.h * 0.3
  const top = crop(gray, 0, 0, gray.w, bottom)
  await ara.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  const { data } = await ara.recognize(grayToCanvas(eraseLargeShapes(top, lineHeight)))
  return data.text
}

function readQtyColumn(gray: Gray, lines: Line[], text: string, lineHeight: number): Map<number, number> {
  const header = lines.flatMap((l) => l.words).find((w) => /الكمي[ةه]/.test(w.text))
  const meds = parseCase(text).meds
  const result = new Map<number, number>()
  if (!header || meds.length === 0) return result
  const { x0, x1, y1 } = header.bbox
  const [left, right] = quantityColumnSpan(x0, x1)
  const bottom = Math.max(...meds.map((m) => lines[m.lineIndex]!.bbox.y1)) + lineHeight
  const col = crop(gray, left, y1, right - left, bottom - y1)
  const centers = meds.map((m) => (lines[m.lineIndex]!.bbox.y0 + lines[m.lineIndex]!.bbox.y1) / 2 - y1)
  readQuantities(col, lineHeight, centers).forEach((q, i) => {
    if (q !== undefined) result.set(meds[i]!.lineIndex, q)
  })
  return result
}

export async function readCasePages(files: Blob[], onProgress?: Progress): Promise<PageRead[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  let page = 0
  const stage = () => (files.length > 1 ? `Reading page ${page + 1} of ${files.length}…` : 'Reading the sheet…')
  const ara = await createWorker('ara', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.((page + m.progress) / files.length, stage())
      else onProgress?.(page / files.length, 'Loading the Arabic reader…')
    },
  })
  let eng: Worker | undefined
  try {
    const pages: PageRead[] = []
    for (; page < files.length; page++) {
      const canvas = await toCanvas(files[page]!)
      const gray = toGray(canvas)
      // Set every page: the oval read below switches the mode. Single-block is
      // the engine default, and what the sheet layout reads best with.
      await ara.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
      const { data } = await ara.recognize(canvas, {}, { blocks: true, text: true })
      const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      const text = lines.map((l) => l.text.replace(/\n/g, ' ').trim()).join('\n')
      const lineHeight = median(lines.filter((l) => l.words.length >= 3).map((l) => l.bbox.y1 - l.bbox.y0)) || 24

      onProgress?.((page + 1) / files.length, 'Checking card number, plan and quantities…')
      let starCard: string | undefined
      if (cardFromStars(text) || lines.some((l) => /\*/.test(l.text))) {
        eng ??= await createWorker('eng')
        await eng.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789*' })
        starCard = await readStarCard(eng, gray, lines, lineHeight)
      }
      const ovalText = await readOval(ara, gray, lines, lineHeight, PSM)
      const qtyByLine = readQtyColumn(gray, lines, text, lineHeight)
      pages.push({ text, starCard, ovalText, qtyByLine })
    }
    return pages
  } finally {
    await ara.terminate()
    await eng?.terminate()
  }
}
