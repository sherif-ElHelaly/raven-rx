# Raven Rx — Pharmacy Registration & Reference

Personal, offline-first PWA for tracking medication requests and looking up
Egyptian brand-name substitutes. See [VISION.md](./VISION.md) for the full
spec, data model and build phases.

## Development

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` both sync `seed/medications.csv` into
`public/seed/` first (`npm run seed:sync`), so edits to the shards
(`seed/shards/*.csv` → `python seed/build_seed.py --strict`) show up after a
restart.

## Tests

```bash
npm run test
```

## Stack

Vite + React + TypeScript, Dexie (IndexedDB), `vite-plugin-pwa` for the
offline service worker and manifest. No backend, no accounts — all data
stays on the device.
