/**
 * Directive lifecycle and event wiring. Owns the four listeners and hands
 * every decision to a module that owns it: `keys.ts` decides whether a
 * keystroke is ours, `roving.ts` moves focus, `typeahead.ts` matches labels,
 * `paging.ts` sizes a page.
 */
import type { DirectiveBinding, ObjectDirective } from 'vue'
import { createApi } from './api'
import { intentFor, type NavigationIntent } from './keys'
import { pageStep } from './paging'
import { activate, adopt, clearStranded, hover, indexAfter, observe, release, sync } from './roving'
import { resolveContainer, scrollParent } from './scroll'
import {
  groups,
  reflectTypeahead,
  removeAttr,
  setHostState,
  STATE_ATTR,
  TYPEAHEAD_ATTR,
  type Group,
} from './state'
import { clearBuffer, createBuffer, matchIndex, pushChar } from './typeahead'
import { createPointerTrack, isCursorInput, noteKey } from './hover'
import { resolve } from './resolve'
import { initialIndex, ownerHost } from './items'
import type { KeyboardNavigationBinding, KeyboardNavigationReason } from './types'

function create(host: HTMLElement, raw: KeyboardNavigationBinding | undefined): Group {
  // The state attribute goes on first: it is how a nested group tells its
  // items apart from its parent's.
  setHostState(host, 'idle')

  const group: Group = {
    host,
    raw,
    opts: resolve(host, raw),
    items: [],
    skipped: [],
    activeIndex: -1,
    hasFocus: false,
    observer: undefined,
    typeahead: createBuffer(),
    api: createApi(() => group),
    originalTabIndex: new WeakMap(),
    generatedIds: new Set(),
    hostTabIndexAdded: false,
    strandedItem: null,
    strandedTimer: undefined,
    pointerTarget: null,
    pointer: createPointerTrack(),
    onKeydown: (event) => onKeydown(group, event),
    onFocusin: (event) => onFocusin(group, event),
    onFocusout: (event) => onFocusout(group, event),
    onPointerdown: (event) => onPointerdown(group, event),
    onPointermove: (event) => onPointermove(group, event),
  }

  host.addEventListener('keydown', group.onKeydown)
  host.addEventListener('focusin', group.onFocusin)
  host.addEventListener('focusout', group.onFocusout)
  host.addEventListener('pointerdown', group.onPointerdown)
  // Added whatever `hover` says, and the handler's first line is the opt-out.
  // `hover` is re-resolved on every sync, so a listener attached once and
  // guarded per event is the only shape that cannot fall out of step with it;
  // the cost when the option is off is two property reads per mouse move.
  host.addEventListener('pointermove', group.onPointermove)

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
  clearStranded(group)
  host.removeEventListener('keydown', group.onKeydown)
  host.removeEventListener('focusin', group.onFocusin)
  host.removeEventListener('focusout', group.onFocusout)
  host.removeEventListener('pointerdown', group.onPointerdown)
  host.removeEventListener('pointermove', group.onPointermove)
  release(group)
  if (group.opts.ref) group.opts.ref.value = undefined
  removeAttr(host, STATE_ATTR)
  removeAttr(host, TYPEAHEAD_ATTR)
  groups.delete(host)
}

/**
 * Events from a nested group belong to that group, not to this one — and this
 * is the *only* rule for it, applied by all three of keydown, focusin and
 * focusout. `onFocusout` used to check containment instead, so tabbing out of
 * a submenu ran the whole outer-menubar focusout path: it cleared the outer
 * typeahead, reset the outer tab stop and emitted a move the consumer never
 * caused.
 *
 * Ownership is the same rule `items.ts` uses to decide whose item an element
 * is (the nearest host **strictly above** it), plus the host itself — a group
 * in `activedescendant` mode keeps focus on the host and must hear its own
 * keys. A nested group's host therefore matches twice, once as its parent's
 * item and once as its own host; the inner listener runs first and the outer
 * one sees `defaultPrevented` if the inner claimed the key.
 */
function ownsEvent(group: Group, target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target === group.host) return true
  return ownerHost(target) === group.host
}

/** Remember a real pointer press so `focusin` can tell a click from a Tab. */
function onPointerdown(group: Group, event: Event): void {
  if (!group.opts.enabled) return
  group.pointerTarget = event.target instanceof HTMLElement ? event.target : null
}

/**
 * Why focus arrived. A `pointerdown` inside the element that is now focused is
 * the one signal available synchronously and without global state: the browser
 * focuses on the pointer press's default action, so the two are the same
 * gesture. Anything else — Tab, `el.focus()`, a restore — is `focus`.
 */
function focusReason(group: Group, target: HTMLElement): KeyboardNavigationReason {
  const pointer = group.pointerTarget
  group.pointerTarget = null
  if (!pointer) return 'focus'
  return pointer === target || target.contains(pointer) ? 'pointer' : 'focus'
}

/**
 * The cursor moved. Maybe.
 *
 * `pointermove` and not `mouseover`, and this is the whole difficulty of the
 * feature: arrowing through a long list scrolls it, so the item under a
 * *stationary* cursor changes and the browser fires `mouseover` for the new
 * one. A handler written against that yanks the active item back to wherever
 * the mouse is parked, on every keystroke, and the user can never leave.
 * `hover.ts` owns the two guards that separate "the user moved the mouse"
 * from "the list moved under the mouse" — and the browser regression on
 * playground card 16 is what proves they work, because jsdom has no layout to
 * scroll and cannot see any of it.
 */
function onPointermove(group: Group, event: Event): void {
  if (!group.opts.enabled || !group.opts.hover) return
  if (!(event instanceof MouseEvent)) return
  const sample = {
    // Read off the event rather than through `instanceof PointerEvent`, which
    // is a `ReferenceError` where the constructor does not exist at all —
    // jsdom being exactly that, and a consumer's own component test being
    // exactly where an arrow key must not throw. A plain
    // `MouseEvent('pointermove')` has no `pointerType`; `hover.ts` reads an
    // absent one as a mouse and rejects only `'touch'`, by name.
    pointerType: (event as MouseEvent & { pointerType?: string }).pointerType,
    x: event.clientX,
    y: event.clientY,
    now: performance.now(),
  }
  if (!isCursorInput(group.pointer, sample)) return
  if (!(event.target instanceof HTMLElement)) return
  if (!ownsEvent(group, event.target)) return
  hover(group, event.target)
}

function onFocusin(group: Group, event: FocusEvent): void {
  if (!group.opts.enabled) return
  if (!ownsEvent(group, event.target)) return
  group.hasFocus = true
  clearStranded(group)
  setHostState(group.host, 'active')
  if (event.target instanceof HTMLElement) {
    adopt(group, event.target, focusReason(group, event.target))
  }
}

function onFocusout(group: Group, event: FocusEvent): void {
  if (!group.opts.enabled) return
  if (!ownsEvent(group, event.target)) return
  const next = event.relatedTarget
  if (next instanceof Node && group.host.contains(next)) return
  group.hasFocus = false
  group.pointerTarget = null
  // Focus went nowhere at all rather than to another control — which is what
  // Chrome reports when the focused item is removed or disabled. It is also
  // what a window blur and a Tab into the browser chrome report, so
  // `document.hasFocus()` rules those out, and the timer rules out everything
  // else: a removal blurs and mutates in the same task, while a list that
  // refreshes a moment later does not. The next sync decides the rest.
  clearStranded(group)
  if (next === null && event.target instanceof HTMLElement && document.hasFocus()) {
    const stranded = event.target
    group.strandedItem = stranded
    group.strandedTimer = setTimeout(() => {
      group.strandedItem = null
      group.strandedTimer = undefined
    }, 0)
  }
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
  // Before any early return: the point of the stamp is that the cursor stays
  // deaf for a moment after *any* key this group heard, because any of them
  // can re-flow the list under a hand that is not moving — a filter keystroke
  // as much as an arrow.
  noteKey(group.pointer, performance.now())

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
          : pageStep(group.items, group.activeIndex, direction, pageViewport(group), group.opts.axis)
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

/**
 * What a page is measured against: the pinned container, else what scrolls
 * along the axis the group navigates. The container is resolved from the host,
 * exactly as the scroll resolves it, so both answer with the same element.
 */
function pageViewport(group: Group): HTMLElement | null {
  const scroll = group.opts.scroll
  if (scroll?.container !== undefined) return resolveContainer(group.host, scroll.container)
  const active = group.items[group.activeIndex] ?? group.host
  return scrollParent(active, group.opts.axis)
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
