# Design — Ship or Skip

A locked design system for this app. Every page change reads this file first.
Extend or amend it when the system needs to grow; don't restyle pages one-off.

## Genre
Editorial, quiet. The app is an instrument, not a marketing site.

## Macrostructure family
- Home (list of proposals): **Index-First** ledger. Ink rule on top, hairlines between rows, response count as a mono figure on the right.
- Proposal (rating): **Split Studio** diptych. The brief (title, byline, problem) is pinned left at ≥ 60rem; the ballot works on the right. Stacks on mobile.
- Results: **Stat-Led**. The computed call ("Ship it." / "Don’t ship it.") is the hero; score, per-question bars and the share band support it.
- Forms (new proposal): single left-biased column, max 40rem.

## Theme · Specimen
- `--color-paper`      oklch(96% 0.018 80) warm oat
- `--color-paper-2`    oklch(93% 0.020 80) share band, hover
- `--color-ink`        oklch(18% 0.014 60)
- `--color-rule`       oklch(82% 0.014 75) hairlines
- `--color-rule-2`     oklch(56% 0.012 70) control borders (≥ 3:1)
- `--color-accent`     oklch(64.6% 0.222 38) signal orange: marks only (the logo's sun), never text
- `--color-accent-ink` oklch(50% 0.19 35) orange for text, focus and button-hover fill (~5:1 on paper)

Accent stays under ~3 % of any view: wordmark mark, question numbers, the “Ship it.” call, focus, hovers.

## Typography
- Display: Fraunces 340 (500 for the wordmark), roman only, optical sizing on. Tracking −0.025em at display sizes.
- Body: Geist 400, 600 for labels and buttons.
- Figure (outlier): Geist Mono, only for rating figures: scale numerals, scores, averages, response counts.
- Max five sizes per page. Proposal titles cap at `--text-display-s`; only the results call uses `--text-display`.

## Spacing
4-point named scale in `public/tokens.css`. Pages use tokens, never raw values.

## Motion
- Easings `--ease-out` / `--ease-in` / `--ease-in-out`; durations `--dur-micro`.
- No reveals. Motion is limited to button press, submit spinner and copy-button state.
- Reduced motion: transitions ≤ 150ms, no press translate.

## Microinteractions stance
- Silent success: a submitted response shows the “You’ve responded” state, no toast.
- Copy buttons: the label is the feedback (“✓ Copied”, 2.5s), no toast.
- Double-submit guarded by the button’s loading state.

## CTA voice
- Primary: square ink fill, Geist 600, hover fills accent-ink. Verb labels (“Send response”, “Ask for feedback”).
- Secondary: square 1px ink outline (“New proposal”).
- Radius 0 everywhere.

## Per-page allowances
- No enrichment anywhere: function carries every page.
- Home tabs (Pending / Responded / Yours): text links, muted until current; the current tab takes a 2px ink underline that sits on the ledger's ink rule. Counts in Geist Mono.
- Ballot: each question has a separate “Not sure” cell under the ruler, in Geist at text-sm. It isn't a point on the scale.
- No eyebrows or section numbers. Question numbers are ordinal content, not decoration.
- Logo (`public/icon.svg`), used as the favicon and as the wordmark mark at 1.5em: on a transparent background, a paper boat sails in front of an orange circle sun. The circle is the one exception to radius 0, because it's an illustration rather than UI. The boat is flat facets in paper, with its shaded sail side in rule, and a 1-unit ink outline only where the hull sits outside the sun, so it stays visible on paper. The touch icon sits on paper, because iOS fills transparency with black. Its hex values mirror the tokens, so update it when the palette changes, then re-export `favicon.ico` (32px) and `apple-touch-icon.png` (180px).

## What pages MUST share
Wordmark with the boat logo, Fraunces/Geist/Geist Mono roles, accent placement, square CTAs, hairline divider language, N1a nav, Ft1 footer.

## Exports

### tokens.css
See `public/tokens.css` (the source of truth).
