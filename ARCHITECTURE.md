# Architecture

`vKeyboardNavigation.ts` is the build entry; it re-exports `src/index.ts`. Every module has one
purpose, and dependencies point strictly downward — no cycles.

```
vKeyboardNavigation.ts          entry — re-exports src/index
└── src/
    ├── index.ts                public surface: directive, plugin, types
    ├── directive.ts            lifecycle + the five listeners (keydown / focusin / focusout /
    │                           pointerdown / pointermove)
    ├── plugin.ts               KeyboardNavigationPlugin + DIRECTIVE_NAME
    ├── api.ts                  the shallow-reactive imperative handle given to `ref`
    ├── roving.ts               THE one-tabbable invariant, the MutationObserver, the focus move
    ├── scroll.ts               THE scroll — container resolution + `nearest` maths
    ├── resolve.ts              binding value + host attributes → ResolvedOptions
    ├── items.ts                which descendants are items, which are skipped, which are not ours
    ├── keys.ts                 KeyboardEvent → intent, and the keys we must never claim
    ├── typeahead.ts            the buffer, the label, the match
    ├── hover.ts                THE TRAP — did the cursor move, or did the list move under it
    ├── paging.ts               how many items make one visible page
    ├── roles.ts                the `focusgroup` vocabulary and its per-role defaults
    ├── state.ts                the group record, the WeakMap, every `data-*` reflection
    └── types.ts                the public types + ResolvedOptions (imports nothing)
```

## The invariants the split protects

**1. `roving.ts` is the only writer of `tabindex`, and the only place focus moves.**

Exactly one item is tabbable at every instant. A group that reaches **zero** tabbable items has
disappeared from the keyboard and nothing on screen says so; a group that reaches **two** has
grown a second tab stop, often on a control the user was just told is disabled. Both are invisible
to the developer who ships them, and both are one `v-for` re-render away. That is why the
invariant is maintained by a `MutationObserver` rather than by the directive's `updated` hook —
Vue's hook does not fire for DOM changes Vue did not make, and by then the group is already
broken.

Everything that touches `tabindex` lives in `applyTabbable` / `releaseDeparted` / `restoreTabIndex`
inside that one file. A second writer anywhere else re-opens the bug.

**2. `scroll.ts` is the only place a scroll happens, and it always runs *after* the focus call.**

`focus({ preventScroll: true })` then `scrollIntoView({ block: 'nearest' })`. In the other order —
or without `preventScroll` — the user agent centres the item first, `nearest` then finds it
already on screen, and the whole feature is a silent no-op. That ordering is enforced in
`roving.ts:activate`, which is the only caller, and the reasoning is written at the top of
`scroll.ts` with the measured numbers.

**3. `state.ts` owns every DOM reflection**, and every write is guarded (`writeAttr` skips a write
that would not change the value). The group observes its own subtree, so an unconditional
`setAttribute` produces a mutation record even when nothing changed — which is an observer loop.
`roving.ts` writes `tabindex`, the generated `id` and `aria-activedescendant` through the same two
guarded helpers; nothing anywhere writes an item's `style`, which is why `style` can stay in the
observed set (it is what `v-show` writes).

**3b. `hover.ts` is the only place that decides a pointer event is a cursor movement.**

Arrowing through a long list scrolls it, so the item under a *stationary* cursor changes and the
browser fires a pointer event for it. Acting on that yanks the active item back to wherever the
mouse is parked, on every keystroke, and the user can never leave — the classic hover-as-input
bug, and the reason `hover` is not a ten-line option. The guards (the coordinates must have
changed; nothing for 150ms after a key this group acted on) live in one leaf module that imports
nothing, touches no DOM and holds no clock of its own, so the decision can be read and tested as
arithmetic.

**It is invisible to jsdom**, which has no layout to scroll. The proof is the browser regression on
playground card 16, which failed against a `mouseover` handler before this landed — twelve
ArrowDowns from Row 3 finishing on Row 7 — and `directive.ts` is where the two are wired together.

Hover's second rule lives in `roving.ts` instead, because it is a rule about focus: **hover never
moves DOM focus into the group.** It follows the cursor only when the keyboard is already standing
on one of the items, so hovering a list while typing in a filter field cannot blur the field. Same
file, because invariant 1 says every focus move happens in `activate`, and this is one of them.

**4. `keys.ts` is the only place that decides a keystroke is ours.** It answers `null` for
everything else, and `directive.ts` calls `preventDefault()` only after a `null` check *and* a
successful target lookup. A key this package did not act on is never claimed.

**5. `items.ts` decides membership from attributes alone, and every pile it produces stays
reachable.** Three piles, never two: *items* (arrow stops, roving `tabindex`), *skipped* (matched
and focusable but not an arrow stop — held at `-1` so it cannot become a second tab stop, unless it
is all that is left, in which case the first one holds the group's one tab stop), and *not ours*
(`focusgroup="none"`, a control that owns its own keys, anything a nested group owns — never
touched, so it keeps the author's own `tabindex` and its own place in the tab order).

Membership is never measured. A geometry test would make the keyboard change behaviour on a window
resize, so a stylesheet-driven `display: none` is deliberately invisible here — `hidden`, `v-if`
and `v-show` are the supported ways to take an item out.

The pile an element lands in has to agree with what a screen reader is told about it, because a
sighted keyboard user and a browse-mode user must not be navigating two different lists. Skipping
is therefore restricted to states that are *announced*: `aria-disabled="true"` (announced as
disabled) and `aria-hidden="true"` (not announced at all). Silently dropping a live, announced
control from the arrows is the one thing this module must not offer — `focusgroup="none"` is the
way to say it, and it leaves the element in the tab order.

## For the copy-paste reader

Every file under `src/` plus the entry is self-contained TypeScript whose only dependency is the
`vue` peer (and only `api.ts` and `plugin.ts` import it at all). Take the folder as-is, or lift one
module: `typeahead.ts` and `hover.ts` import nothing at all, and `scroll.ts` / `paging.ts` /
`keys.ts` / `roles.ts` import **only type aliases** from `types.ts` — delete the one `import type` line, inline
the two or three shapes it names, and each file stands alone. (An earlier version of this paragraph
claimed those three imported nothing from their siblings, which was never true of `scroll.ts`: the
reader it is aimed at is exactly the one who would hit the unresolved import.)
