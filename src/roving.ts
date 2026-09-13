/**
 * The roving-tabindex invariant, and the only place focus moves.
 *
 * **Exactly one item is tabbable, always.** That is the whole job. A group
 * that reaches zero tabbable items has vanished from the keyboard, and
 * nothing on screen says so — no error, no warning, the Tab key simply skips
 * the widget. It happens the moment a `v-for` re-renders, an item is
 * disabled, or an async list arrives, which is why the invariant is
 * maintained by a MutationObserver rather than by the directive's `updated`
 * hook: Vue's hook does not fire when the DOM is changed by something else,
 * and by then the group is already broken.
 *
 * Every `tabindex` write in this package happens in `applyTabbable`, and
 * every focus move happens in `activate` — where the `preventScroll` /
 * `scrollIntoView` order that `scroll.ts` documents is enforced.
 */
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
 * `tabindex` is deliberately absent: this module writes it, and observing
 * one's own writes is how an observer loop starts.
 */
const OBSERVED_ATTRIBUTES = [
  'disabled',
  'aria-disabled',
  'hidden',
  'aria-hidden',
  'inert',
  'style',
  'role',
  'aria-orientation',
  'aria-selected',
  'aria-checked',
  'aria-current',
  'checked',
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
  // One sync's worth of memory: if focus was lost to nowhere and the very
  // next DOM change takes that item out of the group, the two events are the
  // same event.
  const stranded = group.strandedItem
  group.strandedItem = null
  const items = collectItems(host, group.opts.itemSelector)
  releaseDeparted(group, items)
  group.items = items

  if (items.length === 0) {
    group.activeIndex = -1
    removeAttr(host, 'aria-activedescendant')
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
  // event seen from the other side, and it survives exactly one sync.
  const hadFocus = group.hasFocus || stranded === previous
  if (lostActiveItem && hadFocus && !host.contains(document.activeElement)) {
    activate(group, index, 'sync')
  }

  // Discard the records our own guarded writes may have produced, so the next
  // observer callback is about somebody else's change.
  group.observer?.takeRecords()
}

/** Move focus to `index`. The only focus move in the package. */
export function activate(group: Group, index: number, reason: KeyboardNavigationReason): void {
  const item = group.items[index]
  if (!item) return

  const previousIndex = group.activeIndex
  const previousItem = group.items[previousIndex] ?? null

  applyTabbable(group, index)
  publish(group)

  if (group.opts.activedescendant) {
    // Focus never leaves the host in this mode, so the browser scrolls
    // nothing at all — the scroll below is the only one there is.
    if (document.activeElement !== group.host) group.host.focus({ preventScroll: true })
  } else {
    // `preventScroll` is mandatory *when we are the ones scrolling*: without
    // it the UA centres the item first and the `nearest` scroll below becomes
    // a silent no-op. With `scroll: false` the consumer asked for the user
    // agent's own focus scroll, and suppressing it as well would leave a
    // scrolling list that never scrolls — an option that silently breaks the
    // widget.
    item.focus({ preventScroll: group.opts.scroll !== null })
  }
  scrollItemIntoView(item, group.opts.scroll)

  if (item !== previousItem) emit(group, { item, index, previousItem, previousIndex, reason })
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
  let index = group.items.indexOf(target)
  if (index === -1) index = group.items.findIndex((candidate) => candidate.contains(target))
  if (index === -1 || index === group.activeIndex) return
  const item = group.items[index]
  if (!item) return
  const previousItem = group.items[group.activeIndex] ?? null
  const previousIndex = group.activeIndex
  applyTabbable(group, index)
  publish(group)
  emit(group, { item, index, previousItem, previousIndex, reason })
}

/** Give the DOM back: original tabindex, no generated ids, no item hooks. */
export function release(group: Group): void {
  for (const item of group.items) {
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
  group.activeIndex = -1
  setHostState(group.host, 'disabled')
  publish(group)
  group.observer?.takeRecords()
}

/**
 * Hand back every item that just left the set — it became disabled, hidden,
 * or fell outside the selector while still in the document.
 *
 * Without this the departing item keeps whatever `tabindex` it was last given.
 * When that was the `0`, the group ends up with **two** tab stops, one of them
 * on a control the user was told is unavailable. Same class of bug as zero
 * tabbable items, and just as invisible.
 */
function releaseDeparted(group: Group, next: HTMLElement[]): void {
  if (group.items.length === 0) return
  const kept = new Set(next)
  for (const item of group.items) {
    if (kept.has(item)) continue
    restoreTabIndex(group, item)
    removeAttr(item, ITEM_ATTR)
  }
}

/** The single writer of `tabindex`, of the item hook, and of activedescendant. */
function applyTabbable(group: Group, index: number): void {
  const { host, items, opts } = group
  group.activeIndex = index

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    rememberTabIndex(group, item)
    writeAttr(item, 'tabindex', !opts.activedescendant && i === index ? '0' : '-1')
  }
  reflectItems(items, index)

  if (opts.activedescendant) {
    if (!host.hasAttribute('tabindex')) {
      writeAttr(host, 'tabindex', '0')
      group.hostTabIndexAdded = true
    }
    const active = items[index]
    if (active) writeAttr(host, 'aria-activedescendant', ensureId(group, active))
  } else {
    removeAttr(host, 'aria-activedescendant')
    if (group.hostTabIndexAdded) {
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
  item.id = id
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
 * returns a fresh array each sync, so an unconditional `api.items = items`
 * triggers every render that reads it — and since the directive's `updated`
 * hook syncs, that render triggers the next sync. Vue calls the result
 * "Maximum recursive updates exceeded" and the tab hangs.
 */
function publish(group: Group): void {
  const { api, items } = group
  if (api.items.length !== items.length || items.some((el, i) => api.items[i] !== el)) {
    api.items = items
  }
  api.activeIndex = group.activeIndex
  api.activeItem = items[group.activeIndex] ?? null
}
