# Licensing and the public / private split

Sponsorline's credibility rests on a claim a stranger can re-run: clone, build,
`verify`. That requires the privacy-critical code to be readable and runnable. It
does **not** require the business backend to be open. So the codebase splits along
exactly that line.

## The boundary

| Package | Role | Visibility | License |
|---------|------|------------|---------|
| `@sponsorline/core` | On-device substrate: signal building, witness hash chain, Ed25519 seal, `verify` | **Public, source-available** | PolyForm Shield 1.0.0 (`/LICENSE`) |
| `sponsorline` (CLI) | The official `statusLine` command + `init/why/feedback/earnings/verify/off` | **Public, source-available** | PolyForm Shield 1.0.0 |
| `sponsorline-cursor` | Thin Cursor/VS Code status-bar adapter over the same CLI engine | **Public, source-available** | PolyForm Shield 1.0.0 |
| `@sponsorline/mcp` | Advertiser/marketer/billing/payout backend seam (incl. Stripe gateway) | **Private, proprietary** | UNLICENSED (`packages/mcp/LICENSE`) |

A security reviewer only ever needs the three public packages. They are the only
code that runs on a developer's machine and touches developer context. The backend
is never audited to decide whether to install, so it stays closed.

## Why PolyForm Shield, not MIT and not fully closed

- **Fully closed breaks the product.** "Don't trust us, run it" has nothing to run
  if the verifier is secret. You cannot hide the verifier and keep stranger
  verification. They are the same property.
- **MIT/Apache invites a clone.** A permissive license lets a competitor ship our
  client verbatim as a rival network.
- **PolyForm Shield 1.0.0** threads both: anyone may read, run, audit, and verify
  the client for any purpose **except** providing a product that competes with
  Sponsorline. Code visibility is decoupled from permission to compete.

Honest caveat: a source-available license stops someone shipping our code; it does
not stop someone reading it and reimplementing the ideas. The durable moat is being
the network advertisers and developers actually trust, which compounds and cannot be
cloned. Secrecy was never the moat.

## Enforced even across the boundary

The static egress guard (`packages/core/test/egress-guard.test.ts`) currently scans
every package under `packages/*/src`, including the backend, and fails the build if
any source references an ad/tracking/analytics domain or a cross-site identity token.
When the backend is extracted (below), the private repo MUST carry its own copy of
this guard so the "never integrates an ad-network identity graph" invariant keeps
holding on both sides of the split.

## Extracting the backend into a private repo

This has not been done automatically because it creates a new remote, which is a
shared-system action that needs your GitHub account. When ready, from a clean tree:

```bash
# 1. Carve packages/mcp into its own branch, preserving history.
git subtree split --prefix=packages/mcp -b mcp-private

# 2. Create a PRIVATE repo on GitHub (note: --private), then push the branch.
gh repo create sponsorline-backend --private --disable-issues=false
git push git@github.com:<you>/sponsorline-backend.git mcp-private:main

# 3. In the PUBLIC repo, remove the backend from the workspace.
git rm -r packages/mcp
#   - drop "@sponsorline/mcp" from the root build script in package.json
#   - the cli/core public packages do not depend on mcp, so the client still builds
git commit -m "chore: extract proprietary backend into private repo"

# 4. In the PRIVATE repo, re-add a copy of the egress guard and wire its own CI.
```

The public client builds and tests without the backend: `core` and `cli` have no
dependency on `mcp` (the dependency runs the other way). Only `mcp`'s own tests,
which import the public client, move with it.
