import { describe, expect, it } from 'vitest'
import { normalizeArabic, normalizeText, tokenize } from './normalize'

describe('normalizeArabic', () => {
  it('folds alef variants to bare alef', () => {
    expect(normalizeArabic('أحمد إبراهيم آدم')).toBe('احمد ابراهيم ادم')
  })

  it('folds taa marbuta to haa', () => {
    expect(normalizeArabic('كونترولوكة')).toBe('كونترولوكه')
  })

  it('folds alef maksura to yaa', () => {
    expect(normalizeArabic('مستشفى')).toBe('مستشفي')
  })

  it('strips tashkeel and tatweel', () => {
    expect(normalizeArabic('تَـارِج')).toBe('تارج')
  })
})

describe('normalizeText', () => {
  it('lowercases Latin text', () => {
    expect(normalizeText('Controlock')).toBe('controlock')
  })

  it('collapses repeated whitespace', () => {
    expect(normalizeText('  Co   Tareg  ')).toBe('co tareg')
  })
})

describe('tokenize', () => {
  it('splits on punctuation and whitespace', () => {
    expect(tokenize('Co-Tareg 80/12.5 mg')).toEqual([
      'co',
      'tareg',
      '80',
      '12',
      '5',
      'mg',
    ])
  })

  it('drops empty tokens', () => {
    expect(tokenize('  ')).toEqual([])
  })
})
