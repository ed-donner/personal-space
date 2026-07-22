# Personal Space — End-to-End Tests

Phase 1 e2e tests for Personal Space. Drives the real app in a real browser using Playwright.

## Prerequisites

From the repo root:
```bash
npm install       # root deps (builds the app)
npm run build     # builds web/dist
```

From this directory:
```bash
npm install       # installs Playwright and test runner
npx playwright install chromium  # downloads Chromium binary (ARM64 compatible)
```

## How to run

From the repo root:
```bash
cd e2e && npm test
```

Or from this directory:
```bash
npm test
```

The harness automatically:
1. Starts the server on a random port with a fresh temp database
2. Runs all tests in `test/`
3. Kills the server and cleans up the temp database

## What is tested (Phase 1)

| Test | Success Criterion | Description |
|------|-------------------|-------------|
| TC-1 | SC-1 | Sidebar tree shows seeded pages with emoji icons |
| TC-2 | SC-5 | Creating a new page via "+ New page" button |
| TC-3 | SC-2 | Renaming a page inline in the sidebar |
| TC-4 | SC-2 | Deleting a page with children shows confirmation modal and cascades |
| TC-5 | SC-3 | Changes survive browser refresh |
| TC-6 | SC-3 | Changes survive full server restart |
| TC-7 | — | No save button exists anywhere |

## Tooling

- **Playwright** (`playwright` npm package) for browser automation
- **Node test runner** (`node:test`) as the test framework
- **tsx** for TypeScript execution
- Playwright's own Chromium binary (ARM64-compatible, downloaded via `npx playwright install chromium`)

## Screenshots

Captured to `screenshots/` with prefix `e2e-phase1-*`.
