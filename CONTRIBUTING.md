# Contributing to AeroVane

Thanks for your interest in improving AeroVane! This guide covers the workspace layout, local setup, conventions, and what a pull request needs to pass.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js 22** — the repo ships an `.nvmrc`, so `nvm use` selects it. CI uses the same version.
- **npm 10+**
- **Chrome, Edge, or Brave** for Web Serial work; any modern browser for everything else.
- **Python 3.10+** — only if you work on `ml/`.

## Workspace layout

| Path | Stack | Notes |
|---|---|---|
| `apps/live-viewer` | SolidJS · TypeScript · Vite · Tailwind v4 | Has its own `package.json`; most TypeScript lives here. |
| `apps/saved-log-viewer` | Plain JavaScript · Web Workers | No framework or build step, except the two esbuild entries `ai-entry.ts` → `ai-analysis.js` and `map-entry.ts` → `map-runtime.js`. |
| `apps/portal` | Static HTML/CSS | Landing page copied to the root of `dist/`. |
| `scripts/` | Node.js (no dependencies) | Local server, MAVLink bridge, `dist/` assembly, Linux service installer. |
| `ml/` | Python | Governed data pipeline and model training; see [`ml/README.md`](ml/README.md). |

> `ai-analysis.js` and `map-runtime.js` are **generated**. Edit `ai-entry.ts` / `map-entry.ts` (or the Live Viewer sources they import) and run `npm run build:saved-ai` / `npm run build:saved-map`.

## Development setup

```bash
git clone https://github.com/MdAzullah/AeroVane.git
cd AeroVane
nvm use                              # Node 22
npm ci
npm --prefix apps/live-viewer ci
```

| Task | Command |
|---|---|
| Live Viewer with hot reload | `npm run dev` → http://localhost:5173 |
| Log Analyzer from source | `npm run dev:saved` → http://127.0.0.1:8080 |
| Fake telemetry for the Live Viewer | `npm run dev:bridge` → `ws://127.0.0.1:9988` |
| Full production build + serve | `npm run build && npm start` → http://127.0.0.1:4173 |

## Coding conventions

### Naming (TypeScript)

| Element | Convention | Example |
|---|---|---|
| Interfaces / types | PascalCase | `MavlinkFrame`, `PlotConfiguration` |
| Classes | PascalCase | `MavlinkMetadataRegistry`, `RingBuffer` |
| Functions / variables | camelCase | `parseFromFileMap`, `frameParser` |
| Constants | UPPER_SNAKE_CASE | `MAVLINK_V2_STX`, `MAX_PAYLOAD_LEN` |
| Files | kebab-case | `frame-parser.ts`, `ring-buffer.ts` |
| Components | PascalCase files | `PlotPanel.tsx`, `MessageMonitor.tsx` |
| Tests | `__tests__/<name>.test.ts` | `__tests__/crc.test.ts` |

### Rules

- **Strict TypeScript.** Avoid `any`; if it is unavoidable, explain why in a comment.
- **No hard-coded MAVLink IDs or field offsets.** Everything comes from the dialect registry.
- **Clean up after yourself.** Release subscriptions, timers, and observers in `onCleanup`.
- **Keep hot paths allocation-free.** Pre-allocate buffers in parsers, workers, and plotting code.
- **Safety features stay advisory.** Detectors and models must never command the vehicle, change parameters, or trigger failsafes.
- **Match the surrounding code.** The Log Analyzer uses its own existing style (snake_case functions, plain scripts); keep new code consistent with it.

## Testing

Run the full check before you open a pull request:

```bash
npm run verify
```

This builds the Log Analyzer bundles, runs its tests, then type-checks, builds, and tests the Live Viewer.

| Suite | Command |
|---|---|
| Everything (CI equivalent) | `npm run verify` |
| Log Analyzer unit tests | `npm run test:saved` |
| Live Viewer unit tests | `npm --prefix apps/live-viewer test` |
| Live Viewer type-check | `npm run typecheck` |
| End-to-end (Playwright) | `npm --prefix apps/live-viewer run e2e` (first run: `npx playwright install chromium`) |
| ML pipeline | `cd ml && python3 -m pytest -q` |

New features and bug fixes should include tests. For bug fixes, add a test that fails without the fix.

## Branches, commits, and pull requests

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Write clear commit messages in the imperative mood, ideally [Conventional Commits](https://www.conventionalcommits.org/) style (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
3. Open a PR against `main` and fill in the template.

### Pull request checklist

- [ ] `npm run verify` passes
- [ ] E2E tests pass if UI behavior changed
- [ ] New code follows the conventions above, with no unexplained `any`
- [ ] Tests added or updated
- [ ] Docs (`README.md`, `docs/USER_GUIDE.md`, app READMEs) updated if behavior or commands changed
- [ ] Generated files (`ai-analysis.js`, `map-runtime.js`) rebuilt, not hand-edited

## Licensing of contributions

Contributions to `apps/saved-log-viewer` are licensed under **GPL-3.0-or-later**. Contributions everywhere else are licensed under the repository's **MIT** licence. See [ATTRIBUTION.md](ATTRIBUTION.md) for third-party code.
