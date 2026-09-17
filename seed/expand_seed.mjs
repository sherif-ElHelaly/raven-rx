#!/usr/bin/env node
// Phase 4 — script-assisted database growth (VISION.md §9).
// Drafts candidate medications.csv rows for a list of brands/topics by asking the
// local `claude -p` CLI (subscription-backed, never a paid API key) to research
// each one. Output is a DRAFT file for human review + CSV import — it never
// touches seed/medications.csv directly, and every row is forced to
// confidence=medium so it imports as unverified until a human checks it.
//
// Usage:
//   node seed/expand_seed.mjs --input seed/expand/sources.txt [--out seed/expand/draft.csv] [--limit N]

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const HEADER =
  'brand_en,brand_ar,ingredients,strength,form,pack_size,manufacturer,categories,drug_class,use_en,fridge,controlled,confidence,source'

const ALLOWED_FORMS = new Set(
  `tablet,film-coated tablet,extended-release tablet,chewable tablet,effervescent tablet,
orally disintegrating tablet,sublingual tablet,capsule,extended-release capsule,sachet,
powder for oral suspension,syrup,suspension,oral solution,oral drops,injection,
eye drops,eye ointment,eye gel,ear drops,nasal spray,nasal drops,inhaler,
dry powder inhaler,nebulizer solution,cream,ointment,gel,lotion,topical solution,
spray,shampoo,suppository,vaginal suppository,vaginal cream,patch,lozenge,
mouthwash,oral gel,enema`
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean),
)

const ALLOWED_CATEGORIES = new Set(
  `cardiac,anticoagulant,lipid,antidiabetic,endocrine,gastric,hepatic,antibiotic,
antifungal,antiviral,antiparasitic,analgesic,anti-inflammatory,musculoskeletal,
respiratory,allergy,cold-flu,psychiatric,neurology,ophthalmic,ent,dermatology,
vitamins-supplements,hematology,urology,womens-health,corticosteroid,oral-dental`
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean),
)

function parseArgs(argv) {
  const args = { input: 'seed/expand/sources.txt', out: null, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input') args.input = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--limit') args.limit = Number(argv[++i])
    else if (a === '--dry-run') args.dryRun = true
  }
  return args
}

// Minimal RFC4180-ish line splitter (handles quoted fields containing commas).
function splitCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else cur += c
  }
  fields.push(cur)
  return fields.map((f) => f.trim())
}

function csvField(value) {
  const v = String(value ?? '')
  return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function loadExistingKeys(medicationsCsvPath) {
  const keys = new Set()
  if (!existsSync(medicationsCsvPath)) return keys
  const lines = readFileSync(medicationsCsvPath, 'utf8').split('\n').slice(1)
  for (const line of lines) {
    if (!line.trim()) continue
    const [brand_en, , , strength, form] = splitCsvLine(line)
    keys.add(`${brand_en.toLowerCase()}|${strength.toLowerCase()}|${form.toLowerCase()}`)
  }
  return keys
}

function buildPrompt(topic) {
  return `You are drafting rows for a personal Egyptian pharmacy reference database. Research the following brand or topic as marketed in Egypt: "${topic}".

Output ONLY raw CSV data rows (no header, no markdown code fences, no commentary, no numbering) in EXACTLY this column order:
${HEADER}

Rules:
- One row per distinct strength/form (presentation) actually sold in Egypt under this brand/topic.
- ingredients: lowercase INN generic name(s), ;-separated, salt-free unless the salt defines the product.
- strength: amounts in ingredient order, separated by / if combination, e.g. "80/12.5 mg".
- form: must be exactly one of: ${[...ALLOWED_FORMS].join(', ')}
- categories: 1-3 values from: ${[...ALLOWED_CATEGORIES].join(', ')}, ;-separated.
- fridge/controlled: "yes" or "no".
- confidence: "high" only if you are citing a real, specific Egyptian pharmacy-listing URL you are confident exists; otherwise "medium". Never write "low" — omit the row instead.
- source: the URL if confidence is high, else leave blank. Do not invent URLs.
- If you cannot find real information for this topic, output nothing at all.
- If a field would contain a comma or quote, wrap it in double quotes per RFC 4180.

Output nothing but the CSV rows.`
}

function runClaude(prompt) {
  const result = spawnSync('claude', ['-p', prompt], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`  claude -p exited ${result.status}: ${result.stderr?.slice(0, 500)}`)
    return ''
  }
  return result.stdout ?? ''
}

function validateRow(fields, topic) {
  if (fields.length !== 14) return { ok: false, reason: `expected 14 columns, got ${fields.length}` }
  const [brand_en, brand_ar, ingredients, strength, form, , , categories] = fields
  if (!brand_en || !ingredients || !strength) return { ok: false, reason: 'missing brand/ingredients/strength' }
  if (!brand_ar) return { ok: false, reason: 'missing brand_ar' }
  if (!ALLOWED_FORMS.has(form)) return { ok: false, reason: `form "${form}" not in allowed list` }
  const cats = categories.split(';').map((c) => c.trim()).filter(Boolean)
  if (cats.length === 0 || cats.some((c) => !ALLOWED_CATEGORIES.has(c)))
    return { ok: false, reason: `categories "${categories}" invalid` }
  return { ok: true }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = resolve(args.input)
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`)
    console.error('Create it with one brand/topic per line (# comments allowed), e.g. seed/expand/sources.example.txt')
    process.exit(1)
  }

  const topics = readFileSync(inputPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .slice(0, args.limit)

  if (topics.length === 0) {
    console.error('No topics to process (input file is empty after filtering comments).')
    process.exit(1)
  }

  const existingKeys = loadExistingKeys(resolve('seed/medications.csv'))
  const outPath = resolve(args.out || `seed/expand/draft-${new Date().toISOString().slice(0, 10)}.csv`)
  mkdirSync(dirname(outPath), { recursive: true })

  const keptRows = []
  let requested = 0
  let dropped = 0
  let duplicates = 0

  for (const topic of topics) {
    console.log(`\n[${topics.indexOf(topic) + 1}/${topics.length}] ${topic}`)
    if (args.dryRun) {
      console.log('  (dry run — skipping claude call)')
      continue
    }
    const stdout = runClaude(buildPrompt(topic))
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const line of lines) {
      requested++
      const fields = splitCsvLine(line)
      const check = validateRow(fields, topic)
      if (!check.ok) {
        console.log(`  ✗ dropped (${check.reason}): ${line.slice(0, 80)}`)
        dropped++
        continue
      }
      const [brand_en, , , strength, form] = fields
      const key = `${brand_en.toLowerCase()}|${strength.toLowerCase()}|${form.toLowerCase()}`
      if (existingKeys.has(key)) {
        console.log(`  ~ duplicate, skipped: ${brand_en} ${strength} ${form}`)
        duplicates++
        continue
      }
      existingKeys.add(key)
      // Force confidence=medium regardless of the model's claim: unsupervised
      // output never ships as verified (VISION.md §9, Phase 4).
      fields[12] = 'medium'
      keptRows.push(fields.map(csvField).join(','))
      console.log(`  ✓ ${brand_en} ${strength} ${form}`)
    }
  }

  if (keptRows.length > 0) {
    writeFileSync(outPath, [HEADER, ...keptRows].join('\n') + '\n', 'utf8')
  }

  console.log(`\n--- Summary ---`)
  console.log(`Topics processed : ${topics.length}`)
  console.log(`Rows proposed    : ${requested}`)
  console.log(`Rows kept        : ${keptRows.length}`)
  console.log(`Rows dropped     : ${dropped}`)
  console.log(`Duplicates       : ${duplicates}`)
  if (keptRows.length > 0) {
    console.log(`\nDraft written to: ${outPath}`)
    console.log('Review it, then import via Settings → Import CSV in the app (preview diff before applying).')
  } else {
    console.log('\nNo rows kept — nothing written.')
  }
}

main()
