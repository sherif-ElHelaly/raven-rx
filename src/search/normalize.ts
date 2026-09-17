// Arabic + Latin text normalization for search — VISION.md §5.1:
// أ/إ/آ → ا, ة ↔ ه, ى ↔ ي, strip vowel marks (tashkeel) and tatweel.

const ALEF_VARIANTS = /[أإآ]/g
const TAA_MARBUTA = /ة/g
const ALEF_MAKSURA = /ى/g
// Tashkeel (harakat, tanwin, sukun, shadda) + tatweel.
const DIACRITICS_AND_TATWEEL = /[ؐ-ًؚ-ٰٟـ]/g

export function normalizeArabic(text: string): string {
  return text
    .replace(ALEF_VARIANTS, 'ا')
    .replace(TAA_MARBUTA, 'ه')
    .replace(ALEF_MAKSURA, 'ي')
    .replace(DIACRITICS_AND_TATWEEL, '')
}

export function normalizeText(text: string): string {
  return normalizeArabic(text.toLowerCase().trim()).replace(/\s+/g, ' ')
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(WORD_SPLIT)
    .filter((w) => w.length > 0)
}
