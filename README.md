# @ozjsey/v-keyboard-navigation

See in action: [npm portfolio playground](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation).

**Or put your hands on the keyboard** — every card below is live and editable in the browser:
[a bare toolbar](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/toolbar) ·
[tabs](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/tablist) ·
[menu](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/menu) ·
[the scroll wedge](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/listbox-scroll) ·
[hover as an input](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/hover) ·
[the imperative api](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/api)

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
step at a time. No wrapper components, no options, no composable. Add `hover: true` and the mouse
becomes an input too — arrow to item 3, hover item 7, press ArrowDown, land on item 8.

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
  `preventDefault()` on a key it did not act on. Those controls are also kept out of the item set
  entirely: an arrow key can move *onto* a text field but never off it, so an input that took the
  roving `0` was a keyboard dead end. It keeps its own place in the tab order instead.
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
| Combobox | ⚠️ the listbox half only — `activedescendant` + `hover` keep focus in your input while the arrows move the list, but you forward ↑ ↓ Enter yourself and you place `aria-activedescendant` on the input yourself. See "Hover as an input" and the limitations below. |
| Feed | ❌ not implemented |
| Carousel | ❌ not implemented |

Menu **activation** (Enter/Space opening a submenu, Escape closing it) is the application's:
this package moves focus and stays out of the way of both keys.

## Options

Every option exists to opt *out* of a default, or to describe something the DOM cannot tell us.

```vue
<ul v-keyboard-navigation="options">…</ul>
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `enabled` | `boolean` | `true` | `false` restores every `tabindex` and stops handling keys. State becomes `disabled`. |
| `role` | `'toolbar' \| 'tablist' \| 'menu' \| 'menubar' \| 'listbox' \| 'radiogroup'` | read from `role` | Names the pattern when the host has no `role` attribute. Never written to the DOM. |
| `orientation` | `'inline' \| 'block' \| 'both'` (`'horizontal'` / `'vertical'` accepted) | per role, else `both` | Which arrows move focus. Also read from `aria-orientation`. |
| `wrap` | `boolean \| 'wrap' \| 'nowrap'` | per role | Whether the last item steps to the first. |
| `skipDisabled` | `boolean` | per role | Whether the arrows step over `aria-disabled="true"` items. `false` for `menu` / `menubar`, `true` everywhere else. |
| `items` | `string` | every focusable descendant *except* controls that own their own keys | CSS selector for the items, scoped to the host. A text input, a `select` and a contenteditable are never arrow stops whatever the selector says — see "Skipping". |
| `memory` | `boolean` | `true` | Remember the last focused item across Tab out/in. `false` is `focusgroup`'s `nomemory`. |
| `typeahead` | `boolean` | `true` | Jump by typing a label. |
| `typeaheadTimeout` | `number` | `500` | Milliseconds before the buffer resets. |
| `homeEnd` | `boolean` | `true` | `Home` / `End` jump to the ends. |
| `page` | `boolean \| number` | `true` | `PageUp`/`PageDown` by a real visible page; a number fixes the step; `false` leaves the keys to the browser. |
| `hover` | `boolean` | `false` | Let the cursor moving onto an item make it the active one, so the arrows continue from the mouse. See "Hover as an input". |
| `activedescendant` | `boolean` | `false` | Keep focus on the host and track the item with `aria-activedescendant`. Focus outside the group is never taken. |
| `scroll` | `boolean \| KeyboardNavigationScrollOptions` | on | Controlled scroll. `false` hands scrolling back to the browser. |
| `ref` | `{ value: KeyboardNavigationApi \| undefined }` | — | Receives the imperative api. |
| `onNavigate` | `(detail) => void` | — | Called after every move. |

The binding also accepts a bare role: `v-keyboard-navigation="'menu'"` is `{ role: 'menu' }`.

### Scroll options

> This is the differentiator, and it is the one thing you cannot judge from a table:
> [200 rows in a 200px box](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/listbox-scroll) prints the `scrollTop` trace as you hold ArrowDown,
> with a tickbox to hand the scroll back to the browser and feel the difference. Then
> [two instances, one selector](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/two-instances) for what a bare `container` selector does when
> the same markup appears twice on a page.

Same shape as [`v-scroll-into-view`](../v-scroll-into-view) — deliberately, so learning one teaches
the other. The code is separate: that package is declarative and edge-driven and defaults to
`smooth`; this one runs per keystroke, where `smooth` is wrong.

| Option | Type | Default | Notes |
|---|---|---|---|
| `container` | `HTMLElement \| string \| (() => HTMLElement \| null)` | — | Pin the scroller. **A selector is always resolved against this group's host, never against the document** — see below. Resolving to nothing is a silent no-op; it never falls back to native. |
| `offset` | `{ top?: number; left?: number }` | — | Gap for a sticky header. Setting it means this package owns the maths: with no `container`, the nearest scrolling ancestor is scrolled directly. Nothing is written to the item's `style`. |
| `behavior` | `ScrollBehavior` | `'instant'` | |
| `block` | `ScrollLogicalPosition` | `'nearest'` | The one-item follow. |
| `inline` | `ScrollLogicalPosition` | `'nearest'` | |

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

#### How a `container` selector is resolved

Against **this group**, never against the page. A component rendered twice must scroll its own
pane, and until 0.2.0 it did not: a bare selector went through `document.querySelector`, so every
instance resolved to instance one's box and arrowing in the second list scrolled the first.

| Form | Resolves to |
|---|---|
| `'.pane'` | the host itself if it matches, else the nearest matching **ancestor**, else a matching **descendant** |
| `':scope .pane'` | a matching **descendant** of the host, exactly as `:scope` means in CSS |
| `() => el` | whatever you return — the way to name an element outside the group, out loud |
| `el` | that element |

Nothing in the string forms can leave the group. (`:scope <sel>` used to be `el.closest()`, i.e.
an **ancestor**, out through the host as well — the opposite of what the syntax says.)

## Defaults per role

| `role` | Arrows | Ends | `aria-disabled` items |
|---|---|---|---|
| `toolbar` | horizontal | clamp | skipped |
| `tablist` | horizontal | wrap | skipped |
| `menubar` | horizontal | wrap | **kept** |
| `menu` | vertical | wrap | **kept** |
| `listbox` | vertical | clamp | skipped |
| `radiogroup` | both | wrap | skipped |
| *(no role)* | both | clamp | skipped |

`ROLE_DEFAULTS` and `NO_ROLE_DEFAULTS` are exported, so this table is checkable rather than
copied: `import { ROLE_DEFAULTS } from '@ozjsey/v-keyboard-navigation'`.

The first tab stop is the item carrying `aria-selected="true"`, `aria-checked="true"`,
`aria-current` (anything but `"false"`), or `:checked` — else the first item. After that it is
wherever the user last was.

## Skipping: what the arrows step over, and why it is three piles not two

> [Three piles, and the group that skips everything](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/skipping) — including the case at the end
> of this section, where every row is skipped and the group must keep its tab stop anyway.

Every descendant that matches the item selector lands in exactly one of three piles.

| Pile | What lands there | What the directive does to it |
|---|---|---|
| **items** | everything else | roving `tabindex`: exactly one `0`, the rest `-1` |
| **skipped** | `aria-disabled="true"` under a role that skips it, and anything under `aria-hidden="true"` | held at `tabindex="-1"` — *unless* it is all that is left, in which case the first one keeps the group's one tab stop |
| **not ours** | `focusgroup="none"`, controls that own their own keys, anything a nested group owns | **never touched** — it keeps whatever `tabindex` you gave it, and its own place in the tab order |

### `focusgroup="none"` — "live, just not an arrow stop"

```vue
<ul v-keyboard-navigation role="listbox">
  <li role="option">Ada</li>
  <li role="option">Grace</li>
  <li><button focusgroup="none" @click="loadMore">Load more…</button></li>
</ul>
```

A group label, a separator, a loading placeholder, a "load more" row: perfectly live controls that
the arrows should not stop on. `focusgroup="none"` is the platform's own spelling for an opted-out
descendant — the same attribute this package borrows its role vocabulary from — so the migration
path stays *"delete the directive, add the attribute"*, and the markup does not change. It is inert
in a browser that has already shipped `focusgroup`, because the host here does not carry the
attribute that would activate it.

The element stays in the **tab order**. That is the whole difference between "not an arrow stop"
and "unreachable", and it is deliberate: an element the arrows skip and Tab cannot reach is a
control nobody can operate.

### `aria-disabled` is a *policy*, and the default is per role

The APG does not have one answer, so neither does this. Where the set of options is itself
information — a **menu**, a **menubar** — a user who never lands on "Paste" never learns that
pasting exists here at all, so disabled items stay reachable. A two-hundred-option **listbox**, a
**tablist** whose disabled tab has no panel, a **toolbar** of icon buttons: stopping on a control
that does nothing is friction with no payoff, so they are skipped. `skipDisabled` overrides the
default in either direction.

A natively **`disabled`** control is never an arrow stop whatever `skipDisabled` says: the platform
will not focus it and no library can offer otherwise. That is exactly why the APG suggests
`aria-disabled` when you want an unavailable control to stay discoverable.

### The asymmetry you must not inherit

**A skipped item is invisible to the arrows and still in the accessibility tree.** A screen-reader
user browsing by role reaches it; a sighted keyboard user cannot. Two people, two different lists.

This package keeps the two lists honest by only ever skipping states that are *announced*:

- `aria-disabled="true"` is announced as disabled — the arrows skip it, and the user is told why.
- `aria-hidden="true"` is not announced at all — the arrows skip it, and it is not in either list.
- `disabled` / `hidden` / `inert` / inline `display:none` are not in the tree and cannot be focused
  by anything — the same list both ways.
- `focusgroup="none"` and a text field stay in the **tab** order — reachable both ways, the arrows
  simply do not stop there.

So do not reach for `focusgroup="none"` to hide a control you have not otherwise explained. If the
row is unavailable, say `aria-disabled="true"` and let the role default decide; if it is a label or
a separator, give it the role that says so. **Browse mode is the one thing no automated check here
can confirm** — the playground's card 13 is the manual walkthrough, and until somebody runs it this
paragraph is reasoning, not evidence.

### When every item is skipped

A group that reaches zero tabbable elements has left the keyboard, and nothing on screen says so.
So an all-`aria-disabled` group keeps its one tab stop: the first skipped element carries the `0`,
the host reports `data-keyboard-navigation-state="empty"`, and no key is claimed because there is
nowhere to go. The moment one item becomes available the tab stop moves to it.

(Two exceptions, both correct: if every item is `focusgroup="none"` the group manages nothing at
all, so the elements keep exactly the tabbability you wrote. If every item is natively `disabled`,
nothing is focusable by anything, and the state attribute is the only signal there is.)

## Hover as an input

> [Hover as an input — and the scroll trap](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/hover) is the card for the paragraph below: do
> exactly what it says, then park the cursor and hold ArrowDown to check rule 3.

Every serious menu and combobox does this: arrow to item 3, move the mouse over item 7, press
ArrowDown — you land on item 8, not item 4. It is **off by default**, because silently moving the
active item is right for a menu and wrong for a toolbar.

```vue
<script setup lang="ts">
const options = { role: 'menu', hover: true } as const
</script>

<template>
  <ul v-keyboard-navigation="options" role="menu">…</ul>
</template>
```

Moves arrive as `reason: 'hover'` on `onNavigate` and on the `keyboard-navigate` event, and the
hovered item gets `data-keyboard-navigation-item="active"` like any other — one highlight, one
hook, whichever input moved it.

Three rules make it safe. Each one is a bug in some shipping menu library.

### 1. It never moves focus *into* the group

In roving-tabindex mode "active" **is** focus, so a naive implementation blurs whatever the user is
actually using the moment the mouse crosses the list. The rule here:

> **Hover takes the DOM focus with it only when the keyboard is already standing on one of the
> group's items.** Otherwise it moves the active marker — the roving `tabindex`,
> `data-keyboard-navigation-item`, `aria-activedescendant` — and leaves the focus alone.

So hovering a list while you type in a filter field above it moves the highlight and not the
caret, and a Tab out of that field lands on the row the mouse found. Hovering a menu you are
already arrowing through moves focus with the highlight, because there is nothing to steal and
because leaving it behind would paint two highlights: a focus ring where the keyboard was and an
active marker where the mouse is.

"Standing on an item" means the focused element **is** one of the arrow stops, not merely that it
sits inside one. A row can hold a text field, or a `focusgroup="none"` button — those are things
the user is using, one level further in, and hover does not take focus from them either.

### 2. It never scrolls

The hovered item is under the cursor, so it is on screen by definition. Scrolling would drag the
list out from under the mouse, which puts a different item under the cursor, which fires another
hover. `scroll` still applies to every other kind of move.

### 3. It reacts to the cursor moving, not to the document moving

**This is the part that makes hover-as-input hard, and it is why `src/hover.ts` exists.**

Arrowing through a long list scrolls it. The cursor has not moved, but the document underneath it
has, so a different row is now under the mouse — and the browser fires `mouseover` for it, plus (in
Chromium) a compatibility `mousemove` at the *same coordinates*. A handler written against
`mouseover` therefore yanks the active item back to wherever the mouse is parked, on **every**
keystroke: the user presses ArrowDown and the highlight jumps somewhere else entirely, forever.

Two guards:

- **The coordinates must actually have changed.** A cursor that has not moved reports the
  `clientX`/`clientY` it already had, whatever is under it now. This is the load-bearing one.
- **Nothing for 150ms after a key this group acted on.** A scroll can settle a frame later and a
  resting hand jitters by a pixel, which is a real coordinate change. Key repeat arrives every
  ~30ms, so the window stays shut for as long as an arrow is held.

The first cursor sample a group ever sees is recorded as a baseline and not acted on: a mouse
already parked over the list when the page loads has no previous position to differ from, and the
first event it produces may well be the scroll-driven one.

Both guards are invisible to jsdom, which has no layout to scroll. The evidence is playground
**card 16**, whose browser regression drives real `Input.dispatchMouseEvent` and
`Input.dispatchKeyEvent` — with a `mouseover` handler in place of this one, twelve ArrowDowns from
Row 3 finish on **Row 7** with five spurious hover moves. With the guards: Row 15, one hover.

### Touch

Only `pointerType: 'touch'` is rejected, and it is rejected by name — an absent or unknown
`pointerType` is read as a mouse, so a consumer's own jsdom test dispatching
`new MouseEvent('pointermove', …)` still drives the feature. A tap therefore cannot activate a
neighbour, and a touch position is not even recorded as the cursor's.

### Leaving the group

The active item **stays where the mouse left it**. That is what a menu does; reverting to the last
keyboard position would make the mouse a mode rather than an input.

### Combobox: the case the focus rule exists for

> [Combobox — hover that never blurs the input](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/combobox). Type, arrow, hover a row, and watch
> the caret stay in the field.

Focus in a text input, arrows moving a listbox below it, the mouse taking over a row, and the
caret never leaving the field.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { KeyboardNavigationApi } from '@ozjsey/v-keyboard-navigation'

const nav = ref<KeyboardNavigationApi>()
const pointer = ref('')
// `activedescendant`, because in roving mode "active" *is* focus and there is
// no way to point at a row without leaving the field.
const options = { activedescendant: true, hover: true, ref: nav }

function onMove(event: CustomEvent) {
  // The directive writes `aria-activedescendant` on its host. A combobox needs
  // it on the element that holds focus — see the limitation below.
  pointer.value = (event.target as HTMLElement).getAttribute('aria-activedescendant') ?? ''
}
</script>

<template>
  <input role="combobox" aria-controls="cities" :aria-activedescendant="pointer"
    @keydown.down.prevent="nav?.next()" @keydown.up.prevent="nav?.previous()" />
  <ul id="cities" role="listbox" v-keyboard-navigation="options" @keyboard-navigate="onMove">…</ul>
</template>
```

The input is **outside** the host and drives the group through the imperative api, because
`keys.ts` refuses to claim any key pressed inside a text field and will not bend: a field the
arrows can enter but never leave is a keyboard trap. A combobox is the one pattern where ↑ ↓
genuinely belong to the list rather than to the input, and forwarding three keys is the honest way
to say so.

`activedescendant` mode now leaves that focus alone. It claims focus for the host from *inside* the
group (a click lands on the option itself, where the pointer says nothing to a screen reader) or
from nowhere at all (`<body>`, which is what the browser leaves behind when the focused item is
removed — the focus rescue). Focus on an element outside the group is where the user actually is,
and separating the two is what the mode is for. **This changed in 0.3.0**: before it, an
`api.focus(i)` in activedescendant mode pulled focus onto the host from wherever it was.

**Known limitation.** `aria-activedescendant` is written on the **host**, and a combobox needs it
on the input that holds the focus. Mirror it yourself, as above; naming a different element to
carry the pointer is not an option this package offers yet.

## CSS hooks

| Attribute | Where | Values |
|---|---|---|
| `data-keyboard-navigation-state` | host | `idle` · `active` (focus is inside) · `empty` (**no focusable items — the group has left the keyboard**) · `disabled` |
| `data-keyboard-navigation-item` | every managed element | `active` on the one tabbable item, `inactive` on the other arrow stops, `skipped` on the ones the arrows step over |
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
  reason: 'key' | 'typeahead' | 'pointer' | 'hover' | 'focus' | 'api' | 'sync'
}
```

`pointer` means a pointer really was involved — a `pointerdown` inside the item immediately
preceded the focus. Focus arriving any other way (keyboard Tab, a programmatic `el.focus()`, a
restore) is `focus`. Before 0.2.0 every one of those was reported as `pointer`, so
`if (reason === 'pointer') track('click')` logged a click for every Tab into the widget.

`hover` is the cursor passing over an item under `hover: true`, and it is deliberately not
`pointer`: a press is something the user committed to, a hover is a row the mouse crossed on its
way somewhere else. A consumer that opens a preview pane on `pointer` must not open one for every
row between here and there.

```vue
<ul v-keyboard-navigation @keyboard-navigate="onMove">…</ul>
```

## The imperative api

> [The imperative api](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/api) — every method below driven from buttons outside the group.

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

> [The one-tabbable invariant under mutation](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/dynamic-list) counts the tab stops for you while
> you add rows, remove the focused one, reverse the list, disable everything and empty it.

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
  arrow keys never reach this handler at all. [The screen-reader walkthrough](https://ozjsey.github.io/npm-portfolio-playground/#v-keyboard-navigation/screen-reader) is
  a script for a manual pass; until somebody runs it, screen-reader behaviour here is **unproven**,
  not passing.
- Roving tabindex needs the item to be a real focusable control or to carry an item role. This
  directive will add `tabindex` to `[role="option"]`, `[role="menuitem"]`, `[role="tab"]` and
  friends — it will never add the role itself.
- Items hidden by a stylesheet rule are not detected. Use `hidden`, `v-if` or `v-show`.
- **A skipped item is still in the accessibility tree.** See "Skipping" above: the arrows and a
  browse-mode cursor must not end up with two different lists, which is why only announced states
  are skippable and why `focusgroup="none"` leaves the element in the tab order.
- Two skip rules are inherited from an ancestor rather than read off the element: `aria-hidden="true"`
  anywhere up to the host, and `fieldset[disabled]` (which the browser itself applies downward). A
  group wrapped in a decorative `aria-hidden` container therefore reports `empty` — that is the
  alarm working, not a bug.
- **`hover` is meaningless to a screen-reader user, so the keyboard path has to stay complete on
  its own.** It is an *additional* input, never the only way to reach an item: everything hover can
  activate, the arrows already reach, and hover deliberately does nothing for an item the arrows
  skip so the two lists cannot disagree. It writes no ARIA of its own beyond moving the
  `aria-activedescendant` the keyboard would have moved anyway.

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
`typeahead.ts` and `hover.ts` import nothing at all, and `scroll.ts`, `paging.ts`, `keys.ts` and
`roles.ts` import only type aliases from `types.ts` — delete the one `import type` line, inline the
shapes it names, and each file stands alone.

```bash
npm test                 # 200 tests, jsdom + a no-DOM SSR project
npm run build            # tsup → dist/*.min.js + .d.ts
python3 -m http.server   # then open playground.html — the built bundle, from an import map alone
```

Live demos: the cross-package playground's `v-keyboard-navigation` tab (17 cards, including the
scrolling-listbox card that shows the wedge, the skipping model, a two-instance regression card for
the container defect fixed in 0.2.0, the hover-as-input card that carries the scroll-trap
regression, the combobox card, and a manual screen-reader walkthrough).

## License

MIT © Ozgur Seyidoglu
