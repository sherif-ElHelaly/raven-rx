import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvRecords } from './csv'

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']])
  })

  it('handles quoted newlines within a field', () => {
    expect(parseCsv('a,b\n"line1\nline2",z')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'z'],
    ])
  })

  it('strips a leading BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles a file with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseCsvRecords', () => {
  it('maps rows to objects keyed by header', () => {
    expect(parseCsvRecords('brand_en,strength\nTareg,80 mg')).toEqual([
      { brand_en: 'Tareg', strength: '80 mg' },
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(parseCsvRecords('')).toEqual([])
  })
})
