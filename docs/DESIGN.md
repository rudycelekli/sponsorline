# DESIGN.md — Sponsorline

## Concept

A verifiable document. The page is staged like a notarized proof an auditor reads
and counter-signs: warm paper, ink-dark type, a single seal-vermilion accent that
behaves like a wax stamp. The aesthetic earns the product's core claim, that trust
is mechanical and inspectable, rather than decorating around it.

This deliberately rejects the AI-dev-tool category reflex (dark OLED, navy +
neon-green, monospace-everything). If the palette could be guessed from "dev
tool," it is slop.

## Theme

**Light.** Scene sentence: an enterprise security reviewer at their desk in
daylight, reading a vendor's proof and deciding whether to approve it. Daylight,
paper, ink. Dark mode would signal "IDE chrome" and pull us back into the reflex.

## Color (OKLCH, never #000/#fff, neutrals tinted toward the warm seal hue)

Strategy: **Committed.** One saturated ink-vermilion carries identity; everything
else is warm paper and ink.

- `--paper`:        oklch(0.985 0.006 70)   /* warm near-white background */
- `--paper-sunk`:   oklch(0.965 0.010 70)   /* recessed panels, code wells */
- `--ink`:          oklch(0.235 0.018 55)   /* warm near-black, primary text */
- `--ink-soft`:     oklch(0.45 0.020 55)    /* secondary text */
- `--ink-faint`:    oklch(0.62 0.018 60)    /* captions, meta */
- `--rule`:         oklch(0.88 0.012 65)    /* hairline borders */
- `--seal`:         oklch(0.55 0.185 33)    /* vermilion accent / wax */
- `--seal-deep`:    oklch(0.47 0.165 33)    /* pressed/hover */
- `--seal-wash`:    oklch(0.95 0.04 40)     /* faint accent fill */
- `--verify-ink`:   oklch(0.55 0.10 155)    /* one muted green, ONLY for pass/checkmarks */

Green appears exactly once in role: a verification checkmark. It is functional,
never decorative, and never the brand color.

## Typography

- Display / voice: **Bricolage Grotesque** (700/600). Characterful grotesque,
  off the reflex-reject list, carries the "document with a personality" tone.
- Body: **Hanken Grotesk** (400/500). Clean, warm, highly readable at 16px+.
- Proof blocks only: **JetBrains Mono** (500). Load-bearing here: receipts,
  commands, hash chains. It is the product's actual material, not costume.
- Scale (ratio >= 1.25): 13, 15, 16, 18, 22, 28, 38, 54, 76. Hero clamps fluid.
- Body line length capped 62-70ch. Line-height 1.6 body, 1.05-1.1 display.

## Layout

- Single column reading spine, max ~70ch for prose, widening to ~1100px for
  proof/receipt blocks. Not card-grid-everything. Sections separated by generous
  asymmetric whitespace and the occasional hairline rule, like document sections.
- The verify command appears as a "receipt" block: monospace, paper-sunk well,
  a seal stamp mark, a copy affordance. This is the visual anchor.
- No nested cards. No side-stripe borders. No glassmorphism. No gradient text.

## Motion

- Staggered hero reveal: opacity + small translateY, ease-out-expo, 40ms stagger.
- The seal does a single subtle settle (scale 1.06 -> 1, slight rotate) on load,
  once, like a stamp being pressed. Respects prefers-reduced-motion (no transform,
  instant visibility).
- No animated layout properties. No bounce/elastic. Hover states are 150ms.

## Components

- Receipt/terminal well: paper-sunk, hairline border, mono text, a small
  "VERIFIED" wax mark, tactile copy button.
- Proof list ("what verify proves"): a checklist with the single green check role,
  each line stating a property and the mechanism that enforces it.
- Guardrail section: states the two enforced invariants (egress guard, supply
  floor) as "we made the bad outcome impossible, and tested it."

## Accessibility / perf

- Contrast >= 4.5:1 for all text (ink on paper passes comfortably; seal-on-paper
  reserved for large/bold or as fill behind ink).
- focus-visible rings in seal color, 2px. Full keyboard nav. Reduced-motion honored.
- Self-contained `site/index.html`, inline CSS, fonts via Google Fonts with
  display=swap. Responsive at 375 / 768 / 1024 / 1440.
