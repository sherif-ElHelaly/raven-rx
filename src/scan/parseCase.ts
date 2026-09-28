// Turns OCR text of a hospital "المرتبات العلاجية" sheet into a draft case.
// OCR is unreliable on Arabic-Indic digits (often reversed or dropped), so
// every number here is a best guess the user confirms on the review screen.

import type { Form, Plan } from '../db/types'

export interface ParsedMed {
  // Brand name as read from the sheet (Arabic).
  name: string
  // "MR", "XR"… when the sheet says ام آر / اكس آر.
  modifier?: string
  // Digits as read ("10", "0.25"); may be garbled.
  strength?: string
  form: Form
  perDay?: number
  line: string
  // Index of the source line in the OCR text (links it to its الكمية cell).
  lineIndex: number
  // Which form the line came from: case sheet or pharmacy ticket.
  layout: 'sheet' | 'ticket'
  // Ticket rows: a Latin quantity after the med text ("… اقراص | 20"), if OCR kept it.
  qtyInLine?: number
}

export interface ParsedCase {
  cardNumber?: string
  // The same number twice on the sheet: "رقم الحاسب ١١٩٢٤٤" and "*119244*".
  cardFromLabel?: string
  cardFromStars?: string
  name?: string
  rank?: string
  plan?: Plan
  meds: ParsedMed[]
}

const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/[٫,]/g, '.')
}

// Dosage-form word that opens each med line → the app's form value.
const FORM_WORDS: [RegExp, Form][] = [
  [/^[اأإ]قراص$/, 'tablet'],
  [/^قرص$/, 'tablet'],
  [/^كبسول(ه|ة|ات)?$/, 'capsule'],
  [/^شراب$/, 'syrup'],
  [/^معلق$/, 'suspension'],
  [/^(حقن|حقنه|حقنة|[اأ]مبول(ات)?)$/, 'injection'],
  [/^(قطره|قطرة|نقط)$/, 'eye drops'],
  [/^(مرهم)$/, 'ointment'],
  [/^(كريم)$/, 'cream'],
  [/^(جل)$/, 'gel'],
  [/^(بخاخ)$/, 'inhaler'],
  [/^([اأ]كياس|فوار)$/, 'sachet'],
  [/^(لبوس|تحاميل)$/, 'suppository'],
  [/^(لصقات|لصقه|لصقة)$/, 'patch'],
]

// Words that end the brand name: release modifiers, units, dosing words.
const MODIFIER_WORDS: Record<string, string> = { ام: 'M', اكس: 'X', اس: 'S', دى: 'D', دي: 'D' }
const RELEASE_SUFFIX = /^[اآ]ر$/
const NAME_STOP = /^(مجم|مم|مل|جم|ملجم|ميكروجرام|وحده|وحدة|[اأ]قراص|مره|مرة|كل|عند|لمده|لمدة|فى|في)$/
const ARABIC_WORD = /^[ء-ي-]+$/

function formFor(word: string): Form | undefined {
  return FORM_WORDS.find(([re]) => re.test(word))?.[1]
}

function parsePerDay(line: string): number | undefined {
  if (/مرتين/.test(line)) return 2
  if (/(ثلاث|3)\s*مرات/.test(line)) return 3
  if (/مر[ةه]\s*(فى|في)?\s*اليوم|مر[ةه]\s*يومي/.test(line)) return 1
  const every = line.match(/كل\s*([0-9]*)\s*ساع/)
  if (every) {
    const hours = Number(every[1])
    const reversed = Number([...(every[1] ?? '')].reverse().join(''))
    for (const h of [hours, reversed]) {
      if ([6, 8, 12, 24].includes(h)) return 24 / h
    }
    // The hour digits are the least legible part of the line; كل ١٢ ساعة is by far the most common.
    return 2
  }
  return undefined
}

// "0"/"00" is a lost digit run; "01" is a reversed "10" (no strength starts with 0 unless it's 0.x).
function cleanStrength(s: string): string | undefined {
  if (!/[1-9]/.test(s)) return undefined
  if (/^0[0-9]+$/.test(s)) return [...s].reverse().join('').replace(/^0+/, '')
  return s
}

const UNIT = /^(مجم|مم|مل|جم|ملجم|ميكروجرام)$/
// Numbers as OCR returns them: digits with / . , + and stray marks.
const NUMBERISH = /^[.+]?[0-9][0-9./,+]*[.]?$/
// Long words that appear on the forms but are never drug names.
const NOT_A_DRUG = /^(ال[اإ]جمالي|المستخدم|الطبيب|طبيب|العياده|العيادة|عياده|عيادة|الصيدليه|الصيدلية|المريض|التذكره|التذكرة|الحاجه|الحاجة|القلب|المطلوبه|المطلوبة|المنصرفه|المنصرفة|الكميه|الكمية|الدواء|الخارجيه|الخارجية|استقبال|توقيع)$/

const isNameWord = (w: string) => ARABIC_WORD.test(w) && !NAME_STOP.test(w) && !formFor(w) && !NOT_A_DRUG.test(w)

// Strength/modifier/per-day details that follow the name.
function details(words: string[], from: number) {
  let modifier: string | undefined
  let strength: string | undefined
  for (let j = from; j < Math.min(words.length, from + 6); j++) {
    const w = words[j]!
    const letter = MODIFIER_WORDS[w]
    if (letter && RELEASE_SUFFIX.test(words[j + 1] ?? '')) modifier = `${letter}R`
    const num = w.match(/^[0-9]+(?:[./][0-9]+)*/)
    if (!strength && num) strength = cleanStrength(num[0].replace(/\.$/, ''))
    if (NAME_STOP.test(w) && !UNIT.test(w)) break
    if (UNIT.test(w)) break
  }
  return { modifier, strength }
}

// Two layouts:
// - Case sheet (المرتبات العلاجية): "١ اقراص لانوكسين ٠,٢٥ مجم اقراص مرة فى اليوم…"
// - Pharmacy ticket (تذكرة طبية): "١ سينيمت ٢٥٠/٢٥ مجم اقراص  20"
function parseMedLine(raw: string, lineIndex: number): ParsedMed | undefined {
  const line = toLatinDigits(raw)
  const words = line.split(/\s+/).filter(Boolean)
  const base = { perDay: parsePerDay(line), line: raw.trim(), lineIndex }

  // Case sheet: form word, then the name, then a number/unit/modifier/dosing word.
  const formIdx = words.findIndex((w) => formFor(w))
  if (formIdx >= 0) {
    const nameWords: string[] = []
    let i = formIdx + 1
    for (; i < words.length && isNameWord(words[i]!) && !MODIFIER_WORDS[words[i]!] && !RELEASE_SUFFIX.test(words[i]!); i++) {
      nameWords.push(words[i]!)
    }
    const next = words[i] ?? ''
    // A number (OCR turns ٥ into ©, ٠ into +), a unit or dosing word, or a modifier.
    const endsWell = /^[0-9]/.test(next) || (next !== '' && !/[ء-ي]/.test(next)) || NAME_STOP.test(next) || !!MODIFIER_WORDS[next]
    if (nameWords.join('').length >= 3 && endsWell) {
      return { name: nameWords.join(' '), ...details(words, i), form: formFor(words[formIdx]!)!, layout: 'sheet', ...base }
    }
  }

  // Ticket: a name word followed (through strength numbers) by a unit or form
  // word, or a row serial followed by a long name word.
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (!isNameWord(w) || w.replace(/-/g, '').length < 4) continue
    let j = i + 1
    while (j < words.length && NUMBERISH.test(words[j]!)) j++
    const next = words[j] ?? ''
    // What follows a drug name: a unit or form ("مجم", "اقراص"), a unit glued to
    // its number ("10.مم"), a release modifier ("اكس آر"), or dosing ("مرة", "كل").
    const unitFollows =
      j < words.length &&
      j <= i + 3 &&
      // A bare unit/form needs a strength before it: "النضعة مم", "الاج جل" are header noise.
      (((UNIT.test(next) || !!formFor(next)) && j > i + 1) ||
        /^[0-9][0-9.,/]*(مجم|مم|مل|جم)$/.test(next) ||
        (!!MODIFIER_WORDS[next] && RELEASE_SUFFIX.test(words[j + 1] ?? '')) ||
        /^(مر[ةه]|مرتين|كل)$/.test(next))
    // (Without a unit to vouch for it, an ال- word is a form label, not a brand.)
    const serialBefore =
      i > 0 && words.slice(0, i).every((x) => /^[0-9]{1,2}$/.test(x)) && w.length >= 5 && !w.startsWith('ال')
    if (!unitFollows && !serialBefore) continue
    const form = words.slice(i).map((x) => formFor(x)).find(Boolean) ?? 'tablet'
    // Latin digits only (the raw line): Arabic-Indic numbers there are the strength.
    const unitAt = words.findIndex((x, k) => k > i && (UNIT.test(x) || !!formFor(x)))
    const tail = unitAt > 0 ? raw.split(/\s+/).slice(unitAt + 1).join(' ') : ''
    // First number after the med text is المطلوبة (the next one is المنصرفة).
    // Borders stick to it as "1.20", "#20", "|20".
    const qtyInLine = Number(tail.match(/(?:^|[\s|#.])([1-9][0-9]{0,2})(?=\s|$|[\]|])/)?.[1]) || undefined
    return { name: w, ...details(words, i + 1), form, layout: 'ticket', qtyInLine, ...base }
  }
  return undefined
}

// OCR sometimes drops "اسم", so key on المريض — but not the "خاص بالمريض" title.
const PATIENT_LINE = /(^|[^ء-ي])المريض/

function parsePatient(line: string): { name?: string; rank?: string } {
  const after = line.split(PATIENT_LINE).pop() ?? ''
  const cleaned = after.replace(/[^ء-ي\s/-]/g, ' ').replace(/\s+/g, ' ').trim()
  const slash = cleaned.lastIndexOf('/')
  if (slash < 0) return { name: cleaned || undefined }
  const rank = cleaned.slice(0, slash).trim()
  const name = cleaned.slice(slash + 1).trim()
  return { name: name || undefined, rank: rank || undefined }
}

function cardFromLabel(lines: string[]): string | undefined {
  for (const l of lines) {
    if (/رقم\s*الحاسب/.test(l)) {
      const m = toLatinDigits(l).match(/[0-9]{4,}/)
      if (m) return m[0]
    }
  }
  return undefined
}

// "*119244*" at the top left, printed in Latin digits. OCR sometimes drops the
// asterisks, so a bare 5–8 digit Latin number on the title line counts too (the
// only other Latin numbers there are the date and time, which have - and :).
export function cardFromStars(text: string): string | undefined {
  const starred = text.match(/\*\s*([0-9]{5,8})\s*\*?|([0-9]{5,8})\s*\*/)
  if (starred) return starred[1] ?? starred[2]
  const title = text.split(/\r?\n/).find((l) => /المرتبات|العلاجية|بالمريض/.test(l))
  return title?.match(/(?<![0-9:-])([0-9]{5,8})(?![0-9:-])/)?.[1]
}

// شهرين anywhere wins. Otherwise vote on "لمدة N شهر": ٢ is often read as ؟,
// ١ is read reliably as ١ — but ٢ is also misread as ١, so any 2-vote wins.
function parsePlan(text: string): Plan | undefined {
  if (/شهرين/.test(text)) return 'bimonthly'
  const durations = [...toLatinDigits(text).matchAll(/لمد[ةه]\s*(\S+)\s*(شهر|اشهر)/g)].map((m) => m[1])
  if (durations.some((d) => d === '2' || d === '؟' || d === '?')) return 'bimonthly'
  if (durations.length > 0) return 'monthly'
  return undefined
}

// The oval stamp: "مرتب شهرين" (two months) or "مرتب شهر" (one month).
export function planFromOval(text: string | undefined): Plan | undefined {
  if (!text) return undefined
  if (/شهرين/.test(text)) return 'bimonthly'
  if (/مرتب\s*شهر/.test(text)) return 'monthly'
  return undefined
}

export function parseCase(ocrText: string): ParsedCase {
  const text = ocrText.replace(BIDI_MARKS, '')
  const lines = text.split(/\r?\n/)
  const patientLine = lines.find((l) => PATIENT_LINE.test(l))
  const patient = patientLine ? parsePatient(patientLine) : {}

  const meds: ParsedMed[] = []
  lines.forEach((l, i) => {
    if (PATIENT_LINE.test(l) || /العائل|الدواء\s*الكمية/.test(l)) return
    const med = parseMedLine(l, i)
    if (med) meds.push(med)
  })

  const label = cardFromLabel(lines)
  const stars = cardFromStars(text)
  return {
    // The starred number is printed in Latin digits, which OCR reads far better.
    cardNumber: stars ?? label,
    cardFromLabel: label,
    cardFromStars: stars,
    name: patient.name,
    rank: patient.rank,
    plan: parsePlan(text),
    meds,
  }
}

// Sheet quantity: doses per day × 30 days × months on the plan.
export function quantityFor(med: ParsedMed, plan: Plan): number {
  const months = plan === 'bimonthly' ? 2 : 1
  return (med.perDay ?? 1) * 30 * months
}

// What the OCR step extracts from one photographed page.
export interface PageRead {
  text: string
  // "*119244*" re-read from a tight crop with the English model.
  starCard?: string
  // Text found inside the oval stamp.
  ovalText?: string
  // الكمية cell per OCR line index, where it could be read.
  qtyByLine?: Map<number, number>
}

export interface ScannedMed extends ParsedMed {
  page: number
  // Quantity printed in the الكمية column, when it could be read.
  sheetQty?: number
}

export interface ScanResult {
  name?: string
  rank?: string
  plan?: Plan
  planSource?: 'oval' | 'durations'
  cardNumber?: string
  // Both copies of the card number, for the confirmation check.
  cardFromStars?: string
  cardFromLabel?: string
  // Later pages whose card number differs from page 1's (wrong sheet?).
  mismatchedPages: number[]
  meds: ScannedMed[]
}

// Pages in order: header details from the first page that has them, meds
// appended page by page.
export function mergePages(pages: PageRead[]): ScanResult {
  const parsed = pages.map((p) => parseCase(p.text))
  const starCards = pages.map((p, i) => p.starCard ?? parsed[i]!.cardFromStars)
  const cards = starCards.map((c, i) => c ?? parsed[i]!.cardFromLabel)
  const first = <K extends keyof ParsedCase>(key: K) => parsed.find((c) => c[key] !== undefined)?.[key]

  const ovalPlan = pages.map((p) => planFromOval(p.ovalText)).find(Boolean)
  const linePlan = first('plan')
  const stars = starCards.find(Boolean)
  const firstCard = cards.find(Boolean)

  return {
    name: first('name'),
    rank: first('rank'),
    plan: ovalPlan ?? linePlan,
    planSource: ovalPlan ? 'oval' : linePlan ? 'durations' : undefined,
    cardNumber: firstCard,
    cardFromStars: stars,
    cardFromLabel: first('cardFromLabel'),
    // Only the Latin-digit copies are reliable enough to compare.
    mismatchedPages: starCards.flatMap((c, i) => (i > 0 && c && stars && c !== stars ? [i + 1] : [])),
    meds: parsed.flatMap((c, i) =>
      c.meds.map((m) => ({ ...m, page: i + 1, sheetQty: pages[i]!.qtyByLine?.get(m.lineIndex) })),
    ),
  }
}
