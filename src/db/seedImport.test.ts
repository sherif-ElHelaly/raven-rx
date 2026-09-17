import { describe, expect, it } from 'vitest'
import { buildImportPlan, parseSeedCsv } from './seedImport'

const HEADER =
  'brand_en,brand_ar,ingredients,strength,form,pack_size,manufacturer,categories,drug_class,use_en,fridge,controlled,confidence,source'

const CSV = [
  HEADER,
  'Tareg,تارج,valsartan,40 mg,film-coated tablet,28 tablets,Novartis,cardiac,angiotensin receptor blocker,high blood pressure,no,no,high,https://example.com/tareg-40',
  'Tareg,تارج,valsartan,80 mg,film-coated tablet,28 tablets,Novartis,cardiac,angiotensin receptor blocker,high blood pressure,no,no,high,https://example.com/tareg-80',
  'Co-Tareg,كو-تارج,valsartan;hydrochlorothiazide,80/12.5 mg,film-coated tablet,28 tablets,Novartis,cardiac,angiotensin receptor blocker + thiazide diuretic,high blood pressure,no,no,high,',
  'Controloc,كونترولوك,pantoprazole,40 mg,injection,1 vial,Takeda,gastric,proton pump inhibitor,stomach acid,yes,no,medium,',
].join('\n')

describe('parseSeedCsv', () => {
  it('splits multi-value fields and coerces yes/no flags', () => {
    const rows = parseSeedCsv(CSV)
    expect(rows).toHaveLength(4)
    expect(rows[2].ingredients).toEqual(['valsartan', 'hydrochlorothiazide'])
    expect(rows[3].fridge).toBe(true)
    expect(rows[0].fridge).toBe(false)
    expect(rows[3].confidence).toBe('medium')
    expect(rows[0].confidence).toBe('high')
  })
})

describe('buildImportPlan', () => {
  it('collapses rows with the same brand into one product', () => {
    const plan = buildImportPlan(parseSeedCsv(CSV))
    expect(plan.products.map((p) => p.nameEn)).toEqual([
      'Tareg',
      'Co-Tareg',
      'Controloc',
    ])
  })

  it('creates one presentation per row', () => {
    const plan = buildImportPlan(parseSeedCsv(CSV))
    expect(plan.presentations).toHaveLength(4)
    expect(plan.presentations[0].strength).toBe('40 mg')
    expect(plan.presentations[1].strength).toBe('80 mg')
  })

  it('dedupes ingredients shared across products', () => {
    const plan = buildImportPlan(parseSeedCsv(CSV))
    const names = plan.ingredients.map((i) => i.nameEn)
    expect(names).toEqual(['valsartan', 'hydrochlorothiazide', 'pantoprazole'])
  })

  it('links each product to its ingredient set without duplicates', () => {
    const plan = buildImportPlan(parseSeedCsv(CSV))
    // Tareg (product 0) appears in two rows but shares the same single
    // ingredient, so it should only get one productIngredient link.
    const taregLinks = plan.productIngredients.filter(
      (pi) => pi.productIndex === 0,
    )
    expect(taregLinks).toHaveLength(1)

    const coTaregLinks = plan.productIngredients.filter(
      (pi) => pi.productIndex === 1,
    )
    expect(coTaregLinks).toHaveLength(2)
  })

  it('marks high-confidence rows verified and medium ones unverified', () => {
    const plan = buildImportPlan(parseSeedCsv(CSV))
    expect(plan.products.find((p) => p.nameEn === 'Tareg')?.verified).toBe(
      true,
    )
    expect(
      plan.products.find((p) => p.nameEn === 'Controloc')?.verified,
    ).toBe(false)
  })
})
