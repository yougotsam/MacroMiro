# Envelope — Phosphor Desk

## Feel
Dense, amber, blunt. A 2026 pit monitor: near-black canvas, phosphor labels, last price in italic serif. Not a SaaS dashboard. Not Inter. Not blue-500.

References (Sept 2026): Bloomberg orange as *text*, never a wash ([Bloomberg DS](https://www.shadcn.io/design/bloomberg)); amber-on-black terminals ([NAV floor](https://github.com/navdotfun/NAV)); dark-first WCAG 4.5:1, green/red tape only ([Lollypop, June 2026](https://lollypop.design/blog/2026/june/trading-app-design/)).

## Colors
| Role | Token | Use |
|---|---|---|
| Background | `bg-background` (`bg-bg`) | Void. No grid. |
| Foreground | `text-foreground` (`text-fg`) | Body, last, equity |
| Card | `bg-card` (`bg-surface`) | Panels |
| Muted | `text-muted-foreground` (`text-muted`) | Secondary copy |
| Subtle | `text-subtle` | Amber-dim labels, timestamps |
| Primary | `bg-primary` `text-primary` | Selected control, kicker. Amber phosphor. |
| Border | `border-border` | Hairlines |
| Up | `text-armed` | Tape up |
| Down | `text-down` | Tape down, sit bind |
Amber is the only accent. Green/red are tape, not brand. No purple.

## Typography
- Last print / equity: Newsreader italic (`font-display`)
- Body: IBM Plex Sans 400/500
- Tape / kickers: IBM Plex Mono 400/500, `uppercase tracking-widest` on panel labels
- Scale: 12 / 14 / 16 / 18 / 24 (`text-xs sm base lg 2xl`). No 5xl on chrome.
- Body 16px, line-height 1.5. Headings 1.1–1.2
- Paragraphs `max-w-prose`. Numbers `tabular-nums`

## Spacing & Layout
- 8-point: 2, 4, 6, 8, 12, 16, 24. No `p-5` / `m-3` / `gap-7`
- Desk: `px-4 sm:px-6 lg:px-8`, card `p-4 sm:p-6`
- Radius: `--radius: 0.125rem` (2px). Square Bloomberg, not shadcn 8px
- Shadows: `shadow-sm` hairline only

## Motion
- Interaction only: hover, focus, open. 150ms. `transition-colors`
- `active:scale-95`. No loops, pulse, bounce
- Honor `prefers-reduced-motion`

## States
Hover, `focus-visible` ring, disabled opacity 40%. Every control.

## Content
Headlines 3–8 words. Buttons 1–3 words, verb first. Desk copy: sit, 15m, event.

## Do
- Dark-only product (`html.dark`). Light tokens exist for contrast proof only.
- Token classes only
- Lucide icons, one stroke

## Don't
- Inter as the face
- Purple / glass / emoji
- Mixing radii
- Developer notes in chrome
- Amber as a page wash

## Anti-patterns
Purple-indigo heroes. Graph-paper backgrounds. 5xl last-price. Arbitrary `p-[13px]`. Hardcoded hex in components.

## Design Check
Audit this screen against DESIGN.md. Report:
1) any hardcoded hex/rgb or arbitrary Tailwind values like p-[13px] — list file:line and replace with tokens;
2) spacing values not on the 8-point list;
3) font sizes/weights outside the scale;
4) interactive elements missing hover or focus-visible;
5) animations that are decorative or longer than 250ms;
6) contrast ratio regressions — recompute body-on-background and primary-foreground-on-primary for light and dark, flag anything under 4.5:1.
Fix all six, then show the diff.
