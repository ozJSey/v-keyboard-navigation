/**
 * Host state — the attribute names, the per-host group record, and the WeakMap
 * that keys it by element.
 *
 * The invariant this module protects: **every DOM reflection of state happens
 * here**. If a `data-*` attribute is written anywhere else, two writers exist
 * and one of them will go stale.
 *
 * Writes are guarded (skip when the value is unchanged) because the group's
 * own MutationObserver is watching the same tree — an unconditional
 * `setAttribute` produces a mutation record even when nothing changed, and
 * that is an infinite observer loop.
 */
import type {
  KeyboardNavigationApi,
  KeyboardNavigationBinding,
  KeyboardNavigationState,
  ResolvedOptions,
} from './types'
import type { TypeaheadBuffer } from './typeahead'

/** Host CSS hook — also the marker used to detect a nested group. */
export const STATE_ATTR = 'data-keyboard-navigation-state'
/** Item CSS hook: `active` on the one tabbable item, `inactive` on the rest. */
export const ITEM_ATTR = 'data-keyboard-navigation-item'
/** Host CSS hook carrying the live typeahead buffer, absent when empty. */
export const TYPEAHEAD_ATTR = 'data-keyboard-navigation-typeahead'
/** Any host, ours or another instance's. Used to give nested groups their own events. */
export const HOST_SELECTOR = `[${STATE_ATTR}]`

/** Everything one bound element owns. Internal — never exported from the package. */
export interface Group {
  host: HTMLElement
  /** Raw binding value, kept so options can be re-resolved when `role` changes. */
  raw: KeyboardNavigationBinding | undefined
  opts: ResolvedOptions
  /** Items in DOM order, disabled/hidden already filtered out. */
  items: HTMLElement[]
  /** Index of the one tabbable item; `-1` only when there are no items. */
  activeIndex: number
  /** True between `focusin` and a `focusout` that leaves the host. */
  hasFocus: boolean
  /**
   * The item that lost focus to *nowhere* — a `focusout` with no
   * `relatedTarget`. Chrome fires exactly that when the focused element is
   * removed or disabled, and it fires it before the mutation lands, so
   * `hasFocus` is already false by the time the next sync runs. Consumed and
   * cleared by that sync.
   */
  strandedItem: HTMLElement | null
  observer: MutationObserver | undefined
  typeahead: TypeaheadBuffer
  api: KeyboardNavigationApi
  /** Original `tabindex` attribute per item, so unmount leaves the DOM as it was. */
  originalTabIndex: WeakMap<HTMLElement, string | null>
  /** Items we gave an `id` to for `aria-activedescendant`. Removed on unmount. */
  generatedIds: Set<HTMLElement>
  /** True when we added `tabindex` to the host for activedescendant mode. */
  hostTabIndexAdded: boolean
  /** Bound listeners, kept so `unmounted` removes exactly what it added. */
  onKeydown: (event: KeyboardEvent) => void
  onFocusin: (event: FocusEvent) => void
  onFocusout: (event: FocusEvent) => void
}

export const groups = new WeakMap<HTMLElement, Group>()

/** Set an attribute only when it would change. See the loop note above. */
export function writeAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

export function removeAttr(el: HTMLElement, name: string): void {
  if (el.hasAttribute(name)) el.removeAttribute(name)
}

export function setHostState(host: HTMLElement, state: KeyboardNavigationState): void {
  writeAttr(host, STATE_ATTR, state)
}

/** `active` on the current item, `inactive` on every other. */
export function reflectItems(items: HTMLElement[], activeIndex: number): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item) writeAttr(item, ITEM_ATTR, i === activeIndex ? 'active' : 'inactive')
  }
}

export function reflectTypeahead(host: HTMLElement, buffer: string): void {
  if (buffer) writeAttr(host, TYPEAHEAD_ATTR, buffer)
  else removeAttr(host, TYPEAHEAD_ATTR)
}
