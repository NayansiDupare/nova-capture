# Nova Capture — Design System

> Version 1.0 · 11 October 2026
> Stack: React · Tailwind CSS · Lucide icons · CSS custom properties for tokens

---

## 1. Design principles

1. **Stay out of the way.** The user is watching something else. Nova should be quiet, small and never steal focus.
2. **Always honest about recording.** If audio is being captured, it is visible. No exceptions.
3. **Calm, focused, readable.** Notes are for reading and re-reading. Typography beats decoration.
4. **Show trust signals.** Timestamps, uncertain terms and grounding flags make AI output checkable.
5. **Errors explain and offer an action.** Never a dead end.

---

## 2. Color tokens

All colors are CSS variables on `:root`, with a dark theme override. Components use tokens only, never raw hex.

### 2.1 Neutrals and surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F7F8` | `#0F1115` | App background |
| `--surface` | `#FFFFFF` | `#171A21` | Cards, panels |
| `--surface-2` | `#F0F1F3` | `#1E222B` | Inputs, hover, nested surfaces |
| `--border` | `#E2E4E8` | `#2A2F3A` | Dividers, outlines |
| `--text` | `#14161A` | `#E8EAEE` | Primary text |
| `--text-muted` | `#5B6170` | `#9AA1AE` | Secondary text, metadata |
| `--text-subtle` | `#8A909C` | `#6B7280` | Placeholders, disabled |

### 2.2 Brand and semantic

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | `#5B5BD6` | `#8B8BF5` | Primary actions, links, focus |
| `--primary-fg` | `#FFFFFF` | `#0F1115` | Text on primary |
| `--recording` | `#E5484D` | `#FF6369` | **Only** for active recording |
| `--paused` | `#F5A524` | `#FFB84D` | Paused capture |
| `--processing` | `#0091FF` | `#52A9FF` | Transcribing / generating |
| `--success` | `#30A46C` | `#4CC38A` | Saved, done |
| `--warning` | `#F5A524` | `#FFB84D` | Low speech, uncertain terms |
| `--danger` | `#E5484D` | `#FF6369` | Destructive actions, errors |

> 🔴 **Rule:** `--recording` red is reserved for "audio is being captured right now." Don't use it for anything else except destructive buttons, which use `--danger` (same hue, different meaning by context).

### 2.3 CSS

```css
:root {
  --bg: #F7F7F8; --surface: #FFFFFF; --surface-2: #F0F1F3; --border: #E2E4E8;
  --text: #14161A; --text-muted: #5B6170; --text-subtle: #8A909C;
  --primary: #5B5BD6; --primary-fg: #FFFFFF;
  --recording: #E5484D; --paused: #F5A524; --processing: #0091FF;
  --success: #30A46C; --warning: #F5A524; --danger: #E5484D;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0F1115; --surface: #171A21; --surface-2: #1E222B; --border: #2A2F3A;
    --text: #E8EAEE; --text-muted: #9AA1AE; --text-subtle: #6B7280;
    --primary: #8B8BF5; --primary-fg: #0F1115;
    --recording: #FF6369; --paused: #FFB84D; --processing: #52A9FF;
    --success: #4CC38A; --warning: #FFB84D; --danger: #FF6369;
  }
}
:root[data-theme="dark"] { /* same values as the dark block above */ }
```

### 2.4 Tailwind mapping

```js
// tailwind.config.js (excerpt)
theme: {
  extend: {
    colors: {
      bg: 'var(--bg)', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)',
      border: 'var(--border)', text: 'var(--text)', muted: 'var(--text-muted)',
      subtle: 'var(--text-subtle)', primary: 'var(--primary)', 'primary-fg': 'var(--primary-fg)',
      recording: 'var(--recording)', paused: 'var(--paused)', processing: 'var(--processing)',
      success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
    },
  },
}
```

---

## 3. Typography

| Role | Font | Size / line height | Weight |
|---|---|---|---|
| Display (screen titles) | Inter | 24 / 32 | 600 |
| Heading (note title) | Inter | 20 / 28 | 600 |
| Subheading | Inter | 16 / 24 | 600 |
| Body | Inter | 15 / 24 | 400 |
| Small / metadata | Inter | 13 / 20 | 400 |
| Caption | Inter | 12 / 16 | 500 |
| Mono (timestamps, timer) | JetBrains Mono | 13 / 20 | 500 |

- Bundle fonts locally (no remote font loading; see [SECURITY.md](../SECURITY.md) CSP).
- Fallback stack: `Inter, "Segoe UI", system-ui, sans-serif`.
- Note body text max width: **72ch** for readability.
- Use `font-variant-numeric: tabular-nums` for the recording timer.

---

## 4. Spacing, radius, elevation

**Spacing scale (4 px base):** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Badges, tags, small buttons |
| `--radius-md` | 10px | Buttons, inputs |
| `--radius-lg` | 14px | Cards, dialogs |
| `--radius-full` | 9999px | Overlay pill, status dots |

| Elevation | Shadow | Use |
|---|---|---|
| 0 | none | Flat surfaces |
| 1 | `0 1px 2px rgb(0 0 0 / .06)` | Cards |
| 2 | `0 4px 12px rgb(0 0 0 / .10)` | Popovers, menus |
| 3 | `0 12px 32px rgb(0 0 0 / .18)` | Dialogs, overlay |

---

## 5. Motion

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | Entrances |
| `--dur-fast` | 120ms | Hover, press |
| `--dur-base` | 200ms | Panels, toasts |
| `--dur-slow` | 320ms | Overlay state change |

- Recording dot pulses gently (1.6 s cycle).
- Respect `prefers-reduced-motion`: disable pulse and slide animations, keep opacity fades only.

---

## 6. Iconography

- **Lucide** icons only, 1.75 stroke width.
- Sizes: 16 (inline), 20 (buttons), 24 (empty states, overlay).
- Icon-only buttons **must** have an `aria-label` and a tooltip.

| Action | Icon |
|---|---|
| Start capture | `Circle` (filled, `--recording`) |
| Stop | `Square` |
| Pause / resume | `Pause` / `Play` |
| Processing | `Loader2` (spinning) |
| Done | `CheckCircle2` |
| Error | `AlertCircle` |
| Search | `Search` |
| Favorite | `Star` |
| Settings | `Settings` |
| Uncertain term | `HelpCircle` |
| Timestamp | `Clock` |

---

## 7. Components

| Component | Variants / states | Notes |
|---|---|---|
| **Button** | primary, secondary, ghost, danger · sm, md · loading, disabled | One primary button per view |
| **IconButton** | ghost, subtle | Requires `aria-label` |
| **Input / SearchInput** | default, focus, error | SearchInput has `Ctrl+K` hint |
| **Card** | default, interactive | Interactive cards show hover elevation |
| **NoteCard** | default, favorite | Title, gist (2 lines max), tags, date, source app |
| **Tag** | default, selected | Lowercase text, `--radius-sm` |
| **StatusPill** | idle, listening, paused, processing, done, error | Color + icon + text (never color alone) |
| **LevelMeter** | — | 12 bars, throttled updates, hidden for reduced motion |
| **TimestampChip** | default, hover | Mono font; click jumps to transcript segment |
| **UncertainTerm** | — | Dotted `--warning` underline + `HelpCircle` tooltip |
| **GroundingFlag** | — | Small `--warning` badge "Not found in transcript" |
| **Toast** | info, success, warning, error | Bottom-right, auto-dismiss 5 s except errors |
| **Dialog** | default, destructive | Focus trapped; Esc closes |
| **EmptyState** | — | Icon, one line, one action |
| **Banner** | warning, error | For recovery and quota messages, with action button |

---

## 8. Floating overlay

A small pill (approx. 180 × 44 px), frameless, always on top, never takes focus.

| State | Visual | Content |
|---|---|---|
| **Idle** | `--surface` with border | `Circle` icon + "Capture" |
| **Listening** | Red dot pulsing, red 2px border | Timer `00:12:34` + pause + stop |
| **Paused** | Amber dot, no pulse | Timer (dimmed) + resume + stop |
| **Processing** | Blue spinner | "Transcribing…" / "Writing note…" |
| **Done** | Green check, fades after 4 s | "Note ready" (click opens review) |
| **Error** | Red alert icon | Short message, click opens details |

- Draggable; snaps to screen edges; position remembered per display.
- Hover reveals the controls; otherwise shows just the dot and timer.

---

## 9. Screens

| Screen | Layout | Key elements |
|---|---|---|
| **Home** | Single column | Big "Start capture" button, hotkey hint, recent notes |
| **Capture** | Centered | StatusPill, timer, LevelMeter, pause/stop, source app |
| **Review** | Two panes | Left: editable note. Right: transcript with timestamps. Save / Discard |
| **Library** | Sidebar + list | Search, tag filter, favorites, NoteCards |
| **Note detail** | Two panes | Note + transcript; clicking a TimestampChip scrolls the transcript |
| **Settings** | Sectioned form | Providers, API keys (write-only), hotkey, spend cap, privacy |
| **Recovery** | Banner + list | Interrupted sessions with Resume / Retry / Discard |

Minimum window size: **880 × 600**. Sidebar collapses below 1024 px.

---

## 10. Accessibility

- WCAG AA contrast (4.5:1 body text, 3:1 large text and UI parts).
- Visible focus ring on everything: `2px solid var(--primary)`, 2px offset.
- Full keyboard support. Shortcuts: `Ctrl+K` search, `Ctrl+S` save note, `Esc` close dialog.
- Status is never color-only: always pair color with icon and text.
- Live regions (`aria-live="polite"`) announce state changes such as "Recording started" and "Note ready".

---

## 11. Voice and copy

- **Plain, short, friendly.** "Note ready" not "Note generation process completed successfully."
- **Say what happened and what to do.** "Couldn't reach the transcription service. We'll retry automatically. [Retry now]"
- **No blame.** "Little speech detected" not "Your audio is bad."
- **Sentence case** for buttons and headings: "Start capture", not "Start Capture".
- **Be honest about AI.** Label AI-generated content and uncertain terms clearly.
