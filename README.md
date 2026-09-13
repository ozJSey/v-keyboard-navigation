# @ozjsey/v-keyboard-navigation

See in action: [npm portfolio playground](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation).

## Playground

Try the live examples in the [npm portfolio playground](https://github.com/ozJSey/npm-portfolio-playground).

**One tab stop for a group of controls.** A Vue 3 directive that adds roving tabindex, arrow keys,
`Home`/`End`, typeahead and `PageUp`/`PageDown` to markup you already have — and, unlike every
other roving-tabindex implementation, scrolls the list the way you actually wanted.

```bash
npm i @ozjsey/v-keyboard-navigation
```

```ts
import { createApp } from 'vue'
import { KeyboardNavigationPlugin } from '@ozjsey/v-keyboard-navigation'

createApp(App).use(KeyboardNavigationPlugin)
```

```vue
<ul v-keyboard-navigation>
  <li><button>Bold</button></li>
  <li><button>Italic</button></li>
  <li><button>Underline</button></li>
</ul>
```

That is the whole setup. Tab reaches the group once; the arrows move inside it; `Home`/`End` jump
to the ends; typing a letter jumps to the matching item; the focused item is scrolled into view one
step at a time. No wrapper components, no options, no composable.

## Why it exists

Roving-tabindex libraries — Radix, Reka, Primer, keyux, makeup — contain **zero** occurrences of
`scrollIntoView`, and that is deliberate: the APG says one benefit of roving tabindex over
`aria-activedescendant` is that *"the user agent will scroll the newly focused element into view."*

**But the user agent scrolls badly.** Measured in headless Chrome 152.0.7977.82 — a 200px
viewport, 40px rows, one `ArrowDown` per step, `scrollTop` read back after each key:

| | `scrollTop` after each key |
|---|---|
| `focus()` — what every primitive ships | `0,0,0,0,`**`120,120,120,240,240,240,360,360`** |
| `focus()` **then** `scrollIntoView({block:'nearest'})` | `0,0,0,0,`**`120,120,120,240,240,240,360,360`** |
| `focus({preventScroll:true})` **then** `'nearest'` | `0,0,0,0,`**`40,80,120,160,200,240,280,320`** |

The browser **centres** the focused item, so a five-row viewport lurches three rows at a time and
the list jumps under the user's eyes. `block: 'nearest'` gives the one-row follow every quality
implementation wants.

Look at the middle row: it is **identical** to doing nothing at all.

- **`focus()` and then `scrollIntoView({block:'nearest'})` is a silent no-op.** The UA has already
  centred the item, so `nearest` finds it on screen and does nothing. `preventScroll: true` is
  mandatory, and the order is load-bearing. (Reka UI 2.10.4 hits exactly this path, so its stated
  `nearest` intent does not take effect in Chromium.)
- **`smooth` is the wrong default here.** It needs >400ms to settle against a ~30ms key repeat, so
  the list visibly lags the focus ring. This package defaults to `instant`.

`aria-activedescendant` mode scrolls *nothing* — that is the genuine developer responsibility the
APG describes, and this directive takes it over.

## What it does not do

- **It never writes `role`.** A container that gains `role="listbox"` without `aria-selected` on
  every option is worse than plain markup. Naming a pattern changes key handling, nothing else.
- **It never writes selection state** — no `aria-selected`, no `aria-checked`, no `checked`. Your
  model owns that.
- **It never infers orientation from layout.** Orientation comes from `role`, `aria-orientation`
  or the option, never from measurement — otherwise the keyboard would change behaviour on resize.
- **It follows DOM order**, not CSS `order` or grid placement.
- **It never intercepts keys inside a text input, `select` or contenteditable**, and never calls
  `preventDefault()` on a key it did not act on.
- **It leaves native radio groups alone.** `<input type="radio">` already implements roving
  tabindex *and* moves the selection with the arrows; claiming the key would move focus while
  suppressing the check. `role="radio"` elements, which have no native behaviour, are driven
  normally.
- **App-level keyboard shortcuts are out of scope** — VueUse's `onKeyStroke` and `useMagicKeys`
  own that, and own it well.

## The patterns it implements

This implements **the keyboard interaction** of the following APG patterns. It does **not** make
your markup a listbox: roles, names and selection remain yours.

| Pattern | Status |
|---|---|
| Toolbar | ✅ horizontal, clamps, `Home`/`End`, typeahead |
| Tabs (tablist keys) | ✅ horizontal, wraps |
| Menu / Menubar (navigation only) | ✅ vertical / horizontal, wraps, typeahead |
| Listbox, single-select | ✅ vertical, clamps, controlled scroll, `aria-activedescendant` option |
| Radio Group | ✅ both axes, wraps (`role="radio"`; native radios are left to the browser) |
| Grid / 2D | ❌ not implemented — deferred, and a half-done grid is the worst outcome |
| Treeview | ❌ not implemented (expand/collapse and levels are a different problem) |
| Combobox | ❌ not implemented (it owns an input's keys, which this must never do) |
| Feed | ❌ not implemented |
| Carousel | ❌ not implemented |

Menu **activation** (Enter/Space opening a submenu, Escape closing it) is the application's:
this package moves focus and stays out of the way of both keys.

## Options

Every option exists to opt *out* of a default, or to describe something the DOM cannot tell us.

```vue
<ul v-keyboard-navigation="options">
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `enabled` | `boolean` | `true` | `false` restores every `tabindex` and stops handling keys. State becomes `disabled`. |
| `role` | `'toolbar' \| 'tablist' \| 'menu' \| 'menubar' \| 'listbox' \| 'radiogroup'` | read from `role` | Names the pattern when the host has no `role` attribute. Never written to the DOM. |
| `orientation` | `'inline' \| 'block' \| 'both'` (`'horizontal'` / `'vertical'` accepted) | per role, else `both` | Which arrows move focus. Also read from `aria-orientation`. |
| `wrap` | `boolean \| 'wrap' \| 'nowrap'` | per role | Whether the last item steps to the first. |
| `items` | `string` | every focusable descendant | CSS selector for the items, scoped to the host. |
| `memory` | `boolean` | `true` | Remember the last focused item across Tab out/in. `false` is `focusgroup`'s `nomemory`. |
| `typeahead` | `boolean` | `true` | Jump by typing a label. |
| `typeaheadTimeout` | `number` | `500` | Milliseconds before the buffer resets. |
| `homeEnd` | `boolean` | `true` | `Home` / `End` jump to the ends. |
| `page` | `boolean \| number` | `true` | `PageUp`/`PageDown` by a real visible page; a number fixes the step; `false` leaves the keys to the browser. |
| `activedescendant` | `boolean` | `false` | Keep focus on the host and track the item with `aria-activedescendant`. |
| `scroll` | `boolean \| KeyboardNavigationScrollOptions` | on | Controlled scroll. `false` hands scrolling back to the browser. |
| `ref` | `{ value: KeyboardNavigationApi \| undefined }` | — | Receives the imperative api. |
| `onNavigate` | `(detail) => void` | — | Called after every move. |

The binding also accepts a bare role: `v-keyboard-navigation="'menu'"` is `{ role: 'menu' }`.

### Scroll options

Same shape as [`v-scroll-into-view`](../v-scroll-into-view) — deliberately, so learning one teaches
the other. The code is separate: that package is declarative and edge-driven and defaults to
`smooth`; this one runs per keystroke, where `smooth` is wrong.

| Option | Type | Default | Notes |
|---|---|---|---|
| `container` | `HTMLElement \| string \| (() => HTMLElement \| null)` | — | Pin the scroller. `:scope <sel>` resolves with `el.closest()`. Resolving to nothing is a silent no-op — it never falls back to native. |
| `offset` | `{ top?: number; left?: number }` | — | Gap for a sticky header. Without a `container` it is written as an ephemeral `scroll-margin`. |
| `behavior` | `ScrollBehavior` | `'instant'` | |
| `block` | `ScrollLogicalPosition` | `'nearest'` | The one-item follow. |
| `inline` | `ScrollLogicalPosition` | `'nearest'` | |

```vue
<script setup lang="ts">
const options = {
  scroll: { container: ':scope .scroll-pane', offset: { top: 48 } },
}
</script>

<ul v-keyboard-navigation="options" role="listbox">…</ul>
```

## Defaults per role

| `role` | Arrows | Ends |
|---|---|---|
| `toolbar` | horizontal | clamp |
| `tablist` | horizontal | wrap |
| `menubar` | horizontal | wrap |
| `menu` | vertical | wrap |
| `listbox` | vertical | clamp |
| `radiogroup` | both | wrap |
| *(no role)* | both | clamp |

The first tab stop is the item carrying `aria-selected="true"`, `aria-checked="true"`,
`aria-current` (anything but `"false"`), or `:checked` — else the first item. After that it is
wherever the user last was.

## CSS hooks

| Attribute | Where | Values |
|---|---|---|
| `data-keyboard-navigation-state` | host | `idle` · `active` (focus is inside) · `empty` (**no focusable items — the group has left the keyboard**) · `disabled` |
| `data-keyboard-navigation-item` | every item | `active` on the one tabbable item, `inactive` on the rest |
| `data-keyboard-navigation-typeahead` | host | the live typeahead buffer; absent when empty |

```css
[data-keyboard-navigation-item='active'] {
  outline: 2px solid var(--focus);
}
/* In activedescendant mode the item never matches :focus, so this hook is
   the only way to show where the user is. */
```

## Events

`keyboard-navigate` bubbles from the host after every move, and `onNavigate` receives the same
detail object:

```ts
interface KeyboardNavigationEventDetail {
  item: HTMLElement
  index: number
  previousItem: HTMLElement | null
  previousIndex: number
  reason: 'key' | 'typeahead' | 'pointer' | 'api' | 'sync'
}
```

```vue
<ul v-keyboard-navigation @keyboard-navigate="onMove">…</ul>
```

## The imperative api

For what a keyboard cannot reach: opening a menu onto its first item, restoring a position after a
fetch, driving the group from elsewhere.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { KeyboardNavigationApi } from '@ozjsey/v-keyboard-navigation'

const nav = ref<KeyboardNavigationApi>()
// Build the options object HERE. Vue unwraps refs inside template
// expressions, so `v-keyboard-navigation="{ ref: nav }"` would hand the
// directive `nav.value` — `undefined` at mount.
const options = { ref: nav }
</script>

<template>
  <ul v-keyboard-navigation="options" role="listbox">…</ul>
  <button @click="nav?.first()">Top</button>
  <p>Item {{ (nav?.activeIndex ?? -1) + 1 }} of {{ nav?.items.length ?? 0 }}</p>
</template>
```

`items` · `activeIndex` · `activeItem` are shallow-reactive; `focus(index)` · `next()` ·
`previous()` · `first()` · `last()` · `refresh()` are methods.

## Exactly one tabbable item, always

This is the part that is easy to get wrong and impossible to notice.

A group that reaches **zero** tabbable items has vanished from the keyboard — Tab skips it, and
nothing errors. A group that reaches **two** has grown a second tab stop, often on a control the
user was just told is disabled. Both are one `v-for` re-render away, and neither is visible to the
developer who ships it.

The invariant is therefore maintained by a `MutationObserver`, not by Vue's `updated` hook — the
hook does not fire for DOM changes Vue did not make. Items appearing, disappearing, being
reordered, being disabled, being `v-show`n, or arriving from an async load all re-establish it. If
the tabbable item is removed while it had focus, focus is moved to the item that took its place
rather than being dropped onto `<body>`.

When a group genuinely has no focusable items, `data-keyboard-navigation-state="empty"` says so,
because a state with no signal is how this bug survives.

## Relationship to the platform's `focusgroup`

`focusgroup` is a real HTML attribute (Chrome 150, behind a flag; Firefox positive-pending). This
package uses its vocabulary on purpose — `toolbar | tablist | menu | menubar | listbox |
radiogroup`, `inline | block`, `wrap | nowrap`, memory — so the migration path is *"delete the
directive, add the attribute, keep the scroll option."*

Its explainer lists permanent non-goals: no typeahead, no grid in V1, no selection management, and
scrolling left to the user agent. Those are exactly what this package adds.

## Accessibility notes, honestly

- **Screen-reader browse mode is not covered by keyboard testing.** In NVDA/JAWS virtual cursor the
  arrow keys never reach this handler at all. The playground's card 13 is a walkthrough for a
  manual pass; until somebody runs it, screen-reader behaviour here is **unproven**, not passing.
- Roving tabindex needs the item to be a real focusable control or to carry an item role. This
  directive will add `tabindex` to `[role="option"]`, `[role="menuitem"]`, `[role="tab"]` and
  friends — it will never add the role itself.
- Items hidden by a stylesheet rule are not detected. Use `hidden`, `v-if` or `v-show`.

## Types

```ts
import type {
  KeyboardNavigationApi,
  KeyboardNavigationApiRef,
  KeyboardNavigationAxis,
  KeyboardNavigationBinding,
  KeyboardNavigationContainer,
  KeyboardNavigationEventDetail,
  KeyboardNavigationOptions,
  KeyboardNavigationReason,
  KeyboardNavigationRole,
  KeyboardNavigationScrollOptions,
  KeyboardNavigationState,
  KeyboardNavigationWrap,
} from '@ozjsey/v-keyboard-navigation'
```

Written in TypeScript, `strict`, no `@ts-ignore` and no casts. No `@types` package needed.

## Registering without the plugin

```ts
import { vKeyboardNavigation } from '@ozjsey/v-keyboard-navigation'
app.directive('keyboard-navigation', vKeyboardNavigation)
```

## Contributing / reading the source

`ARCHITECTURE.md` names what each module owns and the invariants the split protects. Most people
copy these files rather than installing the package, so the layout is part of the deliverable:
`scroll.ts`, `typeahead.ts` and `paging.ts` are useful on their own and import nothing from their
siblings.

```bash
npm test                 # 99 tests, jsdom + a no-DOM SSR project
npm run build            # tsup → dist/*.min.js + .d.ts
python3 -m http.server   # then open playground.html — the built bundle, from an import map alone
```

Live demos: the cross-package playground's `v-keyboard-navigation` tab (13 cards, including the
scrolling-listbox card that shows the wedge and a screen-reader walkthrough).

## License

MIT © Ozgur Seyidoglu
