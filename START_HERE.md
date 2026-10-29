# Start here

This is application source, not an edition bundle. Read SETUP.md and PUBLICATION_STATUS.md. On Node 22+, run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

The build prepares pinned PDF.js assets; tests use synthetic records. Approved edition models/PDF/audio/timings are external. No LocalAI or other inference server is required for these checks. The source-derived sample page and historical edition-generation tools were deliberately excluded from this public release.

No project-wide license was supplied; no new license has been invented. Dependency license metadata is retained in package-lock.json and installed packages.
