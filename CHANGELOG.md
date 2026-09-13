# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver, and the package
stays on `0.x` until it has had an independent accessibility audit — see
`tickets/_STANDARDS.md` B9.

## [0.1.0] — 2026-09-06

First cut. Nothing has been published to npm.

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
- The playground's interaction spec re-measures the first and third of those against the live card
  with `Input.dispatchKeyEvent`, so the claim is re-checked on every run rather than quoted.
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
