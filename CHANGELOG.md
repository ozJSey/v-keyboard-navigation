# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver, and the package
stays on `0.x` until it has had an independent accessibility audit — see
`tickets/_STANDARDS.md` B9.

## 0.3.1 — 2026-09-18

Documentation only; no code change. The README is cut to a landing page — problem, solution,
install, a couple of usage examples — because the playground now carries the reference: every
option driven in a real browser rather than described in a table. Claims that could not be
verified against the source were deleted rather than carried across.

## [0.3.0] — 2026-09-14

Hover becomes an input, opt-in: arrow to item 3, move the mouse over item 7, press ArrowDown, land
on item 8. Every serious menu and combobox behaves this way. Most implementations of it are also
broken in the same way, and most of this release is the part that stops that.

### Added

- **`hover: true`** — the cursor moving onto an item makes it the active one, so the arrows
  continue from where the mouse is. Off by default: silently moving the active item is right for a
  menu and wrong for a toolbar. Three rules make it safe, and each is a live bug in some shipping
  menu library:

  1. **It never moves focus *into* the group.** In roving-tabindex mode "active" *is* focus, so a
     naive implementation blurs whatever the user is actually using the moment the mouse crosses
     the list. Hover takes the DOM focus with it **only when the keyboard is already standing on
     one of the group's items** — where there is nothing to steal, and where leaving focus behind
     would paint two highlights instead of one. Otherwise it moves the marker (`tabindex`,
     `data-keyboard-navigation-item`, `aria-activedescendant`) and leaves the focus alone.
     "Standing on an item" is identity, not containment: a row can hold a text field or a
     `focusgroup="none"` button, and those are things the user is using too.
  2. **It never scrolls.** The hovered item is under the cursor, so it is on screen by definition;
     scrolling would drag the list out from under the mouse, which puts a different item under the
     cursor, which fires another hover. `reason` is wired through to the scroll for exactly this.
  3. **It reacts to the cursor moving, not to the document moving** — see the next section.

  Moves arrive as **`reason: 'hover'`**, kept apart from `'pointer'` on purpose: a press is
  something the user committed to, a hover is a row the mouse crossed on the way somewhere else,
  and a consumer that opens a preview pane on `'pointer'` must not open one for every row in
  between. Hovering an item the arrows skip does nothing, so the two lists cannot disagree, and the
  active item **stays where the mouse left it** — what a menu does.

- **`src/hover.ts`** — a new leaf module owning one question: *did the cursor move, and may it
  speak right now?* It imports nothing, touches no DOM and holds no clock.

### Fixed

- **Arrowing through a long list moved the active item to wherever the mouse was parked.** This is
  the trap every hover-as-input implementation hits, and it is the reason this release is not a
  ten-line option. Arrowing scrolls the list, so the row under a *stationary* cursor changes, and
  the browser fires `mouseover` for it plus (in Chromium) a compatibility `mousemove` at the
  **same coordinates**. A handler written against `mouseover` therefore yanks the highlight back to
  the mouse on every keystroke and the user can never leave.

  Two guards: **the coordinates must actually have changed** (a cursor that has not moved reports
  the `clientX`/`clientY` it already had, whatever is under it now — this is the load-bearing one),
  and **nothing for 150ms after a key this group acted on** (a scroll can settle a frame later, and
  a resting hand's one-pixel jitter is a real coordinate change; key repeat arrives every ~30ms, so
  the window stays shut for as long as an arrow is held). The first cursor sample a group ever sees
  is recorded as a baseline and not acted on, because a mouse already parked over the list has no
  previous position to differ from and the first event it produces may well be the scroll-driven
  one.

  **This is invisible to jsdom and to unit tests**, which have no layout to scroll. It was
  reproduced before it was fixed, in the browser, and playground **card 16** carries the
  regression: with a `mouseover` handler, twelve ArrowDowns from Row 3 finish on **Row 7** with
  five spurious hover moves and 160px of scroll; with the guards, **Row 15**, one hover, 400px. The
  check drives real `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`, so Chrome's own
  hit-test position moves and the compat events it produces are the real ones.

- **`activedescendant` mode took the focus from wherever the user was.** `activate` called
  `host.focus()` whenever `document.activeElement !== host`, which is every case except a key
  pressed on the host itself — so `api.focus(i)` yanked the caret out of a combobox's text input,
  and out of the button that opened the menu. The whole point of the mode is that active and focus
  are separate. It now claims focus for the host only from **inside** the group (a click lands on
  the option itself, where `aria-activedescendant` on the host says nothing to a screen reader) or
  from **nowhere at all** (`<body>` — what the browser leaves behind when the focused item is
  removed, which is the focus rescue in `sync`). Focus on an element outside the group is left
  exactly where it is. Without this fix the combobox card cannot work at all: the negative-control
  run shows the hover blurring the input and the next typed letter going nowhere.

### Changed

- `KeyboardNavigationReason` gains `'hover'`. A consumer switching exhaustively over the union will
  need the new arm; the value only ever appears when `hover: true` is set.

### Docs

- README: a new **"Hover as an input"** section with the three rules, the trap and both guards, the
  touch answer, and a combobox recipe. The pattern table's Combobox row moves from ❌ to ⚠️ — the
  listbox half is reachable now, you forward ↑ ↓ Enter yourself, and **`aria-activedescendant` is
  still written on the host**, so a combobox has to mirror it onto the input. That last one is a
  named limitation, not a claim.
- ARCHITECTURE: `hover.ts` is invariant 3b, and `directive.ts` now owns five listeners.
- Playground: **card 16** (hover, and the scroll trap with its regression) and **card 17**
  (combobox — real typing, arrows moving the listbox, hover taking over, focus never leaving the
  input). Card 13's screen-reader walkthrough gains the hover line: hover is an *additional* input
  and the keyboard path stays complete on its own.

### Verified

- **200 tests** across the two vitest projects, up from 162. Thirty-eight of the new ones are the
  hover path: the focus rule in five shapes (on an item, outside the group, in a field outside a
  row, in a field *inside* a row, activedescendant), the reason on both channels, no scroll
  (including with `scroll: false`, where `preventScroll` still holds), the coordinate guard, the
  baseline sample, the post-key window after an arrow / after an `api` move / after a keystroke the
  group merely overheard in a filter field, touch, pen, skipped items, gaps, nested groups, the
  one-tabbable invariant, a disabled group keeping no cursor state at all, and a listener census
  proving `unmounted` takes back exactly the five listeners `mounted` added.
- **Mutation-tested at the new path specifically: 39 of 39 killed**, plus four equivalent mutants
  named rather than dropped. None of the previous 50 mutants could say anything about code that did
  not exist, which is the lesson of 0.1.0 restated. The first pass killed 31 of 38; five survivors
  were real test gaps (a disabled group still recording cursor state, a listener surviving unmount,
  a re-hover of the already-active item re-calling `focus()`, `preventScroll` weakened under
  `scroll: false`, and the focus rule reading containment instead of identity) and two were badly
  built mutants, rewritten rather than excused. **The containment survivor was a design bug, not
  just a test gap**: `contains` would have blurred a text field held inside a row. A later mutant
  showed the two `noteKey` call sites are not redundant — deleting the `onKeydown` one survived
  until a test covered a filter keystroke the group hears and deliberately does not act on.
- **Six browser checks, every one negative-controlled.** With `hover` forced off all four hover
  checks fail; with the coordinate guard replaced by a `mouseover` handler the trap check fails;
  with the scroll un-suppressed the no-scroll check fails; with the focus rule dropped the combobox
  check fails and shows the typed letter being lost.

### Known limitations

- **`aria-activedescendant` is written on the host.** A real ARIA 1.2 combobox needs it on the
  input that holds the focus; card 17 mirrors it in two lines. Naming a different element to carry
  the pointer is not an option this package offers yet.
- **Still not validated with a screen reader.** Hover is meaningless in browse mode, which makes
  card 13 more load-bearing rather than less: everything hover can reach, the arrows already reach.
  **UNPROVEN.**
- 2D grids, treeview, feed and carousel remain **not implemented**.
- Items hidden by a stylesheet rule are still not detected. Use `hidden`, `v-if` or `v-show`.

## [0.2.0] — 2026-09-13 · never on npm

This version was never published: the registry holds `0.1.0` (2026-09-13T12:51:57Z) and `0.3.0`
(2026-09-14T10:01:53Z) and nothing between them. The date is the date of the work, and the entry
stands because 0.3.0 inherits every change in it.

**Upgrade if you render a group more than once on a page.** `0.1.0`'s controlled scroll — the
feature the whole package is named for — could be aimed at another component's element, and there
was no way to notice from the outside.

### Fixed

- **A bare `scroll.container` selector resolved against the whole document, so the wrong box
  scrolled.** `resolveContainer` called `document.querySelector(ref)`, which returns the *first*
  match on the page, not this group's. Two instances of one component — a listbox in a repeated
  card, two panes side by side — therefore both resolved to instance one's container: arrowing in
  the second list wrote a `scrollTop` onto the first (measured: `{top:340}` landed on pane one,
  pane two never moved) and the list the user was actually in never followed its focus ring. The
  maths downstream (`relTop = itemRect.top - boxRect.top + container.scrollTop`) was relative to a
  box that did not contain the item, so the number written was arbitrary. **Every string form is
  now anchored to the host** and nothing can resolve outside the group; the getter form
  (`container: () => document.querySelector('#elsewhere')`) is how you name a stranger, out loud.
  Every test in `0.1.0` mounted exactly one host, which is why the suite could not see it —
  playground card 15 now renders two instances and ships the old behaviour beside the new one as a
  negative control.
- **`':scope <sel>'` meant the opposite of what it means in CSS.** It was `el.closest(sel)` — the
  nearest **ancestor**, walking out through the host and into the rest of the document. It is now
  `host.querySelector(':scope …')`, a **descendant**, which is what the syntax says and what the
  README's `container: ':scope .scroll-pane'` line always implied.
- **A nested group's host was dropped from its parent's item list, creating a second tab stop.**
  `el.closest(HOST_SELECTOR) !== host` answers "itself" for an element that is a host, so a
  menubar whose middle menuitem also carried the directive collected `['File', 'View']` — 'Edit'
  vanished from arrow navigation and kept its natural tabbability. The rule is now "the nearest
  host **strictly above** it" (`ownerHost`), which is the flagship one-tabbable invariant this
  package exists for, broken by the package itself.
- **`enabled: false` left the focus listeners live**, so one click inside a switched-off group set
  the state attribute to `active` and clicking away set it to `empty` — the documented alarm for
  "this widget has left the keyboard" — permanently, until the next subtree mutation. All four
  listeners now honour the flag, as `types.ts` always claimed.
- **The focus rescue fired for window blurs and Tabs into the browser chrome.** Any `focusout`
  with a null `relatedTarget` counted as "the focused element was removed", so a list that
  refreshed a moment after the user left yanked focus back out of the URL bar. It now also
  requires `document.hasFocus()` and expires at the end of the task that recorded it — a removal
  blurs and mutates in the same task; a user walking away does not.
- **`offset` woke the group's own MutationObserver twice per keystroke and left `style=""` on
  every item it touched**, unmount included. It was applied as an ephemeral inline `scroll-margin`,
  and `style` is an observed attribute, so held-arrow key repeat ran a full re-sync per frame. The
  offset is now part of this package's own scroll maths and **nothing writes an item's `style` at
  all**.
- **`PageUp` / `PageDown` were measured on the block axis whatever the group's axis was.** On a
  horizontal toolbar every item's height is the strip height, so the step collapsed to 1 —
  `PageDown` as an alias for `ArrowRight`, which is worse than the first/last mapping this key
  exists to beat. `pageStep` now takes the axis, and measures the **span the items cover** rather
  than the sum of their sizes, so gaps and separators count and an axis that carries no layout
  degrades to first/last as documented. `scrollParent` takes the axis too: a strip that scrolls
  only sideways is no longer accepted as the vertical page viewport.
- **Text inputs were default items, and `keys.ts` correctly refuses to navigate off them — an
  arrow-key dead end.** The roving `0` could land on a filter input from which no arrow and no
  `Home` could escape, and since the group is one tab stop, `Tab` left the widget entirely. Text
  inputs, `select` and contenteditable are now never arrow stops and keep their own place in the
  tab order.
- **`onFocusout` ignored the nested-group rule the other two listeners follow**, so tabbing out of
  a submenu ran the outer menubar's whole focusout path — clearing its typeahead, resetting its tab
  stop under `memory: false`, and emitting a `keyboard-navigate` the consumer never caused.
- **Every `focusin` was reported as `reason: 'pointer'`**, including keyboard `Tab` and
  programmatic `el.focus()`, so `if (reason === 'pointer') track('click')` logged a click for every
  Tab into the widget. See the new `'focus'` reason below.

### Added

- **`focusgroup="none"` on a descendant takes it out of the arrows without calling it disabled.**
  A group label, a separator, a loading placeholder, a "load more" row: live controls the arrows
  should not stop on. The spelling is the platform `focusgroup` attribute's own — the same
  vocabulary this package already borrows its roles from — so the migration path stays "delete the
  directive, add the attribute" with the markup unchanged. The element is **never touched**: it
  keeps the `tabindex` you gave it and its own place in the tab order, because something the
  arrows skip *and* Tab cannot reach is operable by nobody. Exported as `OPT_OUT_SELECTOR`.
- **`skipDisabled`, defaulting per role.** Whether the arrows step over `aria-disabled="true"` is a
  policy question with no single right answer, so it follows the pattern: `false` for `menu` and
  `menubar`, where the set of options is itself information and a user who never lands on "Paste"
  never learns pasting exists here; `true` for `toolbar`, `tablist`, `listbox`, `radiogroup` and
  for a group with no role. Before this release it was unconditional. A natively `disabled` control
  is still never an arrow stop, because the platform will not focus it under any setting.
- **A third pile, and the `skipped` half of the one-tabbable invariant.** Items are arrow stops;
  *skipped* elements matched and are focusable but held at `tabindex="-1"` so they cannot become a
  second tab stop; *not ours* is never touched. When **every** item is skipped the first skipped
  element keeps the group's one tab stop and the host reports `empty` — a group that reaches zero
  tabbable elements has left the keyboard and nothing on screen says so.
- `data-keyboard-navigation-item="skipped"`, beside `active` and `inactive`.
- `api.skipped`, so a consumer can check a group has not quietly gone unreachable.
- `reason: 'focus'` — focus that arrived by Tab, by `el.focus()` or by a restore, as distinct from
  `'pointer'`, which now means a `pointerdown` really did precede it.
- `ROLE_DEFAULTS` / `NO_ROLE_DEFAULTS` are exported as data, so the README's table and the
  playground's cards read the defaults rather than restating them.
- Playground cards 14 (the skipping model, including the group that skips every item) and 15 (two
  instances, one container selector, with the 0.1.0 behaviour as a switchable negative control).
  Card 13's manual screen-reader walkthrough gains a fourth widget and a skipped-item pass.

### Changed

- A disabled item under a skipping role is now **held at `tabindex="-1"`** rather than having its
  `tabindex` removed. Removing it was safe for a `<div role="option">` and not for a
  `<button aria-disabled="true">`, which is natively tabbable: the group grew a second tab stop on
  a control the user had just been told was unavailable.

### Verified

- 162 tests across two vitest projects (jsdom + a no-DOM node project for SSR import safety), up
  from 99. The new ones include the two-host cases the whole suite lacked — a second instance with
  the same container selector, a `:scope` descendant, a decoy that only a document-wide query
  would find — and a group where **every** item is skipped, which is the obvious way to trip the
  one-tabbable invariant.
- 26 browser checks in the playground's interaction spec, driven with real `Input.dispatchKeyEvent`
  through Chrome's own input pipeline. Two of them are card 15: the second instance scrolls its own
  pane, and — as the negative control — the document-wide getter scrolls the *first* pane while the
  list the user is in never moves.
- The spec's 15 fixed sleeps are gone. Every wait is now a polled condition on something the page
  renders, so a slow machine waits longer rather than reading the previous state and passing.
- Mutation-tested again, and the list was rebuilt rather than re-run: **50 of 50 killed**. Eight
  of the fifty aim at container resolution alone (bare selector resolved document-wide; the
  ancestor branch dropped; the descendant fallback dropped; `:scope` back to `closest`; the element
  and getter forms ignored; a detached container scrolled; the page viewport resolved from the
  document) and fourteen at the skipping rules. **None of the previous 39 touched either**, which
  is how 0.1.0 shipped the `document.querySelector` defect with a clean mutation run — a green
  mutation score only covers the decisions somebody thought to mutate. The first pass of this run
  killed 41 of 52: ten survivors were real test gaps, now closed (a bare selector resolving to a
  descendant, the element and getter container forms, a detached container, `block: 'start'` with
  an offset, the axis test in its other direction, `aria-disabled="false"`, a skipped element
  leaving the group entirely, and `focusgroup="none"` arriving from outside Vue), and two were
  equivalent mutants, named in the runner rather than quietly dropped.

### Known limitations

- **Still not validated with a screen reader.** A skipped item is invisible to the arrows and still
  in the accessibility tree, which makes browse mode more load-bearing than before, not less. The
  package only ever skips *announced* states (`aria-disabled`, `aria-hidden`) for exactly that
  reason, and `focusgroup="none"` leaves the element in the tab order — but card 13 is a manual
  walkthrough, and until somebody runs it this is reasoning rather than evidence. **UNPROVEN.**
- 2D grids, treeview, combobox, feed and carousel remain **not implemented**.
- Items hidden by a stylesheet rule are still not detected. Use `hidden`, `v-if` or `v-show`.

## [0.1.0] — 2026-09-13

First cut. *(Written before publication and left as it stood; 0.1.0 did go to npm, and the defects
0.2.0 lists above were live for anyone who installed it.)*

### Added

- `v-keyboard-navigation` directive: one tab stop for a group of controls (roving tabindex),
  arrow-key movement, `Home` / `End`, typeahead, and per-role wrap-vs-clamp defaults.
- **Controlled scroll** — `focus({ preventScroll: true })` followed by
  `scrollIntoView({ block: 'nearest' })`, in that order. Default `behavior: 'instant'`. Options
  `container` / `offset` / `behavior` / `block` / `inline`, the same shape `v-scroll-into-view`
  uses. `scroll: false` hands scrolling back to the browser.
- **PageUp / PageDown as a real visible page** — as many items as fit the scroll viewport,
  degrading to first/last where nothing scrolls. `page: <number>` fixes the step; `page: false`
  leaves the keys alone.
- `aria-activedescendant` mode (`activedescendant: true`), where the host keeps focus and the
  directive owns the scroll outright.
- The `focusgroup` vocabulary: roles `toolbar | tablist | menu | menubar | listbox | radiogroup`,
  `orientation: 'inline' | 'block' | 'both'`, `wrap: 'wrap' | 'nowrap'`, `memory: false` for
  `nomemory`. Read from `role` / `aria-orientation` when present.
- CSS hooks: `data-keyboard-navigation-state` (`idle` / `active` / `empty` / `disabled`),
  `data-keyboard-navigation-item` (`active` / `inactive`), and
  `data-keyboard-navigation-typeahead` carrying the live buffer.
- Imperative api through the `ref` option: `focus(i)`, `next()`, `previous()`, `first()`,
  `last()`, `refresh()`, plus reactive `items` / `activeIndex` / `activeItem`.
- `onNavigate` option and the bubbling `keyboard-navigate` CustomEvent, both carrying the same
  detail.
- `KeyboardNavigationPlugin` + `DIRECTIVE_NAME` for `app.use(...)`.
- A tab in the cross-package playground with 13 cards, including a manual screen-reader
  walkthrough, and a 21-check CDP interaction spec that drives real key events (`Input.dispatchKeyEvent`)
  and reads `scrollTop` back per keystroke.

### Verified

- 99 tests across two vitest projects (jsdom + a no-DOM node project for SSR import safety),
  including eleven that mutate the item list mid-flight — append, remove the focused item, reorder,
  disable, empty and refill, a DOM change Vue never made, and the browser's own
  blur-before-removal sequence.
- The scroll trace was measured in headless Chrome 152.0.7977.82, not asserted from jsdom. A 200px
  viewport with 40px rows, one ArrowDown per step:
  `focus()` alone gives `0,0,0,0,120,120,120,240,240,240,360,360`; `focus()` followed by
  `scrollIntoView({block:'nearest'})` gives **exactly the same numbers** — the no-op this package
  is built around; `focus({preventScroll:true})` followed by the same call gives
  `0,0,0,0,40,80,120,160,200,240,280,320`.
- The playground's interaction spec drives the same card with `Input.dispatchKeyEvent` and reads
  `scrollTop` back per keystroke. *(Corrected in 0.2.0: it asserts the shape of the two traces —
  a maximum step of 40 controlled, ≥100 native — not the quoted numbers themselves. The claim that
  it "re-measures" them was wrong.)*
- The unit suite was mutation-tested: 37 targeted mutations of the source (drop `preventScroll`,
  swap the focus/scroll order, make every item tabbable, stop observing childList, intercept keys
  in text fields, remove the wrap clamp, …). The first pass caught 29 of 33; each of the four
  survivors was a real gap in a test rather than an equivalent mutant, and with those closed —
  plus four more mutants covering the focus rescue — the suite kills 37 of 37.

### Known limitations

- **Not validated with a screen reader.** In NVDA/JAWS browse mode the arrow keys never reach the
  handler, so keyboard testing cannot speak for this package. Card 13 in the playground is the
  walkthrough for a manual pass; until somebody runs it, screen-reader behaviour is **UNPROVEN**.
- 2D grids (`FocusgroupV2`), treeview, combobox, feed and carousel are **not implemented** — see
  the README's pattern table.
- Items hidden by a stylesheet rule (rather than by `hidden`, `v-if` or `v-show`'s inline style)
  are not detected as hidden. Measuring layout instead would make the group's behaviour change on
  a window resize.
