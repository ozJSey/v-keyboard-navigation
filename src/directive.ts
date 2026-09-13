/**
 * Directive lifecycle and event wiring. Owns the three listeners and hands
 * every decision to a module that owns it: `keys.ts` decides whether a
 * keystroke is ours, `roving.ts` moves focus, `typeahead.ts` matches labels,
 * `paging.ts` sizes a page.
 */
import type { DirectiveBinding, ObjectDirective } from 'vue'
import { createApi } from './api'
import { intentFor, type NavigationIntent } from './keys'
import { pageStep } from './paging'
import { activate, adopt, indexAfter, observe, release, sync } from './roving'
import { resolveContainer, scrollParent } from './scroll'
import {
  groups,
  HOST_SELECTOR,
  reflectTypeahead,
  removeAttr,
  setHostState,
  STATE_ATTR,
  TYPEAHEAD_ATTR,
  type Group,
} from './state'
import { clearBuffer, createBuffer, matchIndex, pushChar } from './typeahead'
import { resolve } from './resolve'
import { initialIndex } from './items'
import type { KeyboardNavigationBinding } from './types'

function create(host: HTMLElement, raw: KeyboardNavigationBinding | undefined): Group {
  // The state attribute goes on first: it is how a nested group tells its
  // items apart from its parent's.
  setHostState(host, 'idle')

  const group: Group = {
    host,
    raw,
    opts: resolve(host, raw),
    items: [],
    activeIndex: -1,
    hasFocus: false,
    observer: undefined,
    typeahead: createBuffer(),
    api: createApi(() => group),
    originalTabIndex: new WeakMap(),
    generatedIds: new Set(),
    hostTabIndexAdded: false,
    strandedItem: null,
    onKeydown: (event) => onKeydown(group, event),
    onFocusin: (event) => onFocusin(group, event),
    onFocusout: (event) => onFocusout(group, event),
  }

  host.addEventListener('keydown', group.onKeydown)
  host.addEventListener('focusin', group.onFocusin)
  host.addEventListener('focusout', group.onFocusout)

  groups.set(host, group)
  sync(group)
  observe(group)
  if (group.opts.ref) group.opts.ref.value = group.api
  return group
}

function destroy(host: HTMLElement): void {
  const group = groups.get(host)
  if (!group) return
  group.observer?.disconnect()
  group.observer = undefined
  clearBuffer(group.typeahead)
  host.removeEventListener('keydown', group.onKeydown)
  host.removeEventListener('focusin', group.onFocusin)
  host.removeEventListener('focusout', group.onFocusout)
  release(group)
  if (group.opts.ref) group.opts.ref.value = undefined
  removeAttr(host, STATE_ATTR)
  removeAttr(host, TYPEAHEAD_ATTR)
  groups.delete(host)
}

/** Events from a nested group belong to that group, not to this one. */
function ownsEvent(group: Group, target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest(HOST_SELECTOR) === group.host
}

function onFocusin(group: Group, event: FocusEvent): void {
  if (!ownsEvent(group, event.target)) return
  group.hasFocus = true
  group.strandedItem = null
  setHostState(group.host, 'active')
  if (event.target instanceof HTMLElement) adopt(group, event.target, 'pointer')
}

function onFocusout(group: Group, event: FocusEvent): void {
  const next = event.relatedTarget
  if (next instanceof Node && group.host.contains(next)) return
  group.hasFocus = false
  // Focus went nowhere at all rather than to another control — which is what
  // Chrome reports when the focused item is removed or disabled. The next
  // sync decides whether that is what happened.
  group.strandedItem = next === null && event.target instanceof HTMLElement ? event.target : null
  setHostState(group.host, group.items.length === 0 ? 'empty' : 'idle')
  clearBuffer(group.typeahead)
  reflectTypeahead(group.host, '')
  // `nomemory`: the tab stop goes back to where it started rather than to
  // wherever the user last was.
  if (!group.opts.memory && group.items.length > 0) {
    const item = group.items[initialIndex(group.items)]
    if (item) adopt(group, item, 'sync')
  }
}

function onKeydown(group: Group, event: KeyboardEvent): void {
  if (!group.opts.enabled) return
  if (!ownsEvent(group, event.target)) return

  // Escape drops a half-typed typeahead word. Never claimed — Escape means
  // "close the menu" to the application, and it still will.
  if (event.key === 'Escape') {
    clearBuffer(group.typeahead)
    reflectTypeahead(group.host, '')
    return
  }

  const intent = intentFor(event, {
    axis: group.opts.axis,
    rtl: getComputedStyle(group.host).direction === 'rtl',
    homeEnd: group.opts.homeEnd,
    page: group.opts.page,
    typeahead: group.opts.typeahead,
    buffered: group.typeahead.text.length > 0,
  })
  if (!intent) return
  if (group.items.length === 0) return

  const index = targetIndex(group, intent)
  if (index === -1) return

  // Claimed only now that it is going to be acted on: an arrow key that
  // matched nothing must still scroll the page, and a letter that matched no
  // item must still reach the application.
  event.preventDefault()
  activate(group, index, intent.kind === 'type' ? 'typeahead' : 'key')
}

function targetIndex(group: Group, intent: NavigationIntent): number {
  switch (intent.kind) {
    case 'move':
      if (intent.to === 'first') return 0
      if (intent.to === 'last') return group.items.length - 1
      return indexAfter(group, intent.to === 'next' ? 1 : -1, group.opts.wrap)
    case 'page': {
      const direction = intent.to === 'next' ? 1 : -1
      const step =
        typeof group.opts.page === 'number'
          ? group.opts.page
          : pageStep(group.items, group.activeIndex, direction, pageViewport(group))
      // A page always stops at the end. Wrapping a whole page past the last
      // item is disorienting in a way a single arrow step is not.
      return indexAfter(group, step * direction, false)
    }
    case 'type': {
      const buffer = pushChar(
        group.typeahead,
        intent.char,
        group.opts.typeaheadTimeout,
        () => reflectTypeahead(group.host, ''),
      )
      reflectTypeahead(group.host, buffer)
      return matchIndex(group.items, buffer, group.activeIndex)
    }
  }
}

/** What a page is measured against: the pinned container, else what scrolls. */
function pageViewport(group: Group): HTMLElement | null {
  const scroll = group.opts.scroll
  const active = group.items[group.activeIndex] ?? group.host
  if (scroll?.container !== undefined) return resolveContainer(active, scroll.container)
  return scrollParent(active)
}

/**
 * `v-keyboard-navigation` — one tab stop for a group of controls.
 *
 * Client-only by contract: Vue runs directive hooks in the browser, so there
 * is nothing to guard for SSR.
 */
export const vKeyboardNavigation: ObjectDirective<HTMLElement, KeyboardNavigationBinding | undefined> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<KeyboardNavigationBinding | undefined>) {
    create(el, binding.value)
  },
  updated(el: HTMLElement, binding: DirectiveBinding<KeyboardNavigationBinding | undefined>) {
    const group = groups.get(el)
    if (!group) return
    const hadRef = group.opts.ref
    group.raw = binding.value
    sync(group)
    if (hadRef && hadRef !== group.opts.ref) hadRef.value = undefined
    if (group.opts.ref) group.opts.ref.value = group.api
  },
  unmounted(el: HTMLElement) {
    destroy(el)
  },
}

export default vKeyboardNavigation
