// On-device OCR for case sheets and pharmacy tickets (Tesseract). Free and
// private: photos never leave the phone. The engine and models (Arabic ~3 MB,
// English ~2 MB for Latin digits) are fetched from jsDelivr on first use, then
// served from cache (the service worker caches the engine; Tesseract keeps
// models in IndexedDB).
//
// Per page: two full Arabic reads (see passes.ts), then targeted reads — the
// "*119244*" card number, the مرتب شهرين oval, and the quantity column.

import type { PSM as PSMEnum, Worker } from 'tesseract.js'
import { crop, eraseLargeShapes, type Gray } from './binarize'
import { cardFromStars, parseCase, type PageRead, type ParsedMed } from './parseCase'
import { mergePasses, type OcrLine } from './passes'
import { quantityColumnSpan, readQuantities } from './quantities'

// Phone photos are 3000–4000 px; ~2400 px keeps small print legible while
// keeping recognition to a few seconds per page.
const MAX_DIMENSION = 2400
// The second read, at 80 %: different enough to recover what the first garbles.
const SECOND_PASS_SCALE = 0.8

type Progress = (fraction: number, stage: string) => void

async function toGray(file: Blob, scale = 1): Promise<Gray> {
  const bitmap = await createImageBitmap(file)
  const fit = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)) * scale
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * fit)
  canvas.height = Math.round(bitmap.height * fit)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
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

// One Arabic read; boxes are scaled back to full-size page coordinates.
async function readLines(ara: Worker, img: Gray, scale: number, PSM: typeof PSMEnum): Promise<OcrLine[]> {
  // Single-block is the engine default and reads these forms best; set it
  // every time because the oval read switches modes.
  await ara.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
  // Grayscale reads much better than colour on shaded, photographed forms.
  const { data } = await ara.recognize(grayToCanvas(img), {}, { blocks: true })
  const up = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
    x0: b.x0 / scale,
    y0: b.y0 / scale,
    x1: b.x1 / scale,
    y1: b.y1 / scale,
  })
  return (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        text: l.text.replace(/\n/g, ' ').trim(),
        bbox: up(l.bbox),
        words: l.words.map((w) => ({ text: w.text, bbox: up(w.bbox) })),
      })),
    ),
  )
}

async function readStarCard(eng: Worker, gray: Gray, lines: OcrLine[], lineHeight: number): Promise<string | undefined> {
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

async function readOval(ara: Worker, gray: Gray, lines: OcrLine[], lineHeight: number, PSM: typeof PSMEnum): Promise<string> {
  // The stamp sits above the report title; erase its outline so the text inside reads.
  const title = lines.find((l) => /المرتبات|العلاجية/.test(l.text))
  if (!title) return ''
  const top = crop(gray, 0, 0, gray.w, title.bbox.y0)
  await ara.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  const { data } = await ara.recognize(grayToCanvas(eraseLargeShapes(top, lineHeight)))
  return data.text
}

// Case sheet: the الكمية column, Arabic-Indic digits (see quantities.ts).
function readQtyColumn(gray: Gray, lines: OcrLine[], meds: ParsedMed[], lineHeight: number): Map<number, number> {
  const header = lines.flatMap((l) => l.words).find((w) => /الكمي[ةه]/.test(w.text))
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

const UNIT_OR_FORM = /^(مجم|مم|مل|جم|ملجم|[اأإ]قراص|كبسول\S*|شراب|حقن\S*|[اأ]مبول\S*)$/

// Pharmacy ticket: "الكمية المطلوبة" sits just left of the med text, in Latin
// digits, which the English model reads well. Crop that cell per row.
async function readTicketQty(eng: Worker, gray: Gray, lines: OcrLine[], meds: ParsedMed[]): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  for (const m of meds) {
    if (m.qtyInLine) {
      result.set(m.lineIndex, m.qtyInLine)
      continue
    }
    const words = lines[m.lineIndex]!.words
    const nameIdx = words.findIndex((w) => w.text.includes(m.name) || m.name.includes(w.text.trim()))
    if (nameIdx < 0) continue
    // The med text runs name → strength → unit → form, right to left.
    let end = nameIdx
    for (let j = nameIdx + 1; j < Math.min(words.length, nameIdx + 5); j++) {
      if (UNIT_OR_FORM.test(words[j]!.text.trim())) end = j
    }
    const left = Math.min(...words.slice(nameIdx, end + 1).map((w) => w.bbox.x0))
    const { y0, y1 } = words[nameIdx]!.bbox
    const h = y1 - y0
    // Wide enough to reach across the gap to the cell; table rules erased.
    const cell = crop(gray, left - h * 9, y0 - h * 0.5, h * 8.8, h * 2)
    const { data } = await eng.recognize(grayToCanvas(eraseLargeShapes(cell, h * 0.8), 2))
    // Rightmost number = the column nearest the med (المطلوبة, not المنصرفة).
    const numbers = data.text.match(/[0-9]+/g) ?? []
    const qty = Number(numbers[numbers.length - 1])
    // Fallback when the main read lost the number: must be a confident 2–3 digit
    // number (a lone digit is usually a sliver of border).
    if (data.confidence >= 60 && qty >= 10 && qty <= 999) result.set(m.lineIndex, qty)
  }
  return result
}

export async function readCasePages(files: Blob[], onProgress?: Progress): Promise<PageRead[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  // Each page is read twice; the second read is ~2/3 the work of the first.
  const PASS_WEIGHT = [0.6, 0.4]
  let page = 0
  let pass = 0
  const pageLabel = () => (files.length > 1 ? ` page ${page + 1} of ${files.length}` : ' the sheet')
  const ara = await createWorker('ara', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status !== 'recognizing text') {
        onProgress?.(page / files.length, 'Loading the Arabic reader…')
        return
      }
      const done = pass === 0 ? m.progress * PASS_WEIGHT[0]! : PASS_WEIGHT[0]! + m.progress * PASS_WEIGHT[1]!
      onProgress?.((page + done * 0.95) / files.length, pass === 0 ? `Reading${pageLabel()}…` : `Double-checking${pageLabel()}…`)
    },
  })
  let eng: Worker | undefined
  const english = async () => (eng ??= await createWorker('eng'))
  try {
    const pages: PageRead[] = []
    for (; page < files.length; page++) {
      const gray = await toGray(files[page]!)
      pass = 0
      const first = await readLines(ara, gray, 1, PSM)
      const lineHeight = median(first.filter((l) => l.words.length >= 3).map((l) => l.bbox.y1 - l.bbox.y0)) || 24
      pass = 1
      const second = await readLines(ara, await toGray(files[page]!, SECOND_PASS_SCALE), SECOND_PASS_SCALE, PSM)
      const lines = mergePasses(first, second, lineHeight)
      const text = lines.map((l) => l.text).join('\n')

      onProgress?.((page + 0.95) / files.length, 'Checking card number, plan and quantities…')
      let starCard: string | undefined
      if (cardFromStars(text) || lines.some((l) => /\*/.test(l.text))) {
        const e = await english()
        await e.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789*' })
        starCard = await readStarCard(e, gray, lines, lineHeight)
      }
      const ovalText = await readOval(ara, gray, lines, lineHeight, PSM)

      // One form per page: a case-sheet line that lost its leading "اقراص"
      // parses like a ticket row, so go with the majority.
      const meds = parseCase(text).meds
      const ticket = meds.filter((m) => m.layout === 'ticket').length > meds.length / 2
      const qtyByLine = new Map<number, number>()
      if (ticket) {
        const e = await english()
        await e.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '0123456789' })
        for (const [line, qty] of await readTicketQty(e, gray, lines, meds)) qtyByLine.set(line, qty)
      } else {
        for (const [line, qty] of readQtyColumn(gray, lines, meds, lineHeight)) qtyByLine.set(line, qty)
      }
      pages.push({ text, starCard, ovalText, qtyByLine })
    }
    return pages
  } finally {
    await ara.terminate()
    await eng?.terminate()
  }
}
