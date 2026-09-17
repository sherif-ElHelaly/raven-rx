# Database expansion (Phase 4)

Drafts new `medications.csv` rows by asking the local `claude -p` CLI (your subscription,
never a paid API key) to research a list of brands/topics. It never writes to
`seed/medications.csv` directly — it writes a separate draft file for you to review and
import through the app's own CSV import screen (Settings → Import CSV), which shows a
preview diff before applying anything.

Every drafted row is forced to `confidence=medium` regardless of what the model claims,
so it always imports as **unverified** (grey marker) until you check it against a real
source and bump it to `high` yourself.

## Usage

```bash
cp seed/expand/sources.example.txt seed/expand/sources.txt
# edit sources.txt: one brand name or topic per line, # for comments
node seed/expand_seed.mjs --input seed/expand/sources.txt
```

Output goes to `seed/expand/draft-<date>.csv` by default (`--out` to override).

Flags:
- `--input <file>` — source list (default `seed/expand/sources.txt`)
- `--out <file>` — draft output path
- `--limit N` — only process the first N topics (useful for a quick test)
- `--dry-run` — parse the input and print what would run, without calling `claude`

## After running

1. Open the draft CSV and read it — the model can still get things wrong (wrong strength,
   invented pack size, wrong category). Delete or fix any row that looks off.
2. Import it in the app: Settings → Import CSV → pick the draft file → review the preview
   diff → apply.
3. Once you've personally checked a row against a real Egyptian source, edit it in-app and
   mark it verified.

Rows that already exist in `seed/medications.csv` (same brand + strength + form) are
skipped automatically. Rows the model returns with the wrong column count, an invalid
`form`, or an invalid `categories` value are dropped and logged to the console.
