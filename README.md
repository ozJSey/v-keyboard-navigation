# @ozjsey/v-keyboard-navigation

**One tab stop for a group of controls.** A Vue 3 directive that adds roving tabindex, arrow keys,
`Home`/`End`, typeahead and `PageUp`/`PageDown` to markup you already have.

[![npm](https://img.shields.io/npm/v/@ozjsey/v-keyboard-navigation)](https://www.npmjs.com/package/@ozjsey/v-keyboard-navigation)

## The problem

Roving-tabindex libraries — Radix, Reka, Primer, keyux, makeup — contain **zero** occurrences of
`scrollIntoView`, and that is deliberate: the APG says one benefit of roving tabindex over
`aria-activedescendant` is that *"the user agent will scroll the newly focused element into view."*

**But the user agent scrolls badly.** It **centres** the focused item, so a five-row viewport
lurches three rows at a time and the list jumps under the user's eyes.

## The solution

The same roving tabindex every other implementation gives you, plus the scroll they hand back to the
browser — [hold ArrowDown against the live trace](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/listbox-scroll). Measured in headless
Chrome — a 200px viewport, 40px rows, one `ArrowDown` per step, `scrollTop` read back after each key:

| | `scrollTop` after each key |
|---|---|
| `focus()` — what every primitive ships | `0,0,0,0,`**`120,120,120,240,240,240,360,360`** |
| `focus()` **then** `scrollIntoView({block:'nearest'})` | `0,0,0,0,`**`120,120,120,240,240,240,360,360`** |
| `focus({preventScroll:true})` **then** `'nearest'` | `0,0,0,0,`**`40,80,120,160,200,240,280,320`** |

Look at the middle row: it is **identical** to doing nothing at all. The UA has already centred the
item, so `nearest` finds it on screen and does nothing — `preventScroll: true` is mandatory and the
order is load-bearing. `block: 'nearest'` gives the one-row follow every quality implementation
wants, and `smooth` is the wrong default here, so this defaults to `instant`.

**It never writes `role`, and never writes selection state** — no `aria-selected`, no
`aria-checked`, no `checked`. Naming a pattern changes key handling, nothing else; your model owns
the rest.

## Install

```bash
npm install @ozjsey/v-keyboard-navigation
```

Requires Vue 3.

```ts
import { createApp } from 'vue'
import { KeyboardNavigationPlugin } from '@ozjsey/v-keyboard-navigation'
import App from './App.vue'

createApp(App).use(KeyboardNavigationPlugin).mount('#app')
```

## Usage

### A bare group

```vue
<template>
  <ul v-keyboard-navigation>
    <li><button>Bold</button></li>
    <li><button>Italic</button></li>
    <li><button>Underline</button></li>
  </ul>
</template>
```

That is the whole setup. Tab reaches the group once; the arrows move inside it; `Home`/`End` jump
to the ends; typing a letter jumps to the matching item; the focused item is scrolled into view one
step at a time. No wrapper components, no options, no composable.

The binding also accepts a bare role — `v-keyboard-navigation="'menu'"` is `{ role: 'menu' }` —
which is what decides the axis, whether the ends wrap, and whether `aria-disabled` items are
skipped.

### Pin the scroller

```vue
<script setup lang="ts">
const options = {
  scroll: { container: ':scope .scroll-pane', offset: { top: 48 } },
}
</script>

<template>
  <ul v-keyboard-navigation="options" role="listbox">…</ul>
</template>
```

A selector is always resolved against **this group's host**, never against the document, so a
component rendered twice scrolls its own pane. `offset` leaves a gap for a sticky header.

### Hover as an input

```vue
<script setup lang="ts">
const options = { role: 'menu', hover: true } as const
</script>

<template>
  <ul v-keyboard-navigation="options" role="menu">…</ul>
</template>
```

Every serious menu and combobox does this: arrow to item 3, move the mouse over item 7, press
ArrowDown — you land on item 8, not item 4. It is off by default, because silently moving the
active item is right for a menu and wrong for a toolbar.

## Everything else

**[The `v-keyboard-navigation` playground tab](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation)** is the reference: every option, every
event, every `data-*` state, driven in a real browser and editable as you read.

- [The scroll wedge](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/listbox-scroll) — 200 rows in a 200px box, printing the
  `scrollTop` trace as you hold ArrowDown, with a tickbox to hand the scroll back to the browser
  and feel the difference
- [Skipping](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/skipping) — what the arrows step over, why it is three piles not
  two, and the group where every row is skipped and the tab stop has to survive anyway
- [Hover as an input](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/hover) and
  [the combobox it exists for](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/combobox) — hover that never blurs your input
- [Two instances, one selector](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/two-instances) ·
  [the one-tabbable invariant under mutation](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/dynamic-list) ·
  [the imperative api](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/api)
- [The screen-reader walkthrough](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/screen-reader) — a script for a manual pass. In
  NVDA/JAWS virtual cursor the arrow keys never reach this handler at all, so until somebody runs
  it, screen-reader behaviour here is **unproven**, not passing.

[`CHANGELOG.md`](./CHANGELOG.md) · [`ARCHITECTURE.md`](https://github.com/ozjsey/v-keyboard-navigation/blob/main/ARCHITECTURE.md)

## License

MIT © Ozgur Seyidoglu
