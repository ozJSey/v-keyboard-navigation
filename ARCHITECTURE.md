# Architecture

`vKeyboardNavigation.ts` is the build entry; it re-exports `src/index.ts`. Every module has one
purpose, and dependencies point strictly downward — no cycles.

```
vKeyboardNavigation.ts          entry — re-exports src/index
└── src/
    ├── index.ts                public surface: directive, plugin, types
    ├── directive.ts            lifecycle + the three listeners (keydown / focusin / focusout)
    ├── plugin.ts               KeyboardNavigationPlugin + DIRECTIVE_NAME
    ├── api.ts                  the shallow-reactive imperative handle given to `ref`
    ├── roving.ts               THE one-tabbable invariant, the MutationObserver, the focus move
    ├── scroll.ts               THE scroll — container resolution + `nearest` maths
    ├── resolve.ts              binding value + host attributes → ResolvedOptions
    ├── items.ts                which descendants are items, and which are skipped
    ├── keys.ts                 KeyboardEvent → intent, and the keys we must never claim
    ├── typeahead.ts            the buffer, the label, the match
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

**4. `keys.ts` is the only place that decides a keystroke is ours.** It answers `null` for
everything else, and `directive.ts` calls `preventDefault()` only after a `null` check *and* a
successful target lookup. A key this package did not act on is never claimed.

## For the copy-paste reader

Every file under `src/` plus the entry is self-contained TypeScript whose only dependency is the
`vue` peer (and only `api.ts` and `plugin.ts` import it at all). Take the folder as-is, or lift one
module: `scroll.ts`, `typeahead.ts` and `paging.ts` are useful on their own and import nothing from
their siblings.
