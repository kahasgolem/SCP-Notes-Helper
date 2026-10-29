# Source setup

Node 22+ and npm. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run build`, then `npm test`. PDF.js is pinned in package-lock.json. Build copies its npm assets; the 31 synthetic player/model tests need no private data.

For a local preview, provide an approved `private-data/notes.json`, explicitly set `NOTES_SOURCE_ROOT` to the corresponding PDF/audio directory, then run `npm start`. The server binds only to loopback. These runtime inputs are not supplied or generated here.

`npm run bundle` requires the approved model and its actual PDF path and refuses an existing output. Optional v2 bundling requires explicit `--model`, `--timings` and `--audio` arguments to `scripts/v2-bundle.mjs`; its outputs remain ignored. Do not infer or fabricate edition data. No historical narration generator or model server is required for source checks.
