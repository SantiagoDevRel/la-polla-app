# La Polla Colombiana · Design System

**Name:** Tribuna Caliente
**Version:** 0.1 (Nov 2026, Mundial 2026 era)
**Scope:** Mobile-first, desktop-responsive. Dark theme only.
**Core idea:** Stadium at night + Colombian warmth + betting-product numeric confidence. Gold is the reward signal, amber is urgency, turf green is live. Pollito lives in hero moments, not wallpaper.

This document is authoritative. `CLAUDE.md` references it. When building any UI, read this first.

---

## 1. Design tokens

### 1.1 Color palette

All colors are defined as CSS custom properties on `:root` in `app/globals.css`. Never hardcode hex in components.

```css
:root {
  /* ─── surfaces ─── */
  --bg-base:         #080c10;  /* app background, deep blue-black */
  --bg-card:         #0e1420;  /* default card surface */
  --bg-elevated:     #131b2b;  /* hover, selected, modals, highest elevation */
  --bg-subtle:       #0b1119;  /* inset panels inside cards */

  /* ─── brand accents ─── */
  --gold:            #FFD700;  /* reward signal — use sparingly */
  --gold-dim:        #b8990a;  /* pressed/darker gold edge */
  --amber:           #FF9F1C;  /* urgency, countdowns, lock-soon */
  --amber-dim:       #aa6a0c;
  --turf:            #1FD87F;  /* live, locked-in, correct */
  --turf-dim:        #0d8a4e;

  /* ─── semantic ─── */
  --red-alert:       #FF3D57;  /* wrong predictions, errors, destructive */

  /* ─── text ─── */
  --text-primary:    #F5F7FA;  /* headlines, body, interactive labels */
  --text-secondary:  #AEB7C7;  /* secondary labels, captions */
  --text-muted:      #6B7689;  /* least emphasis, placeholders */

  /* ─── borders ─── */
  --border-subtle:   rgba(255, 255, 255, 0.06);
  --border-default:  rgba(255, 255, 255, 0.10);
  --border-strong:   rgba(255, 255, 255, 0.18);

  /* ─── radius ─── */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;

  /* ─── fonts ─── */
  --font-display: 'Bebas Neue', sans-serif;
  --font-body: 'Outfit', sans-serif;
}
```

### 1.2 Color usage rules (enforced)

| Token | Allowed uses | Forbidden uses |
|---|---|---|
| `--gold` | #1 rank, exact-match prediction, primary CTA (one per screen), logo, champion crown | Everything else. Not for body text, not for borders, not for secondary buttons. |
| `--amber` | Countdowns, lock-soon states, "your turn" nudges, mid-rank encouragement | Do not use for success. Do not use for errors. |
| `--turf` | Live match indicators, locked-in prediction confirmation, correct-prediction flash | Do not use for buttons. Do not use for branding. |
| `--red-alert` | Wrong predictions, destructive actions, error states, "kick out" | Do not use for general emphasis. Do not use for countdowns (that is amber). |
| `--text-muted` | Placeholders, disabled, timestamps, meta | Never for primary body text |

**The "gold test":** if gold appears more than 3 distinct times per visible screen, remove one. Gold has to feel like a medal, not like wallpaper.

### 1.3 Radius usage

- `--radius-sm` (8px): chips, pills, small inputs
- `--radius-md` (12px): buttons, inputs, score input cells
- `--radius-lg` (18px): cards, polla cards, match cards, modals
- `--radius-xl` (24px): hero cards (match of the day), sheet dialogs

### 1.4 Spacing

Tailwind default scale. Use `p-4`, `p-5`, `gap-3`, etc. Section vertical rhythm: 24px (`py-6`) between sections on mobile, 32px (`py-8`) on desktop.

### 1.5 Shadows and glows

Dark theme requires restraint. Only 3 allowed shadow patterns:

```css
/* 1. Elevated card (hover) */
box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);

/* 2. Primary CTA gold glow */
box-shadow: 0 8px 24px -6px rgba(255, 215, 0, 0.4);

/* 3. Leader polla card aura */
box-shadow: 0 0 30px -10px rgba(255, 215, 0, 0.2);
```

No drop-shadows on text. No multi-layer neumorphism. No neon. Glow is reserved for `is-leader` and primary CTA.

---

## 2. Typography

### 2.1 Fonts

Two families. Load both via `next/font/google` in `app/layout.tsx`.

```tsx
import { Bebas_Neue, Outfit } from 'next/font/google'

const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-display' })
const outfit = Outfit({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' })
```

### 2.2 Scale

| Role | Font | Size / line | Letter-spacing | Where |
|---|---|---|---|---|
| Hero display | Bebas Neue | 56px / 1 | 0.02em | "Santiago" greeting, main screen title |
| Score large | Bebas Neue | 40px / 1 | 0.02em | Match of the day "VS", final score |
| Score medium | Bebas Neue | 30px / 1 | 0.05em | Bet-slip score inputs, podium points |
| Section header | Bebas Neue | 20px / 1 | 0.04em, UPPERCASE | "MIS POLLAS", "EN VIVO" |
| Chip / countdown | Bebas Neue | 16–18px | 0.06em | "2H 14M", "LIVE 67'" |
| Polla name | Outfit 700 | 18px / 1.3 | -0.01em | Card titles, polla names |
| Body | Outfit 500 | 15px / 1.45 | 0 | Default paragraph text |
| Body small | Outfit 400 | 13px / 1.5 | 0 | Captions, secondary text |
| Label uppercase | Outfit 600 | 11px / 1.4 | 0.08em, UPPERCASE | Meta labels, chip text |

Weights allowed for Outfit: **400, 500, 600, 700**. No 800/900.

### 2.3 Tabular figures (critical)

Anywhere numbers appear in columns, rankings, scores, or stat blocks:

```css
font-feature-settings: "tnum";
```

Put this on `.score`, `.stat-number`, `.podium-pts`, `.countdown`, `.amount`. Without this, digits have uneven widths and scores visually jitter.

---

## 3. Core components

### 3.1 Button system

Three variants. All pill-shaped (`border-radius: 9999px`).

```tsx
// Primary — gold filled, dark text, glow
<button className="btn-primary">Crear polla</button>

// Secondary — elevated bg, white text, subtle border
<button className="btn-secondary">Ver detalles</button>

// Danger outline — transparent bg, red text, red border
<button className="btn-danger-outline">Cerrar sesión</button>
```

Only ONE primary button per screen. Never stack two golds side by side.

```css
.btn-primary {
  background: var(--gold);
  color: var(--bg-base);
  font-family: var(--font-display);
  font-size: 18px;
  letter-spacing: 0.06em;
  padding: 14px 22px;
  border-radius: 9999px;
  box-shadow: 0 8px 24px -6px rgba(255, 215, 0, 0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.btn-primary:hover { transform: translateY(-1px); }
.btn-primary:active { transform: scale(0.98); }
```

### 3.2 Status chips

Inline pills with optional pulse indicator. Always uppercase, `letter-spacing: 0.06em`, font size 11px.

Variants:
- `.chip-live` — turf bg tint, turf text, pulsing green dot
- `.chip-locks` — amber bg tint, amber text, pulsing amber dot
- `.chip-leader` — gold bg tint, gold text, no pulse (static signal)
- `.chip-final` — muted bg, muted text, no pulse
- `.chip-wrong` — red bg tint, red text

### 3.3 Match hero card (match of the day)

Used on Inicio. One per screen maximum.

Anatomy (top to bottom):
1. Meta strip — tournament pill left, date/time right, 10–11px uppercase muted
2. Teams row — 3-column grid: `home crest + name · big "VS" · away crest + name`
3. Preds strip — 2-col: "Tu pred" (gold) · "Promedio polla" (secondary)
4. Lock countdown — amber pill at bottom with pulse

Container:
```css
background: linear-gradient(180deg, rgba(255, 215, 0, 0.06) 0%, var(--bg-card) 50%);
border: 1px solid rgba(255, 215, 0, 0.25);
border-radius: var(--radius-xl);
padding: 20px;
```

Plus the top-right corner glow:
```css
&::before {
  content: ''; position: absolute; top: -40px; right: -40px;
  width: 140px; height: 140px;
  background: radial-gradient(circle, rgba(255, 215, 0, 0.15), transparent 70%);
}
```

### 3.4 Match bet-slip card (3 states)

Lives inside polla detail page. Three distinct visual states. Same layout, different tokens.

**State A — upcoming (editable):**
- Header: amber pulse + "Próximo · bloquea en Xh Ym"
- Border: `rgba(255, 159, 28, 0.25)`
- Bg: subtle amber-tinted gradient
- Score inputs: 48×56 cells, 2px gold border, gold text (30px Bebas)
- Footer: polla context ("3 of 5 predicted", polla average) + "Guardar" primary button

**State B — locked (read-only, kickoff soon/already started):**
- Header: lock icon + "Bloqueado · empieza en Xh" (muted)
- Border: default subtle
- Bg: `var(--bg-card)`
- Score inputs: displayed, not editable, `opacity: 0.85`

**State C — final (settled):**
- Header: turf pulse + "Final · ganaste X pts" (or red + "Final · 0 pts" if wrong)
- Border: `rgba(255, 215, 0, 0.25)` if any points, else subtle
- Bg: gold-tinted gradient if exact match, else default
- Score shows in gold (exact) or secondary
- Footer: social context ("Solo vos acertaste el exacto") + points badge

### 3.5 Polla card (carousel variant)

For the "Mis pollas" horizontal carousel on Inicio.

- Width: 210px fixed, flex-shrink: 0
- States: default / `is-leader` (gold aura + top border glint)
- Anatomy: comp tag row · polla name · stats row ($amount, jugadores) · progress footer (pts, partidos pending)

```css
.polla-card.is-leader {
  border: 1px solid rgba(255, 215, 0, 0.4);
  background: linear-gradient(180deg, rgba(255, 215, 0, 0.06) 0%, var(--bg-card) 100%);
  box-shadow: 0 0 30px -10px rgba(255, 215, 0, 0.2);
}
.polla-card.is-leader::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
}
```

### 3.6 Podium leaderboard

Used on Inicio (top 3 of featured polla) and inside polla detail ranking tab.

Structure: 3-column grid (`1fr 1.2fr 1fr`), align-items: end, 150px height.

- #1 column: center position, 52px avatar with gold border + gold glow, gold points, tallest bar (64px gold gradient)
- #2 column: left, 40px avatar silver border, silver-gray points, 44px silver-gray bar
- #3 column: right, 40px avatar amber border, amber points, 32px amber gradient bar

Each bar shows the rank number in large Bebas Neue. This replaces the current flat-row leaderboard.

### 3.7 Live match chip (horizontal scroll pills)

For the "En vivo y próximos" strip on Inicio.

- Min-width: 150px, flex-shrink: 0
- Variants:
  - `.live-chip.live` — turf border, live pulse, "VIVO 67'" status top, score in turf color
  - `.live-chip.upcoming` — default border, date/time top, teams with em-dash separator
- Optional `.my-pred` footer line: muted normally, turf if correct, red if wrong

### 3.8 Bottom navigation

Floating pill with 5 slots, center one elevated into a FAB.

```css
.bottom-nav {
  position: fixed;
  bottom: 14px;
  left: 14px;
  right: 14px;
  height: 76px;
  background: rgba(14, 20, 32, 0.92);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-subtle);
  border-radius: 28px;
}
```

Center FAB: 58px gold circle, "+" in Bebas Neue 32px, lifted `margin-top: -24px`, 4px ring of bg-base to separate from nav, gold drop glow.

Active tab: gold color + fill. Inactive: muted.

Icons: use Lucide or inline SVG, 22px stroke 2.

### 3.9 Pollito avatar (in UI)

- Small (leaderboard rows, nav-top): 40px circle
- Medium (podium #2, #3): 40px circle with colored border
- Large (podium #1): 52px circle with gold border + gold glow
- Extra-large (profile hero): 96px circle with gold border

Border accent rules:
- Border only if user has notable rank (gold if #1 globally or in featured polla)
- Otherwise `border: 1.5px solid var(--border-default)`

### 3.10 Scoring explainer (NO emoji)

Replaces the current emoji-laden list. Each row has an SVG icon in 22×22 box.

```
[target svg]     Marcador exacto       5 PTS (gold)
[arrows svg]     Ganador + diferencia  3 PTS (white)
[check svg]      Ganador correcto      2 PTS (white)
[1-box svg]      Goles de un equipo    1 PT  (secondary)
[x-circle svg]   Sin aciertos          0 PTS (muted)
```

All icons: `stroke-width: 2`, stroke is `currentColor`, color matches points color. Lucide icon names: `Target`, `ArrowUpDown`, `Check`, (custom 1-in-box), `XCircle`.

---

## 4. Screen layout patterns

### 4.1 Mobile container

```css
.mobile-container {
  max-width: 480px;
  margin: 0 auto;
  padding-bottom: 110px; /* room for bottom nav */
}
```

All pages live inside this container.

### 4.2 Desktop layout

At `min-width: 1024px`, introduce a 2-column grid:

```css
@media (min-width: 1024px) {
  .app-shell {
    display: grid;
    grid-template-columns: minmax(0, 480px) minmax(0, 360px);
    gap: 32px;
    max-width: 900px;
    margin: 0 auto;
  }
}
```

Right column shows contextual side-panel:
- On Inicio: "Próximos 24h" + "Tus stats globales" + tips
- On Polla detail: live leaderboard + chat placeholder
- On Profile: achievement history

On Polla create flow: right column shows a live preview of the polla being created.

On tablets (768–1023px), single-column centered at 480px.

### 4.3 Safe areas

```css
.screen {
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: calc(env(safe-area-inset-bottom, 0) + 110px);
}
```

---

## 5. Pollito behavior system

Confirmed decision: pollito protagonist, Duolingo-style. Lives in specific moments, silent elsewhere.

### 5.1 States and assets

Assets already exist at `/public/pollitos/`. Format: `pollito_{type}_{estado}.webp`

Types: 17 characters (árbitro, arquero, capitán, goleador, etc.) — see memory.
States per character: `base` · `lider` · `peleando` · `triste`

Resolve user's pollito type from `users.avatar_url` column (string key).

### 5.2 State mapping logic

```ts
// lib/pollito/state.ts
export type PollitoEstado = 'base' | 'lider' | 'peleando' | 'triste';

export function resolvePollitoState(context: {
  rank?: number;           // position in polla
  totalPlayers?: number;
  recentDelta?: number;    // pts gained in last settle
  wrongStreak?: number;    // consecutive wrong
  isOnboarding?: boolean;
  isEmptyState?: boolean;
}): PollitoEstado {
  const { rank, totalPlayers, recentDelta, wrongStreak, isOnboarding, isEmptyState } = context;

  if (isOnboarding || isEmptyState) return 'base';
  if (rank === 1) return 'lider';
  if (wrongStreak && wrongStreak >= 3) return 'triste';
  if (rank && totalPlayers && rank === totalPlayers) return 'triste';
  if (rank && rank >= 2 && rank <= 4) return 'peleando';
  return 'base';
}
```

### 5.3 Scripted moments (where pollito appears)

Only these 8 moments. Nothing else. If a feature asks for pollito outside this list, push back.

| Moment | State | Trigger | Example copy |
|---|---|---|---|
| **M1 · Onboarding welcome** | base | First login after phone verification | "¿Primera polla? Dale. Yo te acompaño." |
| **M2 · First polla created** | lider | User completes `POST /pollas` flow | "¡Listo! Tu polla está viva. Invita a los panas." |
| **M3 · Exact match hit** | lider | `score_update` event where `delta === 5` | "¡Pegaste el {home}-{away} exacto! +5 puntos." |
| **M4 · Rank climb** | lider or peleando | User moves up ≥ 2 positions | "Subiste {n} puestos. {if rank===1 'Cima.' else 'Seguí así.'}" |
| **M5 · Neck-and-neck** | peleando | `leaderboard_diff < 3 pts` with rival · rank 2-4 | "Estás a {n} pts de {rival}. Un exacto y te despegás." |
| **M6 · Losing streak** | triste | 3 wrong predictions in a row | "Uff. Tres seguidas. Pero un exacto vale 5. Todavía." |
| **M7 · Polla ended — winner** | lider | Polla final score settled, user ranks 1 | "¡Ganaste la polla {nombre}! Cobrá tu premio." |
| **M8 · Polla ended — loser** | triste | Polla final score settled, user NOT in top 3 | "Polla terminada. No te fue. La próxima es tuya." |

### 5.4 Appearance rules

- **Maximum 1 pollito appearance per user-flow.** Do not stack celebrations.
- **Never in transactional flows:** create-polla wizard, pagos, invite, login.
- **Dismissible:** user can tap to dismiss. Store `dismissed_at` in localStorage with moment key; do not re-show same moment within 24h.
- **Animation:** 400ms spring ease-in from bottom. No bounce loop.
- **Copy rules:** casual Colombian Spanish. Max 2 short sentences. No emoji. No exclamation marks except on celebrations.

### 5.5 PollitoMoment component contract

```tsx
interface PollitoMomentProps {
  moment: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8';
  estado: PollitoEstado;
  userPollitoType: string; // resolved from users.avatar_url
  title: string;
  dialog: string;
  onDismiss?: () => void;
  cta?: { label: string; action: () => void };
}
```

Use Vaul bottom-sheet for M1, M2, M7, M8 (full-attention moments).
Use inline card for M3, M4, M5, M6 (non-blocking context).

---

## 6. Motion and interaction

### 6.1 Allowed animations

- Fade + translate: 200ms ease-out (page transitions, card appearance)
- Spring pop: Framer Motion `type: "spring", stiffness: 300, damping: 25` (pollito appearance, celebration bursts)
- Pulse: 1.8–2.0s infinite (live indicators, amber lock warnings)
- Countdown tick: no animation — just update number (jitter looks bad)

### 6.2 Interactive feedback

- Buttons: `:active { transform: scale(0.98) }` 100ms
- Cards (tappable): `:active { transform: scale(0.985) }` 100ms
- Score inputs: focus border goes gold, slight scale-up
- Swipe gestures: only for horizontal strips (matches, pollas); never on primary tap-targets

### 6.3 Reduced motion

Respect `prefers-reduced-motion: reduce`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .pulse-amber, .pulse-green { animation: none; }
}
```

---

## 7. What to kill (migration cleanup)

- [ ] Duplicate pollito in Inicio header — keep only user avatar top-right, wordmark left
- [ ] Emoji in Sistema de puntos section — replace with SVG (violates own rule today)
- [ ] "Partidos en curso" showing FINAL matches — fix data filter; rename section if needed
- [ ] "Ver todas" as a ghost card — replace with text link in section header
- [ ] Honor payment mode — already planned to remove per memory
- [ ] Flat leaderboard row — replace with podium for top 3 when ≥ 3 players
- [ ] Raw phone numbers displayed in profile — format with country code grouping
- [ ] Empty Explorar page — design contextual empty state with pollito M1 + create CTA

---

## 8. Accessibility minimums

- Contrast: all text passes WCAG AA (4.5:1 for body, 3:1 for large). Gold on dark-base passes; gold on white would fail and is not used.
- Focus states: visible ring on all interactive elements (`outline: 2px solid var(--gold); outline-offset: 2px`).
- Tap targets: minimum 44×44 px.
- Screen reader: all icon-only buttons have `aria-label`. Pulse animations have `aria-hidden="true"`.
- Never convey state by color alone — always pair with icon or text (e.g., "correcto" with check icon, not just turf color).

---

## 9. File locations

- `app/globals.css` — color tokens as CSS variables, base font setup
- `tailwind.config.ts` — extend theme to expose tokens as Tailwind utilities
- `lib/design/tokens.ts` — TypeScript const export of tokens for runtime access
- `components/ui/Button.tsx` — primary, secondary, danger variants
- `components/ui/Chip.tsx` — status chip variants
- `components/match/MatchHero.tsx` — match of the day card
- `components/match/MatchBetSlip.tsx` — match card with 3 states
- `components/polla/PollaCard.tsx` — polla card (carousel variant)
- `components/leaderboard/PodiumLeaderboard.tsx` — top 3 visual
- `components/nav/BottomNav.tsx` — floating nav + FAB
- `components/pollito/PollitoMoment.tsx` — mascot moment component
- `lib/pollito/state.ts` — pollito state resolver
- `lib/pollito/moments.ts` — M1–M8 config
