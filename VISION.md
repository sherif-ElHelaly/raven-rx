# VISION — Raven Rx: Personal Pharmacy Registration & Reference App

> Name: **Raven Rx** (final, chosen 2026-09-17; formerly working name SARF / صرف)
> Status: spec approved 2026-09-17 · seed database built (1,105 presentations / 793 brands, see §8) · **Phase 0 complete** (2026-09-17) · **Phase 1 complete** (2026-09-17) · **Phase 2 complete** (2026-09-17) · **Phase 3 complete** (2026-09-17) · **Phase 4 complete** (2026-09-17).

---

## 1. Context

A strictly personal iPhone tool for a commander's pharmacist at a military hospital complex. The user is a dentist doing military service with no pharmacology background, learning pharmacy work on the job. The app combines:

1. **A medication reference** built around local Egyptian brand names, with safe substitution guidance.
2. **A request tracker** for the registration → approval → sourcing → handover workflow, including money fronted by the user.

**Hard constraints**
- Single user, no accounts, no login, no backend.
- All data stored on the device, works fully **offline**.
- Feels native on iPhone: fast, few taps, usable under time pressure.
- Zero running cost: free static hosting, no paid APIs.

---

## 2. The real-world workflow

1. Receive a military ID card number (high-profile personnel).
2. Register the card with the hospital registry.
3. Get approval from the head of pharmacies.
4. Pay a fee **per medication**: **5 EGP** (monthly plan) or **10 EGP** (bimonthly plan). The fee depends on the plan chosen for that request, never on the drug.
5. Search the hospital pharmacies by brand name. If it's not there, look for a substitute.
6. If no on-site pharmacy has it, **transfer** it to another location (civilian pharmacy, hospital storage, psychiatric hospital, …). For civilian pharmacies the user hands over a **transfer slip** saying the hospital will pay. The user pays nothing extra.
7. Once gathered, hand the medications to the person and **collect back the fees** paid upfront.
8. Monthly and bimonthly plans **repeat**: the same person comes back on a cycle.

---

## 3. Core data model

```
Person ──< Request ──< Item >── Presentation >── Product ──< ProductIngredient >── Ingredient
                        │
                        └──> Location (found at / transferred to)
```

### Person
| Field | Notes |
|---|---|
| id | |
| cardNumber | unique, numeric input |
| name, rank, unit | optional |
| phone | optional, tap to call |
| notes | |
| regularMeds | list of presentationIds + qty, used by Renew |

### Request (one registration trip for one person)
| Field | Notes |
|---|---|
| id, personId | |
| createdAt | |
| plan | `monthly` or `bimonthly` |
| feePerItem | derived from plan: 5 or 10 EGP, stored at creation |
| registered, approved, paid | three independent checkboxes with timestamps (approval can stall on its own) |
| notes | |
| nextDueDate | derived: createdAt + 1 or 2 months |

### Item (one medication within a request)
| Field | Notes |
|---|---|
| id, requestId | |
| presentationId | the specific strength/form requested |
| qty | |
| substitutedWithId | optional: the presentation actually given, if a substitute was used |
| status | see §4 |
| foundAtLocationId | where it was actually obtained |
| transferToLocationId | set when transferred |
| transferSlipRef | optional slip number or note |
| deliveredAt | |
| feeRefunded | bool + timestamp (tracked separately from delivery) |
| statusHistory | [{status, at, locationId?}], used for "last found" and undo |

### Product (brand, e.g. "Tareg")
| Field | Notes |
|---|---|
| id | |
| nameEn, nameAr | |
| aliases | alternate spellings for search |
| manufacturer | optional |
| categories | multi-tag (cardiac, GI, antibiotic, psychiatric, respiratory, antidiabetic, ophthalmic, …) |
| photo | fallback when a presentation has no photo |
| verified | bool: data has been checked against a reliable source |
| notes | plain-language use, e.g. "blood pressure" |

### Presentation (one strength/form of a product, e.g. "Tareg 80 mg tablet")
| Field | Notes |
|---|---|
| id, productId | |
| strength | per ingredient for combination products, e.g. "80/12.5 mg" |
| form | tablet, capsule, syrup, injection, eye drops, inhaler, cream, … (a *form*, not a category) |
| packSize | optional |
| photo | optional, compressed |
| fridge | ❄️ cold-chain flag |
| controlled | ⚠️ controlled-drug flag (extra paperwork) |

### Ingredient
- Normalized list (`valsartan`, `hydrochlorothiazide`, `pantoprazole`, …) with `nameEn`, `nameAr`, `drugClass`.
- Linked to products through **ProductIngredient** `{productId, ingredientId}`. Per-strength amounts are stored on the presentation.
- Never free text on products. Ingredients are picked from this list, so "Valsartan" and "valsartan " can't drift apart.

### Location
| Field | Notes |
|---|---|
| id, name | e.g. "Hospital Pharmacy 1", "Main Storage", "Psychiatric Hospital", "El-Ezaby — branch X" |
| type | `hospital_pharmacy`, `storage`, `external_hospital`, `civilian_pharmacy` |
| phone, notes | |
| needsTransferSlip | true for civilian pharmacies |

---

## 4. Item status flow

```
Searching ──► Found (holding) ──────────────► Delivered
    │                                            ▲
    └──► Transferred (to Location) ──► Found ────┘

Any open state ──► Unavailable  |  Cancelled
```

- **Swipe right** moves to the natural next state. **Long-press** opens all states.
- Choosing *Found* or *Transferred* asks for a location in one sheet of recent/likely locations (single tap).
- Every change shows an **Undo toast** instead of a confirmation dialog.
- **Fee refund** is a separate one-tap toggle, because delivery and repayment can happen on different days.
- A request counts as **complete** when every item is Delivered, Unavailable or Cancelled **and** the fees for delivered items are refunded.
- **Partial delivery** is normal: 3 of 4 medications can be handed over while the 4th stays open.

---

## 5. Features

### 5.1 Medication database
- **Search** by English name, Arabic name, alias or active ingredient. Live results as you type, prefix match on any word.
  - **Arabic normalization:** أ/إ/آ → ا, ة ↔ ه, ى ↔ ي, strip vowel marks and tatweel.
  - **Typo tolerance:** "controloc" finds Controlock.
- **Product-level list.** Opening a product shows all its presentations (e.g. Tareg 40 / 80 / 160 mg), each with its own photo if available.
- **Category filter** as chips, multi-select.
- **Photos per presentation**, falling back to the product photo. Taken with the camera, resized to ≤1024 px and ~150 KB.
- **Flags:** ❄️ fridge and ⚠️ controlled shown as badges in lists and on item cards.
- **Alternatives (بديل), in safety tiers:**
  - 🟢 **Exact:** same set of ingredients + same strength + same form. Safe to swap.
  - 🟡 **Close:** same set of ingredients, different strength or form. Check dose before giving.
  - 🔴 **Same drug class only:** therapeutic alternative. **Needs the prescriber's approval.** Shown collapsed with a warning.
  - Combination products match the **whole ingredient set**: Co-Tareg is never shown as 🟢/🟡 for Tareg.
- **"Last found where"** on the product and presentation pages, from delivered-item history: "Last found: Pharmacy 2 · 3 Sep (4× total)" or "Never found in hospital. Usually Psychiatric Hospital storage."
- **Add/edit medication:**
  - Typing the English name suggests the Arabic name (and vice versa) **only from a lookup** of known names in the DB and seed dictionary.
  - Never overwrites a field the user already typed. With no match, the field stays blank.
  - Ingredient picker with inline "add new ingredient".
- **Verified flag.** Unverified entries show a subtle marker until checked.

### 5.2 Request tracker
- **New request:**
  1. Card number on a numeric keypad, with recent cards listed and existing persons autocompleted.
  2. Plan toggle (monthly 5 / bimonthly 10).
  3. **Add items in a loop:** type 2–3 letters → live list → pick product → pick strength if more than one → qty → "Add another" keeps the card and plan.
- **Duplicate warning.** If this card already has an **open** item for the same product, show a warning with "Add anyway". It never blocks.
- **Renew.** One tap on a person or past request copies their regular medications into a new request with the same plan.
- **Due list.** Persons whose `nextDueDate` falls within N days (default 5), shown as an in-app badge. There are no push notifications, because iOS web apps can't schedule them without a server.
- **Request checkboxes:** registered / approved / paid, one tap each.
- **Transfer slip.** When transferring to a location with `needsTransferSlip`, prompt for an optional slip ref.
- **Handover screen (per person):**
  - Checklist of found items: tick what's handed over.
  - Shows **"Collect: N × fee = X EGP"** for delivered items not yet refunded.
  - A single "Delivered + refunded" action for the ticked items.

### 5.3 Shopping list per location
- Every item currently **Searching** or **Transferred**, grouped by drug and summed quantity.
- Filter by location. Transferred items appear under their destination, Searching items under "Hospital pharmacies".
- Standing at a counter, the user asks for everything at once, then marks each line Found at that location in one tap. Found applies to all matching items.

### 5.4 Locations
- Managed list with type, phone and notes, plus the transfer-slip flag.
- Location sheets sort by most used.

### 5.5 Home screen
- **Money owed to me:** total fees paid for items not yet refunded.
- **Open items** count by status.
- **Due for renewal** in the next N days.
- **Stale items:** open longer than N days (default 3).
- Tap any tile to open the filtered list.

### 5.6 Global search
- One search field across products, ingredients, persons (card number, name) and requests/items.
- Results grouped: *Medications · People · Open items · Past items*.
- Searching a drug name shows the product **and** every item referencing it.

### 5.7 Backup & export
- **Full backup:** a single `.json` file (all tables + photos as base64) that can be restored. Restore replaces everything, after a confirmation.
- **CSV export:** one file each for products, presentations, ingredients, persons, requests and items. Readable anywhere, no photos.
- **CSV import** for the medication database, in the flat format defined in `seed/SEED_FORMAT.md` (one row per presentation), which the drug-database CSV export also produces (the bulk-expansion path). Rows are matched by id or nameEn and presentation, shown as a preview diff before applying.
- Exported through the iOS **share sheet** (Files / iCloud Drive).
- **Backup nag:** "Last backup: 9 days ago" banner once more than 7 days have passed.
- Call `navigator.storage.persist()` on first run, and show the result in Settings.

### 5.8 Privacy & security
- **Optional PIN lock** when opening the app or returning after N minutes.
- **Partly hidden card numbers** in lists (`••••4821`), full number on the detail view.
- A warning line in the export sheet: backups contain sensitive card numbers, so don't share them in group chats.
- Nothing ever leaves the device except files the user exports manually.

---

## 6. Design direction

- **"Raven black" military theme:** near-black backgrounds (`#0A0B0D` range), gunmetal surfaces, desaturated olive/khaki accent, one sharp signal color for warnings and the 🔴 tier.
- **The drug database feels edgy, not clinical:** tight uppercase headers, monospace for strengths and card numbers, hard edges, subtle grid or stencil texture on product headers.
- **Speed first:**
  - Bottom tab bar: **Home · Requests · ＋ · Drugs · Search**.
  - Large touch targets, thumb-reachable primary actions.
  - Swipe and long-press gestures, Undo toasts, no multi-step forms for status changes.
- Full RTL/Arabic rendering support for Arabic names.
- iOS polish: safe-area insets, no rubber-band layout jumps, `inputmode="numeric"` for card numbers, add to home screen with an app icon and splash screen.

---

## 7. Technical approach

| Concern | Choice |
|---|---|
| App type | PWA (installable on iPhone home screen, offline via service worker) |
| Stack | Vite + React + TypeScript |
| Storage | IndexedDB via **Dexie** |
| PWA | `vite-plugin-pwa` |
| Search | In-memory index with Arabic normalization + fuzzy matching (e.g. a small Fuse.js-style scorer or custom) |
| Photos | Stored as compressed Blobs in IndexedDB |
| Hosting | Cloudflare Pages or GitHub Pages (free, HTTPS). The repo holds code + seed data only, **never** personal data |
| Tests | Vitest for data logic (alternative tiers, duplicate detection, fees, normalization); Playwright smoke test for the main flows |
| AI / automation | None at runtime. Database expansion scripts (Phase 4) use the local `claude -p` CLI, never a paid API key |

---

## 8. Seed data

**Status: researched and built (2026-09-17).**

| File | Purpose |
|---|---|
| `seed/medications.csv` | **The seed.** Merged and validated, ships with the app |
| `seed/SEED_FORMAT.md` | Column spec + allowed `form` / `categories` values. Also the user CSV import format (§5.7) |
| `seed/shards/*.csv` | Per-category source files (edit these, not the merged file) |
| `seed/build_seed.py` | Merges shards → `medications.csv` and validates (enums, Arabic present, column count, strength vs ingredient count, duplicates, per-brand consistency, ingredient spelling drift, controlled-flag consistency). Run `python seed/build_seed.py --strict` after any edit |

**Contents**
- **1,105 presentations · 793 brands · 416 active ingredients**, researched from Egyptian market listings (dwaprices.com, egyptiandrugstore.com, tdawi.com and others), with local generics as well as international brands.
- **Confidence:** 804 `high` (brand + strength confirmed on an Egyptian source, URL in `source`) · 301 `medium` (well-known brand at its standard strength, not individually confirmed).
- Every letter A–Z covered. 22 controlled-drug entries, 28 fridge entries.
- **Alternatives work from day one:** 538 of 793 brands share their exact ingredient set with at least one other brand (e.g. 17 montelukast brands, 12 pantoprazole, 11 omeprazole).

| Category | Brands | Category | Brands |
|---|---|---|---|
| antibiotic | 76 | urology | 37 |
| gastric | 80 | allergy | 32 |
| dermatology | 73 | analgesic / anti-inflammatory | 31 / 31 |
| psychiatric | 59 | hematology | 31 |
| antidiabetic | 56 | antifungal | 30 |
| cardiac | 73 (incl. nitrates, antianginals, antiplatelets) | neurology | 26 |
| corticosteroid | 48 | endocrine | 20 |
| ophthalmic | 46 | musculoskeletal | 16 |
| vitamins-supplements | 41 | womens-health | 15 |
| respiratory | 37 | hepatic | 33 (incl. hepatitis B/C drugs) |
| antiviral | 21 | anticoagulant | 18 |
| smaller: antiparasitic 11, ent 10, lipid 8, cold-flu 7, oral-dental 4 | | | |

**Required products, all confirmed:**
- **Tareg** — valsartan 40 / 80 / 160 mg
- **Co-Tareg** — valsartan + hydrochlorothiazide 80/12.5, 160/12.5, 160/25 mg
- **Controloc** — pantoprazole 20 / 40 mg tablets + 40 mg vial. The Egyptian spelling has no "k"; add `Controlock` as a search alias.
- **Concor** — bisoprolol 5 / 10 mg (+ Concor Cor 2.5, Concor Plus, Concor Amlo)
- **Methyltechno** ("Methyl Techno") — methylcobalamin (vitamin B12) 1000 mcg, orally disintegrating tablet
- **Caldin C** — calcium carbonate + magnesium citrate + vitamin C + vitamin D3

**How the app must treat this data**
- Import `confidence` into the product's `verified` flag: `high` rows keep their source link, and `medium` rows show the "unverified" marker until the user confirms them. In testing, one `medium` entry (Congestal) had the wrong ingredients until research corrected it, so the marker matters.
- `controlled` flags cover the main scheduled classes (benzodiazepines, tramadol, pregabalin, zolpidem, methylphenidate, trihexyphenidyl, biperiden, chlordiazepoxide combos) but are not an authoritative legal list.

**Known gaps and doubts (for later expansion)**
- **Filled 2026-09-17:** anticoagulants 4 → 18 (rivaroxaban/apixaban generics, Pradaxa, enoxaparin, heparin, Arixtra, warfarin generics) + ticagrelor/clopidogrel/cilostazol generics, dipyridamole; nitrates/antianginals (Isorbid, Effox, Angiofox, Nitrocare, nicorandil, Ranexa, trimetazidine generics); hepatic 4 → 33 (silymarin, UDCA, LOLA, rifaximin, vitamin K, hepatitis B + C antivirals).
- **Still missing (no Egyptian source found):** ivabradine, edoxaban, prasugrel, sublingual/patch/IV nitroglycerin, Clexane originator. **Thin:** lipid (8), cold-flu (7). Topical products where the strength couldn't be pinned down were skipped (Toplexil, Bronchicum, Rhinofed, Epiduo, Triderm).
- **To review:**
  - Ossofortin is listed with different vitamin D forms per strength (cholecalciferol vs ergocalciferol).
  - Daflon's diosmin/hesperidin split comes from the standard 90:10 formula.
  - Neomercazole was marked "illegal import" on one source.
  - Coversyl Plus 10/2.5 mg needs confirming.
  - Rowatinex amounts come from the international leaflet.
- **Legitimate warnings the validator keeps showing:** Olfen/Rheumafen have tablet (diclofenac sodium) and gel (diclofenac diethylamine) products under one brand, so their alternatives are matched per presentation.

**Seed = import path:** the seed ships in the same flat CSV format the user imports and exports, so one importer serves both.

---

## 9. Build phases

### Phase 0 — Foundations
- Project scaffold (Vite + React + TS), PWA manifest, service worker, offline shell.
- Dexie schema for every entity in §3, with migrations set up.
- Theme tokens (colors, type, spacing) and the bottom tab bar shell.
- Seed CSV format defined + importer core + initial seed file.
- **Done when:** the app installs on iPhone, opens offline, the seed loads into IndexedDB, and unit tests pass.

### Phase 1 — Usable MVP
- Drug DB: product list, product detail with presentations, add/edit product/presentation/ingredient, category filter.
- Search with Arabic normalization + typo tolerance.
- Person → Request → Item: new-request flow with add-another loop, plan/fee, duplicate warning.
- Item status flow with swipe-to-advance, long-press menu, Undo.
- Full JSON backup/restore + CSV export via share sheet, `storage.persist()`.
- **Done when:** a real request with 3 meds can be logged, advanced through every state and delivered in under a minute, and a backup round-trips losslessly.

### Phase 2 — Field power
- Photos (camera capture, compression, per-presentation with product fallback).
- Alternative tiers 🟢🟡🔴 with combination-set matching.
- Locations management + location picker on Found/Transferred + transfer slip ref.
- "Last found where" on drug pages.
- Fee refund tracking, money-owed total, handover screen.
- ❄️ fridge / ⚠️ controlled flags.

### Phase 3 — Rhythm
- Home screen (money owed, open, due, stale).
- Renew + regular meds per person + due list.
- Shopping list per location with bulk mark-found.
- Global search across drugs, people and items.
- CSV import with preview diff for the drug database.
- PIN lock, partly hidden card numbers, backup nag.

### Phase 4 — Expansion
- **Done:** Script-assisted database growth — `seed/expand_seed.mjs` (`npm run seed:expand`) drafts CSV rows from a source list (`seed/expand/sources.txt`) via the local `claude -p` CLI, validates them against the seed format, forces `confidence: medium` so every row stays unverified, skips duplicates, and writes a draft file for review + import through the normal CSV import screen. See `seed/expand/README.md`. Requires `claude /login` once in the shell that runs it.
- **Done:** Name finalized to **Raven Rx**; icon set built (`public/favicon.svg`, `public/icons/apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and wired into `index.html` + the PWA manifest.

---

## 10. Open questions

- Source for verifying seed data (EDA list access vs. manual package inserts).
- Default values for "due soon" (5 days) and "stale" (3 days). Adjust after real use.
- Whether regular meds per person should update automatically from the latest delivered request or only when edited by hand.
