# Release runbook

The engineering is done and validated. What remains are the authenticated,
shared-system steps that need your npm / GitHub / hosting credentials. Run them
in this order; each step is independent enough to stop after.

## Order, and why

1. **Extract the private backend first** (see `docs/LICENSING.md`). Do this before
   making the client repo public so the proprietary `@sponsorline/mcp` code never
   appears in public history.
2. **Publish the client to npm** so `npx sponsorline init` resolves. The landing
   page funnel is dead until this works.
3. **Make the client repo public** the moment "don't trust us, run it" is true for
   a stranger.
4. **Deploy the landing page.**

## Pre-flight (already green, re-verify before you publish)

```bash
git status                 # clean tree
npm run build              # all four packages build
npm test                   # 185 pass
```

## 1. Extract the backend

Follow `docs/LICENSING.md`. The extraction was dry-run validated: with
`packages/mcp` removed and dropped from the root build script, the client builds
and 164 tests pass (only the 21 mcp tests leave with it). After extraction, copy
`packages/core/test/egress-guard.test.ts` into the private repo and wire its CI.

## 2. Publish the client to npm

The public packages are configured for one-command publish:
`@effinai/sponsorline-core` carries `publishConfig.access: "public"` (scoped packages are
private by default), both packages rebuild via `prepublishOnly`, and each ships
`dist` + `LICENSE` only (dry-run verified: no `src`/`test` leak).

Publish **core first** (the CLI imports it as an external `0.1.0` dependency
resolved from the registry), then the CLI:

```bash
npm login
npm publish -w @effinai/sponsorline-core   # -> @effinai/sponsorline-core@0.1.0 (public)
npm publish -w sponsorline          # -> sponsorline@0.1.0
```

Verify the funnel from a clean machine / empty dir:

```bash
cd "$(mktemp -d)"
npx sponsorline@latest verify --help   # resolves and runs the published client
```

The Cursor adapter (`sponsorline-cursor`) ships to the VS Code Marketplace via
`vsce`/`ovsx`, not npm; it is not on the `npx sponsorline` critical path.

## 3. Make the client repo public

Only after step 1. The repo should contain `core`, `cli`, `cursor`, `LICENSE`
(PolyForm Shield), and `docs/` — and **not** `packages/mcp`.

## 4. Deploy the landing page

`site/` is a single self-contained `index.html` plus `site/vercel.json`
(security headers: CSP scoped to the Google Fonts it uses, HSTS, no framing, no
referrer leak, locked-down Permissions-Policy).

```bash
cd site
vercel deploy --prod     # one-command static deploy
```

Then point `sponsorline.dev` at the deployment.

Any static host works (the page is one file). Netlify: `netlify deploy --prod --dir site`.
GitHub Pages / Cloudflare Pages: serve `site/`. The headers in `vercel.json` are
Vercel-specific; replicate them in the host's header config if you deploy elsewhere.

## Post-launch smoke test

- [ ] `npx sponsorline@latest verify` runs from an empty dir on a clean machine.
- [ ] A stranger can `git clone`, `npm i`, `npm run build`, `npm test` and get 164+ green.
- [ ] Landing page loads over HTTPS; response carries the CSP + HSTS headers.
- [ ] The `LICENSE` link in the page footer resolves.
