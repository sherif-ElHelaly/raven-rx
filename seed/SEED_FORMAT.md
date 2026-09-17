# Seed / Import Format — `medications.csv`

One flat CSV, **one row per presentation** (brand + strength + form). The importer normalizes it into
Product / Presentation / Ingredient / ProductIngredient (see VISION.md §3). The same format is used for
the shipped seed, user bulk import, and the "flat" drug-database export.

- Encoding: UTF-8 (no BOM), comma-separated, RFC 4180 quoting (quote any field containing `,` `"` or newline; escape `"` as `""`).
- Multi-value fields use `;` with no spaces around it.
- Header row required, columns in exactly this order:

```
brand_en,brand_ar,ingredients,strength,form,pack_size,manufacturer,categories,drug_class,use_en,fridge,controlled,confidence,source
```

| Column | Rules | Example |
|---|---|---|
| `brand_en` | Brand name as printed on the Egyptian pack, Title Case. Same spelling on every row of the product. Do NOT put strength in it. | `Co-Tareg` |
| `brand_ar` | Common Egyptian Arabic spelling. Same on every row of the product. | `كو-تارج` |
| `ingredients` | Lowercase INN (international generic name), `;`-separated, alphabetical is NOT required but order must match `strength`. Use salt-free INN (`amlodipine`, not `amlodipine besylate`) unless the salt defines the product (e.g. `ferrous sulfate`). | `valsartan;hydrochlorothiazide` |
| `strength` | Amounts in ingredient order separated by `/`, one unit at the end if all share it, else unit per part. Topicals as %; liquids per mL or per 5 mL. Blank only if genuinely not applicable. | `80/12.5 mg`, `500 mg/5 mL`, `0.1%`, `40 mg/mL` |
| `form` | One of the allowed forms below. | `tablet` |
| `pack_size` | Optional, e.g. `28 tablets`, `100 mL`, `5 mL`. Leave blank if unsure. | `28 tablets` |
| `manufacturer` | Optional, company marketing it in Egypt. Blank if unsure. | `Novartis` |
| `categories` | `;`-separated from the allowed list below (1–3). | `cardiac` |
| `drug_class` | Short pharmacological class, lowercase. | `angiotensin receptor blocker + thiazide diuretic` |
| `use_en` | Plain-language main use for a non-pharmacist, ≤ 6 words. | `high blood pressure` |
| `fridge` | `yes` if storage requires 2–8 °C before opening, else `no`. | `no` |
| `controlled` | `yes` if a controlled/scheduled drug in Egypt (جدول) — benzodiazepines, opioids incl. tramadol, pregabalin, zolpidem, stimulants, barbiturates, etc. Else `no`. | `no` |
| `confidence` | `high` = brand + strength confirmed on an Egyptian market source; `medium` = well-known brand marketed in Egypt, strength is the standard one, not individually confirmed. Never include `low` rows — skip them. | `high` |
| `source` | URL used to confirm (for `high`), else blank. | |

## Allowed `form` values
`tablet`, `film-coated tablet`, `extended-release tablet`, `chewable tablet`, `effervescent tablet`,
`orally disintegrating tablet`, `sublingual tablet`, `capsule`, `extended-release capsule`, `sachet`,
`powder for oral suspension`, `syrup`, `suspension`, `oral solution`, `oral drops`, `injection`,
`eye drops`, `eye ointment`, `eye gel`, `ear drops`, `nasal spray`, `nasal drops`, `inhaler`,
`dry powder inhaler`, `nebulizer solution`, `cream`, `ointment`, `gel`, `lotion`, `topical solution`,
`spray`, `shampoo`, `suppository`, `vaginal suppository`, `vaginal cream`, `patch`, `lozenge`,
`mouthwash`, `oral gel`, `enema`

## Allowed `categories` values
`cardiac`, `anticoagulant`, `lipid`, `antidiabetic`, `endocrine`, `gastric`, `hepatic`, `antibiotic`,
`antifungal`, `antiviral`, `antiparasitic`, `analgesic`, `anti-inflammatory`, `musculoskeletal`,
`respiratory`, `allergy`, `cold-flu`, `psychiatric`, `neurology`, `ophthalmic`, `ent`, `dermatology`,
`vitamins-supplements`, `hematology`, `urology`, `womens-health`, `corticosteroid`, `oral-dental`

## Example rows
```
brand_en,brand_ar,ingredients,strength,form,pack_size,manufacturer,categories,drug_class,use_en,fridge,controlled,confidence,source
Tareg,تارج,valsartan,80 mg,film-coated tablet,28 tablets,Novartis,cardiac,angiotensin receptor blocker,high blood pressure,no,no,high,
Co-Tareg,كو-تارج,valsartan;hydrochlorothiazide,80/12.5 mg,film-coated tablet,28 tablets,Novartis,cardiac,angiotensin receptor blocker + thiazide diuretic,high blood pressure,no,no,high,
```
