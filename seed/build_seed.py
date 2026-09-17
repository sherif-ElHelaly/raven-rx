"""Merge seed/shards/*.csv into seed/medications.csv and validate against SEED_FORMAT.md.

Usage: python seed/build_seed.py [--strict]
Errors block the merge (row dropped + reported); warnings are reported only.
"""
import csv, difflib, re, sys, unicodedata
sys.stdout.reconfigure(encoding="utf-8")
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
HEADER = ["brand_en", "brand_ar", "ingredients", "strength", "form", "pack_size", "manufacturer",
          "categories", "drug_class", "use_en", "fridge", "controlled", "confidence", "source"]
FORMS = set("""tablet|film-coated tablet|extended-release tablet|chewable tablet|effervescent tablet|
orally disintegrating tablet|sublingual tablet|capsule|extended-release capsule|sachet|
powder for oral suspension|syrup|suspension|oral solution|oral drops|injection|eye drops|eye ointment|
eye gel|ear drops|nasal spray|nasal drops|inhaler|dry powder inhaler|nebulizer solution|cream|ointment|
gel|lotion|topical solution|spray|shampoo|suppository|vaginal suppository|vaginal cream|patch|lozenge|
mouthwash|oral gel|enema""".replace("\n", "").split("|"))
CATS = set("""cardiac anticoagulant lipid antidiabetic endocrine gastric hepatic antibiotic antifungal antiviral
antiparasitic analgesic anti-inflammatory musculoskeletal respiratory allergy cold-flu psychiatric neurology
ophthalmic ent dermatology vitamins-supplements hematology urology womens-health corticosteroid oral-dental""".split())
ARABIC = re.compile(r"[؀-ۿ]")
CONF_RANK = {"high": 2, "medium": 1}


def norm_key(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip().lower()


def main():
    errors, warnings, rows = [], [], []
    shards = sorted((ROOT / "shards").glob("*.csv"))
    for shard in shards:
        with open(shard, encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if header != HEADER:
                errors.append(f"{shard.name}: bad header {header}")
                continue
            for i, r in enumerate(reader, start=2):
                where = f"{shard.name}:{i}"
                if not any(c.strip() for c in r):
                    continue
                if len(r) != len(HEADER):
                    errors.append(f"{where}: {len(r)} columns"); continue
                d = {k: v.strip() for k, v in zip(HEADER, r)}
                bad = []
                if not d["brand_en"]: bad.append("empty brand_en")
                if not ARABIC.search(d["brand_ar"]): bad.append(f"brand_ar not Arabic '{d['brand_ar']}'")
                if not d["ingredients"]: bad.append("empty ingredients")
                if d["form"] not in FORMS: bad.append(f"form '{d['form']}'")
                cats = [c for c in d["categories"].split(";") if c]
                if not cats or any(c not in CATS for c in cats): bad.append(f"categories '{d['categories']}'")
                for k in ("fridge", "controlled"):
                    if d[k] not in ("yes", "no"): bad.append(f"{k} '{d[k]}'")
                if d["confidence"] not in CONF_RANK: bad.append(f"confidence '{d['confidence']}'")
                if bad:
                    errors.append(f"{where} [{d['brand_en']}]: " + "; ".join(bad)); continue
                d["ingredients"] = ";".join(norm_key(x) for x in d["ingredients"].split(";") if x.strip())
                d["_where"] = where
                if d["confidence"] == "high" and not d["source"]:
                    warnings.append(f"{where} [{d['brand_en']}]: high confidence without source")
                n_ing = len(d["ingredients"].split(";"))
                n_amt = len(re.findall(r"(?:^|/)\s*[\d.,]+(?![\d.,])(?!\s*(?:mL|ml|dose|puff|actuation|g\b))", d["strength"]))
                if d["strength"] and "IU/mL" not in d["strength"] and n_ing > 1 and n_ing <= 4 and n_amt not in (0, n_ing):
                    warnings.append(f"{where} [{d['brand_en']}]: {n_ing} ingredients vs strength '{d['strength']}'")
                rows.append(d)

    # dedupe on brand+strength+form, keep highest confidence
    best = {}
    for d in rows:
        key = (norm_key(d["brand_en"]), norm_key(d["strength"]), d["form"], norm_key(d["pack_size"]))
        if key in best:
            other = best[key]
            if CONF_RANK[d["confidence"]] > CONF_RANK[other["confidence"]]:
                best[key] = d
            warnings.append(f"duplicate {key} in {other['_where']} and {d['_where']}")
        else:
            best[key] = d
    merged = list(best.values())

    # per-brand consistency
    by_brand = defaultdict(list)
    for d in merged:
        by_brand[norm_key(d["brand_en"])].append(d)
    for b, ds in by_brand.items():
        for field in ("brand_ar", "brand_en"):
            vals = {x[field] for x in ds}
            if len(vals) > 1:
                warnings.append(f"brand '{b}': inconsistent {field} {sorted(vals)}")
        ing_sets = {x["ingredients"] for x in ds}
        if len(ing_sets) > 1:
            warnings.append(f"brand '{b}': multiple ingredient sets {sorted(ing_sets)}")

    # ingredient spelling drift + controlled consistency
    ingredients = sorted({i for d in merged for i in d["ingredients"].split(";")})
    for a_i, a in enumerate(ingredients):
        for b in ingredients[a_i + 1:]:
            if difflib.SequenceMatcher(None, a, b).ratio() > 0.9:
                warnings.append(f"ingredient near-duplicate: '{a}' ~ '{b}'")
    ctrl = defaultdict(set)
    for d in merged:
        if ";" not in d["ingredients"]:
            ctrl[d["ingredients"]].add(d["controlled"])
    for ing, vals in ctrl.items():
        if len(vals) > 1:
            warnings.append(f"ingredient '{ing}': controlled flag inconsistent")

    merged.sort(key=lambda d: (norm_key(d["brand_en"]), d["form"], d["strength"]))
    out = ROOT / "medications.csv"
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(HEADER)
        for d in merged:
            w.writerow([d[k] for k in HEADER])

    brands = {norm_key(d["brand_en"]) for d in merged}
    letters = Counter(b[0].upper() for b in brands)
    cats = Counter(c for b, ds in by_brand.items() for c in {c for x in ds for c in x["categories"].split(";")})
    conf = Counter(d["confidence"] for d in merged)
    print(f"shards: {len(shards)}  rows in: {len(rows)}  merged rows: {len(merged)}")
    print(f"brands: {len(brands)}  ingredients: {len(ingredients)}  confidence: {dict(conf)}")
    print("controlled rows:", sum(d["controlled"] == "yes" for d in merged), " fridge rows:", sum(d["fridge"] == "yes" for d in merged))
    print("letters:", " ".join(f"{k}{v}" for k, v in sorted(letters.items())))
    print("missing letters:", "".join(c for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if c not in letters) or "none")
    print("categories:", dict(cats.most_common()))
    print(f"\nERRORS ({len(errors)}):"); [print("  " + e) for e in errors]
    print(f"\nWARNINGS ({len(warnings)}):"); [print("  " + w) for w in warnings]
    if "--strict" in sys.argv and errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
