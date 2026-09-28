import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SarfDB } from '../db/schema'
import { createCaseFromScan, unregisteredMeds } from '../db/scanCase'
import { importSeedIntoDb } from '../db/seedImport'
import type { Presentation, Product } from '../db/types'
import { matchPresentation, matchProduct } from './matchMed'
import { cardFromStars, mergePages, parseCase, planFromOval, quantityFor } from './parseCase'
import { crop } from './binarize'
import { quantityColumnSpan, readQuantities } from './quantities'
import QTY from './fixtures/qty-column.json'
// Real Tesseract output (ara) for a photographed bimonthly case sheet.
import OCR from './fixtures/case-sample.ocr.txt?raw'
import BROWSER_OCR from './fixtures/case-sample.browser.ocr.txt?raw'
import SEED from '../../seed/medications.csv?raw'
import TICKET from './fixtures/ticket.ocr.txt?raw'
import { mergePasses } from './passes'

describe('parseCase', () => {
  const parsed = parseCase(OCR)

  it('reads the patient, rank, card number and plan', () => {
    expect(parsed.name).toBe('هاله حموده الكردى')
    expect(parsed.rank).toBe('ح- لواء')
    expect(parsed.cardNumber).toMatch(/^1?19244$/)
    expect(parsed.plan).toBe('bimonthly')
  })

  it('finds every med line with its dosing frequency', () => {
    expect(parsed.meds.map((m) => m.name)).toEqual([
      'لانوكسين',
      'كونترولوك',
      'فاستاريل',
      'دياميكرون',
      'كونكور',
      'كريستور',
      'بلنديل',
      'ميلجا',
      'آدانكور',
      'كوتارج',
      'جلوكوفاج',
      'فورسيجا',
      'ايليكويس',
    ])
    // Quantities printed on the sheet: 60 for once daily, 120 for every 12 h.
    expect(parsed.meds.map((m) => quantityFor(m, 'bimonthly'))).toEqual([
      60, 60, 120, 60, 120, 60, 60, 60, 120, 60, 60, 60, 120,
    ])
  })

  it('reads MR/XR modifiers and un-reverses digit runs', () => {
    const byName = new Map(parsed.meds.map((m) => [m.name, m]))
    expect(byName.get('فاستاريل')).toMatchObject({ modifier: 'MR', strength: '35' })
    expect(byName.get('جلوكوفاج')?.modifier).toBe('XR')
    expect(byName.get('آدانكور')?.strength).toBe('10')
    expect(byName.get('فورسيجا')?.strength).toBe('10')
    expect(byName.get('كونترولوك')?.strength).toBeUndefined()
  })

  it('handles the in-browser read of the same sheet (اسم dropped, full card number)', () => {
    const browser = parseCase(BROWSER_OCR)
    expect(browser).toMatchObject({ name: 'هاله حموده الكردى', rank: 'ح- لواء', cardNumber: '119244', plan: 'bimonthly' })
    expect(browser.meds).toHaveLength(13)
  })

  it('returns no meds for unrelated text', () => {
    expect(parseCase('hello\nworld').meds).toEqual([])
  })
})

describe('matching against the seed database', () => {
  let db: SarfDB
  let products: Product[]
  let presentations: Presentation[]

  beforeAll(async () => {
    db = new SarfDB('scan-match')
    await importSeedIntoDb(db, SEED)
    products = await db.products.toArray()
    presentations = await db.presentations.toArray()
  })

  it('matches names despite hyphens, hamza and an extra ي', () => {
    expect(matchProduct('كوتارج', products)?.nameEn).toBe('Co-Tareg')
    expect(matchProduct('ايليكويس', products)?.nameEn).toBe('Eliquis')
    expect(matchProduct('آدانكور', products)?.nameEn).toBe('Adancor')
    expect(matchProduct('جلوكوفاج', products)?.nameEn).toBe('Glucophage')
    expect(matchProduct('ميلجا', products)).toBeUndefined()
    // Two letters off is a different drug (Fastel, Randil), not an OCR slip.
    expect(matchProduct('فاستاريل', products)).toBeUndefined()
    expect(matchProduct('بلنديل', products)).toBeUndefined()
  })

  it('picks the presentation by strength', () => {
    const concor = matchProduct('كونكور', products)!
    const pres = presentations.filter((p) => p.productId === concor.id)
    expect(matchPresentation('5', undefined, pres)?.strength).toBe('5 mg')
    expect(matchPresentation('01', undefined, pres)?.strength).toBe('10 mg')
    expect(matchPresentation(undefined, undefined, pres)).toBeUndefined()
  })
})

describe('createCaseFromScan', () => {
  let db: SarfDB
  let n = 0
  beforeEach(() => {
    db = new SarfDB(`scan-case-${n++}`)
  })

  it('creates the case and flags unknown meds and strengths as unregistered', async () => {
    const productId = (await db.products.add({ nameEn: 'Concor', nameAr: 'كونكور', categories: [], verified: true })) as number
    const known = (await db.presentations.add({ productId, strength: '5 mg', form: 'tablet', fridge: false, controlled: false })) as number

    const requestId = await createCaseFromScan(db, {
      cardNumber: '119244',
      name: 'هاله',
      rank: 'ح- لواء',
      plan: 'bimonthly',
      lines: [
        { kind: 'presentation', presentationId: known, qty: 120 },
        { kind: 'new-strength', productId, strength: '10 mg', form: 'tablet', qty: 60 },
        { kind: 'new-drug', nameAr: 'ميلجا', strength: '', form: 'tablet', qty: 60, sourceLine: 'اقراص ميلجا' },
      ],
    })

    const request = await db.requests.get(requestId)
    expect(request).toMatchObject({ plan: 'bimonthly', feePerItem: 10 })
    const items = await db.items.where('requestId').equals(requestId).toArray()
    expect(items.map((i) => i.qty)).toEqual([120, 60, 60])
    expect((await db.people.get(request!.personId))?.name).toBe('هاله')

    const list = await unregisteredMeds(db)
    expect(list.map((e) => e.product.nameAr).sort()).toEqual(['كونكور', 'ميلجا'].sort())
    const milga = list.find((e) => e.product.nameAr === 'ميلجا')!
    expect(milga.product.unregistered).toBe(true)
    expect(milga.product.notes).toContain('اقراص ميلجا')
    expect(list.find((e) => e.product.nameAr === 'كونكور')!.presentations.map((p) => p.strength)).toEqual(['10 mg'])
  })

  it('reuses a placeholder drug on the next scan instead of duplicating it', async () => {
    const line = { kind: 'new-drug' as const, nameAr: 'ميلجا', strength: '', form: 'tablet' as const, qty: 60 }
    await createCaseFromScan(db, { cardNumber: '1', plan: 'monthly', lines: [line] })
    await createCaseFromScan(db, { cardNumber: '2', plan: 'monthly', lines: [line] })
    expect(await db.products.count()).toBe(1)
    expect(await db.presentations.count()).toBe(1)
  })
})

describe('readQuantities', () => {
  // The fixture is the الكمية column with 10 px margins; the header word "الكمية" spans x 18–65.
  const full = { w: QTY.w, h: QTY.h, px: Uint8Array.from(atob(QTY.px), (c) => c.charCodeAt(0)) }
  const column = (hx0: number, hx1: number) => {
    const [left, right] = quantityColumnSpan(hx0, hx1)
    return crop(full, left, 0, right - left, full.h)
  }
  // Rows 9–10 are under the photographer's thumb.
  const truth = [60, 60, 120, 60, 120, 60, 60, 60, undefined, undefined, 60, 60, 120]

  it('reads the الكمية column of the sample sheet', () => {
    expect(readQuantities(column(18, 65), QTY.lineHeight, QTY.centers)).toEqual(truth)
  })

  it('never misreads when the header box or line height estimate shifts', () => {
    for (const [hx0, hx1] of [[16, 63], [18, 65], [20, 67], [15, 68], [21, 62]] as const) {
      for (const lineHeight of [22, 26, 32, 38]) {
        const qty = readQuantities(column(hx0, hx1), lineHeight, QTY.centers)
        // A cell may go unread (the app then estimates), but a read must be right.
        qty.forEach((q, i) => {
          if (q !== undefined) expect([hx0, lineHeight, i, q]).toEqual([hx0, lineHeight, i, truth[i]])
        })
        expect(qty.filter((q) => q !== undefined).length).toBeGreaterThanOrEqual(9)
      }
    }
  })
})

describe('mergePages', () => {
  it('reads the plan from the oval stamp over the med lines', () => {
    expect(planFromOval(['وزارة الدفاع', 'مرتب شهرين'].join('\n'))).toBe('bimonthly')
    expect(planFromOval('مرتب شهر')).toBe('monthly')
    expect(planFromOval('')).toBeUndefined()
    const merged = mergePages([{ text: OCR, ovalText: 'مرتب شهر' }])
    expect(merged).toMatchObject({ plan: 'monthly', planSource: 'oval' })
    expect(mergePages([{ text: OCR }])).toMatchObject({ plan: 'bimonthly', planSource: 'durations' })
  })

  it('prefers the starred card number and keeps both copies for the check', () => {
    const merged = mergePages([{ text: OCR, starCard: '119244' }])
    expect(merged.cardNumber).toBe('119244')
    expect(merged.cardFromStars).toBe('119244')
  })

  it('appends page 2 meds after page 1, with sheet quantities per page', () => {
    const page2 = ['الدواء الكمية العيادة ملاحظات', '١ اقراص ميلجا اقراص مرة فى اليوم عند الحاجة لمدة ١ شهر'].join('\n')
    const merged = mergePages([
      { text: OCR, starCard: '119244', qtyByLine: new Map([[parseCase(OCR).meds[0]!.lineIndex, 60]]) },
      { text: page2, starCard: '119244', qtyByLine: new Map([[1, 90]]) },
    ])
    expect(merged.meds).toHaveLength(14)
    expect(merged.meds[0]).toMatchObject({ page: 1, sheetQty: 60 })
    expect(merged.meds[1]!.sheetQty).toBeUndefined()
    expect(merged.meds[13]).toMatchObject({ name: 'ميلجا', page: 2, sheetQty: 90 })
    expect(merged.mismatchedPages).toEqual([])
    expect(merged.name).toBe('هاله حموده الكردى')
  })

  it('finds the card number when OCR drops the asterisks, but never the date or time', () => {
    expect(cardFromStars('| المرتبات العلاجية الشهرية (خاص بالمريض) 119244 نه\n| 18131 2026-09-26 10:31')).toBe('119244')
    expect(cardFromStars('المرتبات العلاجية الشهرية\n2026-09-26 10:31')).toBeUndefined()
    expect(cardFromStars('اسم المريض 12345678 خطأ')).toBeUndefined()
  })

  it('flags a page whose card number differs from page 1', () => {
    const merged = mergePages([
      { text: OCR, starCard: '119244' },
      { text: OCR, starCard: '555555' },
    ])
    expect(merged.mismatchedPages).toEqual([2])
  })
})

describe('pharmacy ticket (تذكرة طبية)', () => {
  it('finds the med rows: name first, then strength, unit and form', () => {
    const meds = parseCase(TICKET).meds
    expect(meds.map((m) => m.name)).toEqual(['أسينيمت', 'رامكسول', 'بلادوجرا', 'أسوفيناسين', 'ايافلوزيميت'])
    expect(meds.every((m) => m.layout === 'ticket')).toBe(true)
    // "| 20" survived OCR on the first row only.
    expect(meds[0]!.qtyInLine).toBe(20)
    expect(meds.find((m) => m.name === 'أسوفيناسين')!.strength).toBe('10')
  })

  it('matches names despite a border read as a leading alef', async () => {
    const products = [{ id: 1, nameEn: 'Sinemet', nameAr: 'سينيميت', categories: [], verified: true }]
    expect(matchProduct('أسينيمت', products)?.nameEn).toBe('Sinemet')
  })

  it('does not take form labels or header noise for meds', () => {
    for (const noise of ['8 2 الصيدليهة 7', 'وزارة الدفاع', 'ل - اي النضعة مم 0', 'الاج جل 557']) {
      expect(parseCase(noise).meds).toEqual([])
    }
  })

  it('reads the requested quantity through border marks stuck to it', () => {
    const qty = (line: string) => parseCase(line).meds[0]?.qtyInLine
    expect(qty('١ 3 بلادوجرا 5٠ مجم 1.20 ق] 1')).toBe(20)
    expect(qty('3 بلادوجرا 5٠ مجم #20 ]')).toBe(20)
    expect(qty('2 رامكسول ١ مجم | ٍ')).toBeUndefined()
  })

  it('keeps case-sheet rows that lost their leading اقراص', () => {
    const name = (line: string) => parseCase(line).meds[0]?.name
    expect(name('ا جلوكوفاج ٠ اكس آر اقراص مرة فى اليوم عند الحاجة')).toBe('جلوكوفاج')
    expect(name('اذ فورسيجا ١٠.مم مرة فى اليوم عند الحاجة لمدة ١ شهر')).toBe('فورسيجا')
  })
})

describe('mergePasses', () => {
  const line = (text: string, y: number) => ({ text, bbox: { x0: 0, y0: y, x1: 100, y1: y + 20 }, words: [] })

  it('adds med rows only the second read found, in page order, without duplicates', () => {
    const first = [line('اسم المريض ح- لواء / هاله', 0), line('١ اقراص لانوكسين ١ مجم', 100), line('١ اقراص كونكور ٥ مجم', 200)]
    const second = [
      line('١ اقراص لانوكسن ١ مجم', 102), // same row, misread: skip
      line('١ اقراص ميلجا اقراص مرة', 150), // only here: add
      line('١ اقراص كونكور ٥ مجم', 260), // same drug elsewhere: skip
    ]
    const merged = mergePasses(first, second, 25)
    expect(merged.map((l) => l.text)).toEqual([first[0]!.text, first[1]!.text, second[1]!.text, first[2]!.text])
  })

  it('recovers the patient line when the first read lost it', () => {
    const merged = mergePasses([line('١ اقراص لانوكسين ١ مجم', 100)], [line('اسم المريض ح- لواء / هاله', 0)], 25)
    expect(parseCase(merged.map((l) => l.text).join('\n')).name).toBe('هاله')
  })
})
