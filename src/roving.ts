/**
 * The roving-tabindex invariant, and the only place focus moves.
 *
 * **The group never has more than one tab stop, and never zero while it has
 * anything focusable left.** That is the whole job. A group that reaches zero
 * tabbable elements has vanished from the keyboard, and nothing on screen says
 * so — no error, no warning, the Tab key simply skips the widget. It happens
 * the moment a `v-for` re-renders, an item is disabled, or an async list
 * arrives, which is why the invariant is maintained by a MutationObserver
 * rather than by the directive's `updated` hook: Vue's hook does not fire when
 * the DOM is changed by something else, and by then the group is already
 * broken.
 *
 * Precisely, over the elements this group manages — `items` plus `skipped`
 * (see `items.ts`):
 *
 *   - one arrow stop carries `tabindex="0"`, every other managed element `-1`;
 *   - with no arrow stops left but something skipped still focusable, the
 *     first skipped element carries the `0`, so an all-disabled group is still
 *     reachable by Tab rather than silently gone;
 *   - with nothing managed at all, the state attribute says `empty`, which is
 *     the only signal a developer gets.
 *
 * Elements the group does **not** manage — `focusgroup="none"`, a text field,
 * anything owned by a nested group — keep whatever `tabindex` the author gave
 * them, deliberately, and are outside the count.
 *
 * Every `tabindex` write in this package happens in `applyTabbable` /
 * `releaseDeparted` / `restoreTabIndex` in this file, and every focus move
 * happens in `activate` — where the `preventScroll` / `scrollIntoView` order
 * that `scroll.ts` documents is enforced.
 */
import { noteKey } from './hover'
import { collectItems, initialIndex } from './items'
import { resolve } from './resolve'
import { scrollItemIntoView } from './scroll'
import {
  ITEM_ATTR,
  reflectItems,
  removeAttr,
  setHostState,
  writeAttr,
  type Group,
} from './state'
import type { KeyboardNavigationEventDetail, KeyboardNavigationReason } from './types'

/**
 * Attributes that can add or remove an item, or change what the arrows mean.
 *
 * `tabindex` is deliberately absent: this module writes it, and observing
 * one's own writes is how an observer loop starts. `checked` was here too and
 * was dead weight — a click and a `v-model` both change the IDL property, not
 * the content attribute, so no record was ever produced; `initialIndex` reads
 * `:checked` live instead, at the moment it is asked. `style` has to stay,
 * because it is what `v-show` writes, which is why nothing in this package
 * writes an item's `style` any more (see `scroll.ts`).
 */
const OBSERVED_ATTRIBUTES = [
  'disabled',
  'aria-disabled',
  'hidden',
  'aria-hidden',
  'inert',
  'focusgroup',
  'style',
  'role',
  'aria-orientation',
  'aria-selected',
  'aria-checked',
  'aria-current',
]

let idCounter = 0

export function observe(group: Group): void {
  const observer = new MutationObserver(() => sync(group))
  observer.observe(group.host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: OBSERVED_ATTRIBUTES,
  })
  group.observer = observer
}

/**
 * Re-collect the items and re-establish the invariant. Cheap enough to run on
 * every mutation: one `querySelectorAll` plus guarded attribute writes, which
 * produce no mutation records when nothing changed.
 */
export function sync(group: Group): void {
  const { host } = group
  group.opts = resolve(host, group.raw)

  if (!group.opts.enabled) {
    release(group)
    return
  }

  const previous = group.items[group.activeIndex] ?? null
  // One task's worth of memory: if focus was lost to nowhere and the very
  // next DOM change takes that item out of the group, the two events are the
  // same event.
  const stranded = group.strandedItem
  clearStranded(group)
  const { items, skipped } = collectItems(host, group.opts.itemSelector, group.opts.skipDisabled)
  releaseDeparted(group, items, skipped)
  group.items = items
  group.skipped = skipped

  if (items.length === 0) {
    // Nothing to arrow to — but something skipped may still be focusable, and
    // `applyTabbable` is what keeps the group's one tab stop on it.
    applyTabbable(group, -1)
    setHostState(host, 'empty')
    publish(group)
    group.observer?.takeRecords()
    return
  }

  let index: number
  let lostActiveItem = false
  if (previous) {
    const found = items.indexOf(previous)
    if (found === -1) {
      // The tabbable item was removed. Hold the position rather than the
      // identity — deleting row 4 should leave you on the new row 4.
      index = Math.min(Math.max(group.activeIndex, 0), items.length - 1)
      lostActiveItem = true
    } else {
      index = found
    }
  } else {
    index = initialIndex(items)
  }

  applyTabbable(group, index)
  setHostState(host, group.hasFocus ? 'active' : 'idle')
  publish(group)

  // The item that had the focus left the group — removed, disabled, hidden —
  // so the browser has dropped focus onto <body> and the keyboard user is
  // stranded outside the widget. Put them back where they were.
  //
  // `hasFocus` alone is not enough: Chrome fires `focusout` as part of the
  // removal, so by now it is already false. `strandedItem` is that same
  // event seen from the other side, and it survives exactly one task.
  const hadFocus = group.hasFocus || stranded === previous
  if (lostActiveItem && hadFocus && !host.contains(document.activeElement)) {
    activate(group, index, 'sync')
  }

  // Discard the records our own guarded writes may have produced, so the next
  // observer callback is about somebody else's change.
  group.observer?.takeRecords()
}

/** Forget a pending stranding, timer included. */
export function clearStranded(group: Group): void {
  if (group.strandedTimer !== undefined) clearTimeout(group.strandedTimer)
  group.strandedTimer = undefined
  group.strandedItem = null
}

/** Move focus to `index`. The only focus move in the package. */
export function activate(group: Group, index: number, reason: KeyboardNavigationReason): void {
  const item = group.items[index]
  if (!item) return

  const previousIndex = group.activeIndex
  const previousItem = group.items[previousIndex] ?? null

  applyTabbable(group, index)
  publish(group)

  if (reason === 'hover') {
    // **A hover never moves focus *into* the group.** In roving-tabindex mode
    // "active" is focus, so following the cursor unconditionally would blur
    // whatever the user is actually using — the filter input above the list
    // being the case that matters. Focus follows the cursor only when the
    // keyboard is already standing on one of these items, which is the one
    // case where there is nothing to steal and where leaving it behind would
    // instead paint two highlights: a focus ring on the item the arrows left
    // and the active marker on the item the mouse found.
    //
    // `preventScroll` unconditionally, and no scroll of our own below: the
    // hovered item is under the cursor, so it is on screen by definition, and
    // scrolling would move the list out from under the mouse — which fires
    // another hover, which scrolls again.
    if (focusIsOnAnItem(group)) item.focus({ preventScroll: true })
  } else if (group.opts.activedescendant) {
    // The host has to hold the focus, because `aria-activedescendant` only
    // speaks to a screen reader from the element that has it. A click lands
    // on the option itself, one level in, and pulling focus back up to the
    // host is what makes that click mean anything at all.
    //
    // Focus that is **outside the group** is the exception: a combobox's text
    // input, the button that opened this menu. That is where the user
    // actually is, and taking it from them is precisely what this mode exists
    // to avoid — so the active item moves and the focus does not. Focus that
    // is nowhere (`<body>`, or nothing at all, which is what the browser
    // leaves behind when the focused item is removed) is claimed, because
    // that is the focus rescue in `sync`.
    if (!focusIsOutsideTheGroup(group)) {
      if (document.activeElement !== group.host) group.host.focus({ preventScroll: true })
    }
  } else {
    // `preventScroll` is mandatory *when we are the ones scrolling*: without
    // it the UA centres the item first and the `nearest` scroll below becomes
    // a silent no-op. With `scroll: false` the consumer asked for the user
    // agent's own focus scroll, and suppressing it as well would leave a
    // scrolling list that never scrolls — an option that silently breaks the
    // widget.
    item.focus({ preventScroll: group.opts.scroll !== null })
  }
  if (reason !== 'hover') {
    scrollItemIntoView(group.host, item, group.opts.scroll)
    // Whatever moved the active item, it was not the cursor — and it has very
    // likely just scrolled the list under a hand that is not moving. Shut the
    // cursor's window, exactly as a key on the host does: this is the path
    // that catches `api.next()`, which is how a combobox drives its list.
    noteKey(group.pointer, performance.now())
  }

  if (item !== previousItem) emit(group, { item, index, previousItem, previousIndex, reason })
}

/**
 * Is the keyboard standing on one of this group's items right now?
 *
 * Identity, deliberately, and **not** `contains` the way `adopt` asks the
 * question. `adopt` is told where focus already went and has to name the row
 * it landed in; this is asking permission to *take* focus, and the two are not
 * the same question. A row can hold a text field, a `focusgroup="none"`
 * button, anything the three piles in `items.ts` say is not an arrow stop —
 * and every one of those is something the user is using. `contains` would call
 * that "the keyboard is on an item" and blur it on the next mouse move, which
 * is the failure this whole rule exists to prevent, one level further in.
 */
function focusIsOnAnItem(group: Group): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && group.items.includes(active)
}

/**
 * Is focus on a real element that this group's host does not contain?
 *
 * `<body>` is not it: that is the browser's word for "focus is nowhere",
 * which is exactly the state the focus rescue exists to repair.
 */
function focusIsOutsideTheGroup(group: Group): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (active === document.body) return false
  return !group.host.contains(active)
}

/**
 * The cursor moved onto something inside the group. `directive.ts` has already
 * decided the **cursor** moved rather than the document under it — that is
 * `hover.ts`, and it is the whole difficulty of this feature.
 *
 * A target that is not an item is a no-op, which is what keeps the arrows and
 * the mouse looking at the same list: the gaps between items, a skipped
 * `aria-disabled` row, an element a nested group owns.
 */
export function hover(group: Group, target: HTMLElement): void {
  const index = indexOfItem(group, target)
  if (index === -1 || index === group.activeIndex) return
  activate(group, index, 'hover')
}

/** Where a move of `delta` lands, wrapping or clamping. */
export function indexAfter(group: Group, delta: number, wrap: boolean): number {
  const length = group.items.length
  if (length === 0) return -1
  const target = group.activeIndex + delta
  if (target >= 0 && target < length) return target
  if (!wrap) return target < 0 ? 0 : length - 1
  return ((target % length) + length) % length
}

/**
 * Adopt an item the user reached by pointer or by Tab, without re-focusing it
 * — the browser already did that part.
 *
 * `target` may be something *inside* an item: a row can hold a button, and
 * focusing that button still means "the user is on this row". Without the
 * containment check the tab stop would stay elsewhere and the next arrow key
 * would throw focus out of the row the user is standing in.
 */
export function adopt(group: Group, target: HTMLElement, reason: KeyboardNavigationReason): void {
  const index = indexOfItem(group, target)
  if (index === -1 || index === group.activeIndex) return
  const item = group.items[index]
  if (!item) return
  const previousItem = group.items[group.activeIndex] ?? null
  const previousIndex = group.activeIndex
  applyTabbable(group, index)
  publish(group)
  emit(group, { item, index, previousItem, previousIndex, reason })
}

/** Which item an event landed in — the item itself, or the item holding it. */
function indexOfItem(group: Group, target: HTMLElement): number {
  const direct = group.items.indexOf(target)
  if (direct !== -1) return direct
  return group.items.findIndex((candidate) => candidate.contains(target))
}

/** Give the DOM back: original tabindex, no generated ids, no item hooks. */
export function release(group: Group): void {
  for (const item of [...group.items, ...group.skipped]) {
    restoreTabIndex(group, item)
    removeAttr(item, ITEM_ATTR)
  }
  for (const item of group.generatedIds) removeAttr(item, 'id')
  group.generatedIds.clear()
  removeAttr(group.host, 'aria-activedescendant')
  if (group.hostTabIndexAdded) {
    removeAttr(group.host, 'tabindex')
    group.hostTabIndexAdded = false
  }
  group.items = []
  group.skipped = []
  group.activeIndex = -1
  setHostState(group.host, 'disabled')
  publish(group)
  group.observer?.takeRecords()
}

/**
 * Hand back every element that just left the managed set — it became disabled,
 * hidden, opted out, or fell outside the selector while still in the document.
 *
 * Without this the departing element keeps whatever `tabindex` it was last
 * given. When that was the `0`, the group ends up with **two** tab stops, one
 * of them on a control the user was told is unavailable. Same class of bug as
 * zero tabbable items, and just as invisible.
 */
function releaseDeparted(group: Group, next: HTMLElement[], nextSkipped: HTMLElement[]): void {
  if (group.items.length === 0 && group.skipped.length === 0) return
  const kept = new Set([...next, ...nextSkipped])
  for (const item of [...group.items, ...group.skipped]) {
    if (kept.has(item)) continue
    restoreTabIndex(group, item)
    removeAttr(item, ITEM_ATTR)
  }
}

/**
 * The single writer of `tabindex`, of the item hook, and of activedescendant.
 *
 * `index` is `-1` when there is nothing to arrow to; the skipped loop below is
 * then what keeps the group on the keyboard.
 */
function applyTabbable(group: Group, index: number): void {
  const { host, items, skipped, opts } = group
  group.activeIndex = items.length === 0 ? -1 : index

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    rememberTabIndex(group, item)
    writeAttr(item, 'tabindex', !opts.activedescendant && i === index ? '0' : '-1')
  }

  // A skipped element must never be a second tab stop — that is the whole
  // reason the group holds it at `-1` instead of walking away. The exception
  // is a group with nothing else left: dropping the last tab stop would take
  // the widget off the keyboard entirely, which is the failure this file
  // exists to prevent, so the first one keeps it.
  const holdsTheStop = items.length === 0 && !opts.activedescendant
  for (let i = 0; i < skipped.length; i++) {
    const item = skipped[i]
    if (!item) continue
    rememberTabIndex(group, item)
    writeAttr(item, 'tabindex', holdsTheStop && i === 0 ? '0' : '-1')
  }

  reflectItems(items, index, skipped)

  const active = items[index]
  if (opts.activedescendant && active) {
    if (!host.hasAttribute('tabindex')) {
      writeAttr(host, 'tabindex', '0')
      group.hostTabIndexAdded = true
    }
    writeAttr(host, 'aria-activedescendant', ensureId(group, active))
  } else {
    removeAttr(host, 'aria-activedescendant')
    if (!opts.activedescendant && group.hostTabIndexAdded) {
      removeAttr(host, 'tabindex')
      group.hostTabIndexAdded = false
    }
  }
}

function rememberTabIndex(group: Group, item: HTMLElement): void {
  if (group.originalTabIndex.has(item)) return
  group.originalTabIndex.set(item, item.getAttribute('tabindex'))
}

function restoreTabIndex(group: Group, item: HTMLElement): void {
  const original = group.originalTabIndex.get(item)
  if (original === undefined) return
  if (original === null) removeAttr(item, 'tabindex')
  else writeAttr(item, 'tabindex', original)
  group.originalTabIndex.delete(item)
}

function ensureId(group: Group, item: HTMLElement): string {
  if (item.id) return item.id
  const id = `keyboard-navigation-item-${++idCounter}`
  writeAttr(item, 'id', id)
  group.generatedIds.add(item)
  return id
}

/** Both notification channels, in one place so they can never disagree. */
function emit(group: Group, detail: KeyboardNavigationEventDetail): void {
  group.opts.onNavigate?.(detail)
  group.host.dispatchEvent(
    new CustomEvent<KeyboardNavigationEventDetail>('keyboard-navigate', { detail, bubbles: true }),
  )
}

/**
 * Push the current shape into the shallow-reactive api.
 *
 * Every field is written only when it actually changed. `collectItems`
 * returns fresh arrays each sync, so an unconditional `api.items = items`
 * triggers every render that reads it — and since the directive's `updated`
 * hook syncs, that render triggers the next sync. Vue calls the result
 * "Maximum recursive updates exceeded" and the tab hangs.
 */
function publish(group: Group): void {
  const { api, items, skipped } = group
  if (differs(api.items, items)) api.items = items
  if (differs(api.skipped, skipped)) api.skipped = skipped
  api.activeIndex = group.activeIndex
  api.activeItem = items[group.activeIndex] ?? null
}

function differs(a: HTMLElement[], b: HTMLElement[]): boolean {
  return a.length !== b.length || b.some((el, i) => a[i] !== el)
}
