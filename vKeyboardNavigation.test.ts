import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref, withDirectives, type App, type VNode } from 'vue'
import {
  DIRECTIVE_NAME,
  KeyboardNavigationPlugin,
  NO_ROLE_DEFAULTS,
  OPT_OUT_SELECTOR,
  ROLE_DEFAULTS,
  vKeyboardNavigation,
  type KeyboardNavigationApi,
  type KeyboardNavigationBinding,
  type KeyboardNavigationEventDetail,
} from './vKeyboardNavigation'
// Internal, imported directly: both are pure geometry, and the directive path
// through them can only ever exercise the no-layout branch under jsdom.
import { pageStep } from './src/paging'
import { scrollParent } from './src/scroll'
import { createPointerTrack, HOVER_AFTER_KEY_MS, isCursorInput, noteKey } from './src/hover'

// ---------------------------------------------------------------------------
// Harness
//
// Everything mounts through a real Vue app with a render function, so the
// directive's mounted / updated / unmounted hooks fire exactly as they would
// in an application — including the re-renders that break the one-tabbable
// invariant, which is the whole point of the suite.
// ---------------------------------------------------------------------------

/** jsdom implements neither call, so both are installed as recording spies. */
interface Call {
  kind: 'focus' | 'scroll' | 'scrollTo'
  label: string
  /** The element the call landed on — which box scrolled is the whole point. */
  el: Element
  arg: unknown
}
let calls: Call[] = []
const realFocus = HTMLElement.prototype.focus

function label(el: Element): string {
  // `aria-label` before the tag name: an `<input>` has no text content, and a
  // tab-order assertion that reads `'input'` cannot say *which* input.
  return (el.textContent ?? '').trim() || el.getAttribute('aria-label') || el.tagName.toLowerCase()
}

beforeEach(() => {
  calls = []
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    calls.push({ kind: 'focus', label: label(this), el: this, arg: options })
    realFocus.call(this, options)
  })
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    calls.push({ kind: 'scroll', label: label(this), el: this, arg })
  }
  Element.prototype.scrollTo = function (this: Element, arg?: unknown) {
    calls.push({ kind: 'scrollTo', label: label(this), el: this, arg })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  Reflect.deleteProperty(Element.prototype, 'scrollTo')
  document.body.innerHTML = ''
})

/** jsdom reports every box as 0x0; these two state the geometry a test needs. */
function stubBox(el: HTMLElement, box: { top: number; left: number; width: number; height: number }): void {
  el.getBoundingClientRect = () => ({
    top: box.top,
    left: box.left,
    right: box.left + box.width,
    bottom: box.top + box.height,
    width: box.width,
    height: box.height,
    x: box.left,
    y: box.top,
    toJSON: () => '',
  })
}

function stubMetric(el: HTMLElement, name: 'clientHeight' | 'clientWidth', value: number): void {
  Object.defineProperty(el, name, { value, configurable: true })
}

function must<T>(value: T | null | undefined, what = 'element'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`)
  return value
}

interface Mounted {
  app: App
  host: HTMLElement
  /** Arrow stops only — what `active`/`inactive` marks. */
  items(): HTMLElement[]
  /** Matched but stepped over: `data-keyboard-navigation-item="skipped"`. */
  skipped(): HTMLElement[]
  tabbable(): HTMLElement[]
  labels(): string[]
  skippedLabels(): string[]
  active(): string
  unmount(): void
}

const ITEM = '[data-keyboard-navigation-item="active"], [data-keyboard-navigation-item="inactive"]'
const SKIPPED = '[data-keyboard-navigation-item="skipped"]'

function mount(
  children: () => VNode[],
  binding: () => KeyboardNavigationBinding | undefined = () => undefined,
  hostProps: Record<string, unknown> = {},
): Mounted {
  const root = document.createElement('div')
  document.body.appendChild(root)

  const app = createApp({
    render: () =>
      withDirectives(h('div', { class: 'host', ...hostProps }, children()), [
        [vKeyboardNavigation, binding()],
      ]),
  })
  app.mount(root)

  const host = must(root.querySelector<HTMLElement>('.host'), 'host')
  return {
    app,
    host,
    items: () => [...host.querySelectorAll<HTMLElement>(ITEM)],
    skipped: () => [...host.querySelectorAll<HTMLElement>(SKIPPED)],
    tabbable: () => [...host.querySelectorAll<HTMLElement>('[tabindex="0"]')],
    labels: () => [...host.querySelectorAll(ITEM)].map(label),
    skippedLabels: () => [...host.querySelectorAll(SKIPPED)].map(label),
    active: () => label(must(host.querySelector('[data-keyboard-navigation-item="active"]'), 'active')),
    unmount: () => app.unmount(),
  }
}

const buttons = (...names: string[]): VNode[] =>
  names.map((name) => h('button', { key: name }, name))

function press(target: Element | null, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  must(target, 'key target').dispatchEvent(event)
  return event
}

/** Press against whatever currently holds focus — what a real user does. */
function type(mounted: Mounted, ...keys: string[]): KeyboardEvent {
  let event: KeyboardEvent | undefined
  for (const key of keys) {
    event = press(document.activeElement ?? mounted.host, key)
  }
  return must(event, 'key event')
}

/** A real pointer press, which is what tells `focusin` a click from a Tab. */
function pointerDown(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

/** Let the current task finish, so a `setTimeout(0)` guard can expire. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Let Vue render, then let the MutationObserver microtask run. */
async function settle(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

// ---------------------------------------------------------------------------
// The bare binding
// ---------------------------------------------------------------------------
describe('bare binding', () => {
  it('makes exactly one item tabbable and the rest reachable only by arrow', () => {
    const ui = mount(() => buttons('Bold', 'Italic', 'Underline'))
    expect(ui.tabbable().map(label)).toEqual(['Bold'])
    expect(ui.items().map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('reflects idle state and the active item hook', () => {
    const ui = mount(() => buttons('One', 'Two'))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')
    expect(ui.labels()).toEqual(['One', 'Two'])
    expect(ui.active()).toBe('One')
  })

  it('starts on the item the application already marks current', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'b', 'aria-selected': 'true' }, 'B'),
      h('button', { key: 'c' }, 'C'),
    ])
    expect(ui.active()).toBe('B')
    expect(ui.tabbable().map(label)).toEqual(['B'])
  })

  it('accepts aria-current and a checked radio as the starting point', () => {
    const current = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'b', 'aria-current': 'page' }, 'B'),
    ])
    expect(current.active()).toBe('B')
    current.unmount()

    const checked = mount(() => [
      h('input', { key: 'a', type: 'radio', name: 'r', 'aria-label': 'A' }),
      h('input', { key: 'b', type: 'radio', name: 'r', checked: true, 'aria-label': 'B' }),
    ])
    expect(checked.host.querySelectorAll('[tabindex="0"]').length).toBe(1)
    expect(must(checked.host.querySelector('[tabindex="0"]')).getAttribute('aria-label')).toBe('B')
  })

  it('binds both axes with no role', () => {
    const ui = mount(() => buttons('A', 'B', 'C'))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowRight')
    expect(ui.active()).toBe('B')
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('C')
    type(ui, 'ArrowUp')
    expect(ui.active()).toBe('B')
    type(ui, 'ArrowLeft')
    expect(ui.active()).toBe('A')
  })

  it('moves the DOM focus, not just the attribute', () => {
    const ui = mount(() => buttons('A', 'B'))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(document.activeElement).toBe(ui.items()[1])
  })

  it('clamps with no role rather than wrapping silently', () => {
    const ui = mount(() => buttons('A', 'B'))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowUp')
    expect(ui.active()).toBe('A')
    type(ui, 'ArrowDown', 'ArrowDown')
    expect(ui.active()).toBe('B')
  })

  it('Home and End jump to the ends', () => {
    const ui = mount(() => buttons('A', 'B', 'C'))
    must(ui.items()[0]).focus()
    type(ui, 'End')
    expect(ui.active()).toBe('C')
    type(ui, 'Home')
    expect(ui.active()).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// Roles: orientation and wrap
// ---------------------------------------------------------------------------
describe('role defaults', () => {
  it('a toolbar is horizontal and clamps', () => {
    const ui = mount(() => buttons('A', 'B'), () => undefined, { role: 'toolbar' })
    must(ui.items()[0]).focus()
    expect(type(ui, 'ArrowDown').defaultPrevented).toBe(false)
    expect(ui.active()).toBe('A')
    type(ui, 'ArrowRight')
    expect(ui.active()).toBe('B')
    type(ui, 'ArrowRight')
    expect(ui.active()).toBe('B')
  })

  it('a menu is vertical and wraps', () => {
    const ui = mount(() => buttons('A', 'B'), () => undefined, { role: 'menu' })
    must(ui.items()[0]).focus()
    expect(type(ui, 'ArrowRight').defaultPrevented).toBe(false)
    type(ui, 'ArrowDown', 'ArrowDown')
    expect(ui.active()).toBe('A')
    type(ui, 'ArrowUp')
    expect(ui.active()).toBe('B')
  })

  it('a tablist wraps, a listbox clamps', () => {
    const tabs = mount(() => buttons('A', 'B'), () => undefined, { role: 'tablist' })
    must(tabs.items()[0]).focus()
    type(tabs, 'ArrowLeft')
    expect(tabs.active()).toBe('B')
    tabs.unmount()

    const list = mount(() => buttons('A', 'B'), () => undefined, { role: 'listbox' })
    must(list.items()[0]).focus()
    type(list, 'ArrowUp')
    expect(list.active()).toBe('A')
  })

  it('the string binding names the pattern without writing a role', () => {
    const ui = mount(() => buttons('A', 'B'), () => 'menu')
    expect(ui.host.hasAttribute('role')).toBe(false)
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown', 'ArrowDown')
    expect(ui.active()).toBe('A')
  })

  it('aria-orientation narrows the axis, and the option beats both', () => {
    const aria = mount(() => buttons('A', 'B'), () => undefined, { 'aria-orientation': 'vertical' })
    must(aria.items()[0]).focus()
    expect(type(aria, 'ArrowRight').defaultPrevented).toBe(false)
    expect(type(aria, 'ArrowDown').defaultPrevented).toBe(true)
    aria.unmount()

    const forced = mount(() => buttons('A', 'B'), () => ({ orientation: 'inline' as const }), {
      'aria-orientation': 'vertical',
    })
    must(forced.items()[0]).focus()
    expect(type(forced, 'ArrowRight').defaultPrevented).toBe(true)
    expect(type(forced, 'ArrowDown').defaultPrevented).toBe(false)
  })

  it('follows the inline axis in a right-to-left group', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ orientation: 'inline' as const }), {
      style: 'direction: rtl',
    })
    must(ui.items()[0]).focus()
    type(ui, 'ArrowLeft')
    expect(ui.active()).toBe('B')
    type(ui, 'ArrowRight')
    expect(ui.active()).toBe('A')
  })

  it('an explicit wrap option overrides the role default', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ wrap: 'wrap' as const }), { role: 'toolbar' })
    must(ui.items()[0]).focus()
    type(ui, 'ArrowLeft')
    expect(ui.active()).toBe('B')
  })
})

// ---------------------------------------------------------------------------
// The one-tabbable invariant — the #1 bug this package exists to prevent.
//
// A group that reaches zero tabbable items disappears from the keyboard and
// nothing says so. Every one of these mutates the list *after* mount, the way
// a v-for, a v-if or an async load does.
// ---------------------------------------------------------------------------
describe('exactly one tabbable item, always', () => {
  const tabbableCount = (host: HTMLElement) => host.querySelectorAll('[tabindex="0"]').length

  it('holds while items are appended', async () => {
    const names = ref(['A', 'B'])
    const ui = mount(() => buttons(...names.value))
    names.value = [...names.value, 'C', 'D']
    await settle()
    expect(tabbableCount(ui.host)).toBe(1)
    expect(ui.labels()).toEqual(['A', 'B', 'C', 'D'])
    expect(ui.active()).toBe('A')
  })

  it('holds when the tabbable item itself is removed, and keeps the position', async () => {
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    must(ui.items()[1]).focus()
    expect(ui.active()).toBe('B')

    names.value = ['A', 'C']
    await settle()
    expect(tabbableCount(ui.host)).toBe(1)
    // Position held, not identity: index 1 is now C.
    expect(ui.active()).toBe('C')
  })

  it('rescues the focus the browser dropped when the focused item was removed', async () => {
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    must(ui.items()[1]).focus()
    expect(document.activeElement).toBe(ui.items()[1])

    names.value = ['A', 'C']
    await settle()
    // Without the rescue, activeElement here is <body> and the keyboard user
    // has been thrown out of the widget by a list update.
    expect(document.activeElement).toBe(ui.items()[1])
    expect(label(must(document.activeElement))).toBe('C')
  })

  it('rescues focus when the browser blurs the item before removing it', async () => {
    // Chrome fires `focusout` with a null relatedTarget as part of removing
    // the focused element, so by the time the mutation lands the group no
    // longer believes it has focus. jsdom fires nothing at all, so the
    // browser's sequence is reproduced here explicitly — it is the sequence
    // that broke the rescue in a real browser while this suite stayed green.
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    const second = must(ui.items()[1])
    second.focus()
    second.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')

    names.value = ['A', 'C']
    await settle()
    expect(label(must(document.activeElement))).toBe('C')
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('active')
  })

  it('does not rescue focus a sync later, once the group has moved on', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    must(ui.items()[1]).focus()
    // Focus lost to nowhere, then an unrelated change, and only then the
    // removal. The stranded item survives exactly one sync, so this is a
    // click-away, not a stranding.
    must(ui.items()[1]).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    names.value = ['A', 'B', 'C', 'D']
    await settle()
    names.value = ['A', 'C', 'D']
    await settle()
    expect(document.activeElement).toBe(document.body)
    expect(ui.host.querySelectorAll('[tabindex="0"]').length).toBe(1)
  })

  it('does not rescue focus the user deliberately moved away', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    must(ui.items()[1]).focus()
    outside.focus()
    expect(document.activeElement).toBe(outside)

    // The item that had focus is now removed — but focus went somewhere real
    // before that, so there is nobody to rescue.
    names.value = ['A', 'C']
    await settle()
    expect(document.activeElement).toBe(outside)
  })

  it('does not steal focus when the group never had it', async () => {
    const names = ref(['A', 'B'])
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const ui = mount(() => buttons(...names.value))
    outside.focus()

    names.value = ['B']
    await settle()
    expect(document.activeElement).toBe(outside)
    expect(tabbableCount(ui.host)).toBe(1)
  })

  it('reports an empty group instead of pretending, and recovers when items arrive', async () => {
    const names = ref<string[]>([])
    const ui = mount(() => buttons(...names.value))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('empty')
    expect(tabbableCount(ui.host)).toBe(0)

    names.value = ['A', 'B']
    await settle()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')
    expect(tabbableCount(ui.host)).toBe(1)
    expect(ui.active()).toBe('A')
  })

  it('survives every item being removed and then restored', async () => {
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    must(ui.items()[2]).focus()

    names.value = []
    await settle()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('empty')

    names.value = ['X', 'Y']
    await settle()
    expect(tabbableCount(ui.host)).toBe(1)
    expect(ui.active()).toBe('X')
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('Y')
  })

  it('holds through a reorder', async () => {
    const names = ref(['A', 'B', 'C'])
    const ui = mount(() => buttons(...names.value))
    must(ui.items()[2]).focus()
    expect(ui.active()).toBe('C')

    names.value = ['C', 'A', 'B']
    await settle()
    expect(tabbableCount(ui.host)).toBe(1)
    // Identity wins when the item is still there: C is still the tab stop.
    expect(ui.active()).toBe('C')
    expect(ui.labels()).toEqual(['C', 'A', 'B'])
  })

  it('re-establishes the invariant when the tabbable item becomes disabled', async () => {
    const disabled = ref(false)
    const ui = mount(() => [
      h('button', { key: 'a', disabled: disabled.value }, 'A'),
      h('button', { key: 'b' }, 'B'),
    ])
    expect(ui.active()).toBe('A')

    disabled.value = true
    await settle()
    expect(tabbableCount(ui.host)).toBe(1)
    expect(ui.labels()).toEqual(['B'])
    expect(ui.active()).toBe('B')
  })

  it('reacts to a DOM change Vue never made', async () => {
    const ui = mount(() => buttons('A', 'B'))
    const extra = document.createElement('button')
    extra.textContent = 'C'
    ui.host.appendChild(extra)
    await settle()
    expect(ui.labels()).toEqual(['A', 'B', 'C'])
    expect(tabbableCount(ui.host)).toBe(1)
  })

  it('writes nothing when a sync changes nothing — the observer-loop guard', async () => {
    const api = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B'), () => ({ ref: api }))
    await settle()

    const records: MutationRecord[] = []
    const spy = new MutationObserver((list) => records.push(...list))
    spy.observe(ui.host, { attributes: true, subtree: true, childList: true })
    // A full re-sync over an unchanged DOM. Every write it makes is a write of
    // the value that is already there, and an unguarded `setAttribute` still
    // produces a mutation record — which the group's own observer would then
    // pick up, and so on.
    must(api.value).refresh()
    await settle()
    spy.disconnect()
    expect(records.map((r) => r.attributeName)).toEqual([])
  })

  it('does not loop: its own writes produce no further observer work', async () => {
    const ui = mount(() => buttons('A', 'B'))
    let callbacks = 0
    const spy = new MutationObserver(() => callbacks++)
    spy.observe(ui.host, { attributes: true, subtree: true, childList: true })
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    await settle()
    await settle()
    const afterMove = callbacks
    await settle()
    spy.disconnect()
    // The move writes attributes once; nothing re-triggers afterwards.
    expect(callbacks).toBe(afterMove)
  })
})

// ---------------------------------------------------------------------------
// Skipping
// ---------------------------------------------------------------------------
describe('skipping', () => {
  it('skips disabled, aria-disabled, hidden, inert and v-show', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'b', disabled: true }, 'B'),
      h('button', { key: 'c', 'aria-disabled': 'true' }, 'C'),
      h('button', { key: 'd', hidden: true }, 'D'),
      h('button', { key: 'e', inert: '' }, 'E'),
      h('button', { key: 'f', style: 'display: none' }, 'F'),
      h('button', { key: 'g', 'aria-hidden': 'true' }, 'G'),
      h('button', { key: 'h' }, 'H'),
    ])
    expect(ui.labels()).toEqual(['A', 'H'])
    // C and G are focusable, so leaving them alone would grow two extra tab
    // stops. They are held instead, and marked as held.
    expect(ui.skippedLabels()).toEqual(['C', 'G'])
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('H')
  })

  it('skips a whole hidden subtree', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('div', { key: 'wrap', hidden: true }, [h('button', { key: 'b' }, 'B')]),
      h('button', { key: 'c' }, 'C'),
    ])
    expect(ui.labels()).toEqual(['A', 'C'])
  })

  it('honours a custom item selector', () => {
    const ui = mount(() => [
      h('button', { key: 'a', class: 'item' }, 'A'),
      h('button', { key: 'b' }, 'B'),
      h('button', { key: 'c', class: 'item' }, 'C'),
    ], () => ({ items: '.item' }))
    expect(ui.labels()).toEqual(['A', 'C'])
  })

  it('adopts ARIA item roles that are not natively focusable', () => {
    const ui = mount(() => [
      h('li', { key: 'a', role: 'option' }, 'A'),
      h('li', { key: 'b', role: 'option' }, 'B'),
    ])
    expect(ui.labels()).toEqual(['A', 'B'])
    expect(ui.items().map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1'])
  })
})

// ---------------------------------------------------------------------------
// The scroll wedge
//
// The order is the product. `focus()` then `scrollIntoView({block:'nearest'})`
// is a silent no-op, because the UA has already centred the item and
// `nearest` finds it on screen. Browser-side proof of the resulting scrollTop
// trace lives in playground/scripts/interactions/v-keyboard-navigation.mjs.
// ---------------------------------------------------------------------------
describe('controlled scroll', () => {
  it('focuses with preventScroll and only then scrolls, by default', () => {
    const ui = mount(() => buttons('A', 'B'))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')

    expect(calls.map((c) => c.kind)).toEqual(['focus', 'scroll'])
    expect(calls[0]?.arg).toEqual({ preventScroll: true })
    expect(calls[1]?.arg).toEqual({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
  })

  it('defaults to instant, because smooth lags a held arrow key', () => {
    const ui = mount(() => buttons('A', 'B'))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    const scroll = calls.find((c) => c.kind === 'scroll')
    expect(scroll?.arg).toMatchObject({ behavior: 'instant' })
  })

  it('passes the borrowed option shape through', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({
      scroll: { behavior: 'smooth' as const, block: 'center' as const, inline: 'start' as const },
    }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    expect(calls.find((c) => c.kind === 'scroll')?.arg).toEqual({
      behavior: 'smooth',
      block: 'center',
      inline: 'start',
    })
  })

  it('scroll: false hands the scroll back to the browser, preventScroll included', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: false }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    // No scroll of ours — and crucially no `preventScroll` either. Keeping it
    // would suppress the user agent's focus scroll too, and the list would
    // never scroll at all.
    expect(calls.map((c) => c.kind)).toEqual(['focus'])
    expect(calls[0]?.arg).toEqual({ preventScroll: false })
  })

  it('scrolls a pinned container itself instead of the ancestor chain', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: '.host' } }))
    // jsdom has no layout, so the geometry is stated outright: a 100px
    // viewport with the second item sitting at 140-180.
    stubBox(ui.host, { top: 0, left: 0, width: 100, height: 100 })
    stubMetric(ui.host, 'clientHeight', 100)
    stubMetric(ui.host, 'clientWidth', 100)
    stubBox(must(ui.items()[1]), { top: 140, left: 0, width: 100, height: 40 })

    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')

    // No native scrollIntoView at all: the container path owns the scroll.
    expect(calls.some((c) => c.kind === 'scroll')).toBe(false)
    expect(calls.map((c) => c.kind)).toEqual(['focus', 'scrollTo'])
    // `nearest` on an item below the fold: bring its far edge to the bottom.
    expect(calls[1]?.arg).toMatchObject({ top: 80, behavior: 'instant' })
  })

  it('leaves a pinned container alone when the item is already in view', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: '.host' } }))
    stubBox(ui.host, { top: 0, left: 0, width: 100, height: 100 })
    stubMetric(ui.host, 'clientHeight', 100)
    stubMetric(ui.host, 'clientWidth', 100)
    stubBox(must(ui.items()[1]), { top: 40, left: 0, width: 100, height: 40 })

    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    expect(calls.map((c) => c.kind)).toEqual(['focus'])
  })

  it('opens a gap for a sticky header when a container is pinned', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({
      scroll: { container: '.host', offset: { top: 30 } },
    }))
    stubBox(ui.host, { top: 0, left: 0, width: 100, height: 100 })
    stubMetric(ui.host, 'clientHeight', 100)
    stubMetric(ui.host, 'clientWidth', 100)
    // Visible by geometry, but underneath the 30px sticky header.
    stubBox(must(ui.items()[1]), { top: 10, left: 0, width: 100, height: 40 })

    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    expect(calls[1]?.arg).toMatchObject({ top: -20 })
  })

  it('a container that resolves to nothing is a silent no-op, not a fallback', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: '#nope' } }))
    must(ui.items()[0]).focus()
    calls.length = 0
    expect(() => type(ui, 'ArrowDown')).not.toThrow()
    expect(calls.map((c) => c.kind)).toEqual(['focus'])
    expect(ui.active()).toBe('B')
  })

  it('a malformed selector never throws out of a keydown handler', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: '((' } }))
    must(ui.items()[0]).focus()
    expect(() => type(ui, 'ArrowDown')).not.toThrow()
    expect(ui.active()).toBe('B')
  })

  it('an offset never touches an item\u2019s style, because style is observed', () => {
    // It used to be written as an ephemeral inline `scroll-margin`. `style` is
    // in the observer's attributeFilter, so that woke a full re-sync twice per
    // keystroke and left `style=""` behind for ever.
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { offset: { top: 64 } } }))
    const second = must(ui.items()[1])
    must(ui.items()[0]).focus()

    let styleDuringCall: string | null = 'unset'
    Element.prototype.scrollIntoView = function (this: Element) {
      styleDuringCall = this.getAttribute('style')
    }
    type(ui, 'ArrowDown')
    expect(styleDuringCall).toBe(null)
    expect(second.hasAttribute('style')).toBe(false)
  })

  it('with an offset and no container, scrolls the nearest scroller itself', () => {
    const ui = mount(() => buttons('A', 'B'))
    // A scrolling parent for the group, stated rather than measured.
    const pane = must(ui.host.parentElement)
    Object.defineProperty(pane, 'scrollHeight', { value: 400, configurable: true })
    stubMetric(pane, 'clientHeight', 100)
    pane.style.overflowY = 'auto'
    stubBox(pane, { top: 0, left: 0, width: 200, height: 100 })
    stubBox(must(ui.items()[1]), { top: 150, left: 0, width: 200, height: 40 })

    const app = mount(() => buttons('A', 'B'), () => ({ scroll: { offset: { top: 20 } } }))
    const paneTwo = must(app.host.parentElement)
    Object.defineProperty(paneTwo, 'scrollHeight', { value: 400, configurable: true })
    stubMetric(paneTwo, 'clientHeight', 100)
    paneTwo.style.overflowY = 'auto'
    stubBox(paneTwo, { top: 0, left: 0, width: 200, height: 100 })
    stubBox(must(app.items()[1]), { top: 150, left: 0, width: 200, height: 40 })
    must(app.items()[0]).focus()
    calls.length = 0
    type(app, 'ArrowDown')

    // Our maths on the pane, not a native `scrollIntoView` up the chain.
    expect(calls.map((c) => c.kind)).toEqual(['focus', 'scrollTo'])
    ui.unmount()
  })
})

// ---------------------------------------------------------------------------
// Typeahead
// ---------------------------------------------------------------------------
describe('typeahead', () => {
  it('jumps to the first item whose label starts with what was typed', () => {
    const ui = mount(() => buttons('Apple', 'Banana', 'Cherry'))
    must(ui.items()[0]).focus()
    type(ui, 'c')
    expect(ui.active()).toBe('Cherry')
    expect(document.activeElement).toBe(ui.items()[2])
  })

  it('refines as the buffer grows instead of skipping ahead', () => {
    const ui = mount(() => buttons('Apple', 'Banana', 'Bandana'))
    must(ui.items()[0]).focus()
    type(ui, 'b')
    expect(ui.active()).toBe('Banana')
    type(ui, 'a')
    // "ba" still matches Banana, so the search starts *at* it. Starting one
    // past would slide to Bandana on every extra keystroke.
    expect(ui.active()).toBe('Banana')
    type(ui, 'n', 'd')
    expect(ui.active()).toBe('Bandana')
  })

  it('cycles through the matches when the same letter is repeated', () => {
    const ui = mount(() => buttons('Apple', 'Apricot', 'Avocado'))
    must(ui.items()[0]).focus()
    type(ui, 'a')
    expect(ui.active()).toBe('Apricot')
    type(ui, 'a')
    expect(ui.active()).toBe('Avocado')
    type(ui, 'a')
    expect(ui.active()).toBe('Apple')
  })

  it('exposes the live buffer as a CSS hook and clears it on timeout', () => {
    vi.useFakeTimers()
    try {
      const ui = mount(() => buttons('Banana', 'Cherry'), () => ({ typeaheadTimeout: 300 }))
      must(ui.items()[0]).focus()
      type(ui, 'b', 'a')
      expect(ui.host.getAttribute('data-keyboard-navigation-typeahead')).toBe('ba')
      vi.advanceTimersByTime(299)
      expect(ui.host.hasAttribute('data-keyboard-navigation-typeahead')).toBe(true)
      vi.advanceTimersByTime(2)
      expect(ui.host.hasAttribute('data-keyboard-navigation-typeahead')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves Space to the control until a word is being typed', () => {
    const ui = mount(() => buttons('New tab', 'Now'))
    must(ui.items()[0]).focus()
    expect(type(ui, ' ').defaultPrevented).toBe(false)
    type(ui, 'n')
    expect(ui.active()).toBe('Now')
    // Mid-word the space belongs to the buffer: "new " matches "New tab".
    expect(type(ui, 'e', 'w', ' ').defaultPrevented).toBe(true)
    expect(ui.active()).toBe('New tab')
  })

  it('reads a label from aria-label and from a wrapping <label>', () => {
    const ui = mount(() => [
      h('label', { key: 'a' }, [h('input', { type: 'radio', name: 'g' }), ' Zebra']),
      h('button', { key: 'b', 'aria-label': 'Quokka' }, '🦘'),
    ])
    must(ui.items()[0]).focus()
    type(ui, 'q')
    expect(document.activeElement).toBe(ui.items()[1])
    type(ui, 'Escape', 'z')
    expect(document.activeElement).toBe(ui.items()[0])
  })

  it('claims nothing when no label matches', () => {
    const ui = mount(() => buttons('Apple', 'Banana'))
    must(ui.items()[0]).focus()
    expect(type(ui, 'z').defaultPrevented).toBe(false)
    expect(ui.active()).toBe('Apple')
  })

  it('is off when asked, and then letters reach the application', () => {
    const ui = mount(() => buttons('Apple', 'Banana'), () => ({ typeahead: false }))
    must(ui.items()[0]).focus()
    expect(type(ui, 'b').defaultPrevented).toBe(false)
    expect(ui.active()).toBe('Apple')
  })

  it('Escape drops a half-typed word without claiming the key', () => {
    const ui = mount(() => buttons('Apple', 'Apricot'))
    must(ui.items()[0]).focus()
    type(ui, 'a')
    expect(ui.host.hasAttribute('data-keyboard-navigation-typeahead')).toBe(true)
    expect(type(ui, 'Escape').defaultPrevented).toBe(false)
    expect(ui.host.hasAttribute('data-keyboard-navigation-typeahead')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Keys the directive must never claim
// ---------------------------------------------------------------------------
describe('key discipline', () => {
  it('never intercepts inside a text input', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('input', { key: 'i', type: 'text', 'aria-label': 'Filter' }),
      h('button', { key: 'b' }, 'B'),
    ])
    const input = must(ui.host.querySelector<HTMLElement>('input'))
    input.focus()
    expect(press(input, 'ArrowDown').defaultPrevented).toBe(false)
    expect(press(input, 'Home').defaultPrevented).toBe(false)
    expect(press(input, 'b').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
  })

  it('never intercepts inside a textarea, a select or contenteditable', () => {
    const ui = mount(() => [
      h('textarea', { key: 't', 'aria-label': 'Notes' }),
      h('select', { key: 's', 'aria-label': 'Pick' }, [h('option', 'One')]),
      h('div', { key: 'c', contenteditable: 'true' }, 'Edit me'),
    ])
    for (const el of [...ui.host.children] as HTMLElement[]) {
      expect(press(el, 'ArrowDown').defaultPrevented).toBe(false)
      expect(press(el, 'a').defaultPrevented).toBe(false)
    }
  })

  it('leaves a native radio group its own arrow behaviour', () => {
    const ui = mount(() => [
      h('input', { key: 'a', type: 'radio', name: 'r', 'aria-label': 'A' }),
      h('input', { key: 'b', type: 'radio', name: 'r', 'aria-label': 'B' }),
    ])
    const first = must(ui.items()[0])
    first.focus()
    // The browser moves focus AND checks the next radio. Claiming the key
    // here would move focus while suppressing the selection.
    expect(press(first, 'ArrowDown').defaultPrevented).toBe(false)
    // Home/End and typeahead have no native behaviour, so they still work.
    expect(press(first, 'End').defaultPrevented).toBe(true)
  })

  it('drives role="radio" elements, which have no native behaviour', () => {
    const ui = mount(() => [
      h('div', { key: 'a', role: 'radio', 'aria-checked': 'false' }, 'A'),
      h('div', { key: 'b', role: 'radio', 'aria-checked': 'false' }, 'B'),
    ], () => undefined, { role: 'radiogroup' })
    must(ui.items()[0]).focus()
    expect(type(ui, 'ArrowDown').defaultPrevented).toBe(true)
    expect(ui.active()).toBe('B')
    // Selection is the application's: nothing was checked.
    expect(ui.items().map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'false'])
  })

  it('leaves Tab, Enter and modified keystrokes alone', () => {
    const ui = mount(() => buttons('A', 'B'))
    must(ui.items()[0]).focus()
    for (const key of ['Tab', 'Enter', 'Escape', 'F5']) {
      expect(press(document.activeElement, key).defaultPrevented).toBe(false)
    }
    expect(press(document.activeElement, 'ArrowDown', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(document.activeElement, 'ArrowDown', { metaKey: true }).defaultPrevented).toBe(false)
    expect(press(document.activeElement, 'ArrowDown', { altKey: true }).defaultPrevented).toBe(false)
    expect(ui.active()).toBe('A')
  })

  it('claims an arrow only when it can act on it', () => {
    const ui = mount(() => buttons('A'), () => ({ wrap: false }))
    must(ui.items()[0]).focus()
    // One item, clamped: the key is answered but nothing moves. It is still
    // claimed, because a toolbar arrow must not scroll the page.
    expect(type(ui, 'ArrowDown').defaultPrevented).toBe(true)
    expect(ui.active()).toBe('A')
  })

  it('claims nothing at all when the group is empty', () => {
    const ui = mount(() => [])
    expect(press(ui.host, 'ArrowDown').defaultPrevented).toBe(false)
  })

  it('a key the inner group ignores is not picked up by the outer one', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'Outer A'),
      withDirectives(
        h('div', { key: 'inner', class: 'inner' }, buttons('Inner A', 'Inner B')),
        [[vKeyboardNavigation, { orientation: 'block' as const }]],
      ),
      h('button', { key: 'z' }, 'Outer Z'),
    ])
    const innerFirst = must(ui.host.querySelector<HTMLElement>('.inner button'))
    innerFirst.focus()

    // The inner group is vertical, so it does not claim ArrowRight. The outer
    // group binds both axes — and must still keep its hands off, or focus
    // would jump out of the menu the user is inside.
    const event = press(innerFirst, 'ArrowRight')
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(innerFirst)
    expect(ui.active()).toBe('Outer A')
  })

  it('gives a nested group its own keys', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'Outer A'),
      withDirectives(h('div', { key: 'inner', class: 'inner' }, buttons('Inner A', 'Inner B')), [
        [vKeyboardNavigation],
      ]),
      h('button', { key: 'z' }, 'Outer Z'),
    ])
    const inner = must(ui.host.querySelector<HTMLElement>('.inner'))
    // Two groups, two tab stops — one each, never one shared or three.
    expect(ui.host.querySelectorAll('[tabindex="0"]').length).toBe(2)

    // The outer group steps over the inner group's controls entirely.
    const outerFirst = must(ui.host.querySelector<HTMLElement>('button'))
    outerFirst.focus()
    press(outerFirst, 'ArrowDown')
    expect(label(must(document.activeElement))).toBe('Outer Z')

    // And the inner group answers its own keys without the outer joining in.
    const innerFirst = must(inner.querySelector<HTMLElement>('button'))
    innerFirst.focus()
    press(innerFirst, 'ArrowDown')
    expect(label(must(document.activeElement))).toBe('Inner B')
  })
})

// ---------------------------------------------------------------------------
// aria-activedescendant mode
// ---------------------------------------------------------------------------
describe('activedescendant mode', () => {
  it('keeps focus on the host and points at the item', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ activedescendant: true }))
    expect(ui.host.getAttribute('tabindex')).toBe('0')
    expect(ui.items().every((el) => el.getAttribute('tabindex') === '-1')).toBe(true)

    ui.host.focus()
    press(ui.host, 'ArrowDown')
    expect(document.activeElement).toBe(ui.host)
    expect(ui.active()).toBe('B')
    const pointed = must(ui.host.getAttribute('aria-activedescendant'))
    expect(must(document.getElementById(pointed))).toBe(ui.items()[1])
  })

  it('still scrolls — in this mode the browser scrolls nothing at all', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ activedescendant: true }))
    ui.host.focus()
    calls.length = 0
    press(ui.host, 'ArrowDown')
    expect(calls.map((c) => c.kind)).toEqual(['scroll'])
    expect(calls[0]?.label).toBe('B')
  })

  it('keeps an id the application already gave the item', () => {
    const ui = mount(() => [
      h('button', { key: 'a', id: 'mine' }, 'A'),
      h('button', { key: 'b' }, 'B'),
    ], () => ({ activedescendant: true }))
    expect(ui.host.getAttribute('aria-activedescendant')).toBe('mine')
  })

  it('takes back the ids and the host tabindex on unmount', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ activedescendant: true }))
    const generated = must(ui.items()[0]).id
    expect(generated).not.toBe('')
    ui.unmount()
    expect(document.getElementById(generated)).toBe(null)
  })

  it('leaves a host tabindex the application set', () => {
    const ui = mount(() => buttons('A'), () => ({ activedescendant: true }), { tabindex: '-1' })
    expect(ui.host.getAttribute('tabindex')).toBe('-1')
  })
})

// ---------------------------------------------------------------------------
// Memory, pointers and focus state
// ---------------------------------------------------------------------------
describe('focus memory', () => {
  it('remembers the last item across Tab out and back in', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const ui = mount(() => buttons('A', 'B', 'C'))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown', 'ArrowDown')
    expect(ui.active()).toBe('C')

    outside.focus()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')
    expect(ui.tabbable().map(label)).toEqual(['C'])
  })

  it('reports a nomemory reset as a sync, not as a pointer move', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const seen: KeyboardNavigationEventDetail[] = []
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({
      memory: false,
      onNavigate: (d) => seen.push(d),
    }))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    seen.length = 0
    outside.focus()
    expect(seen.map((d) => d.reason)).toEqual(['sync'])
  })

  it('nomemory returns the tab stop to where it started', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ memory: false }))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown', 'ArrowDown')
    expect(ui.active()).toBe('C')

    outside.focus()
    expect(ui.tabbable().map(label)).toEqual(['A'])
  })

  it('adopts the row when focus lands on a control inside it', () => {
    const ui = mount(() => [
      h('div', { key: 'a', role: 'option' }, 'Row A'),
      h('div', { key: 'b', role: 'option' }, [
        'Row B ',
        h('button', { class: 'inner' }, 'edit'),
      ]),
    ], () => ({ items: '[role="option"]' }))
    const inner = must(ui.host.querySelector<HTMLElement>('.inner'))
    inner.focus()

    // The tab stop moves to the row the button lives in, so the next arrow key
    // continues from there instead of throwing focus out of the row.
    expect(ui.active()).toBe('Row B edit')
    expect(ui.tabbable().map(label)).toEqual(['Row B edit'])
  })

  it('adopts the item a pointer focused, without moving focus again', () => {
    const ui = mount(() => buttons('A', 'B', 'C'))
    calls.length = 0
    must(ui.items()[2]).focus()
    expect(ui.active()).toBe('C')
    // One focus call — ours, from the test. The directive did not re-focus.
    expect(calls.filter((c) => c.kind === 'focus').length).toBe(1)
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
describe('notifications', () => {
  it('reports every move once, through both channels, with the same detail', () => {
    const seen: KeyboardNavigationEventDetail[] = []
    const events: KeyboardNavigationEventDetail[] = []
    const ui = mount(() => buttons('A', 'B'), () => ({ onNavigate: (d) => seen.push(d) }))
    ui.host.addEventListener('keyboard-navigate', (event) => {
      if (event instanceof CustomEvent) events.push(event.detail)
    })

    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(seen.length).toBe(1)
    expect(events).toEqual(seen)
    expect(seen[0]).toMatchObject({ index: 1, previousIndex: 0, reason: 'key' })
    expect(seen[0]?.item).toBe(ui.items()[1])
    expect(seen[0]?.previousItem).toBe(ui.items()[0])
  })

  it('says nothing when a move lands where it already was', () => {
    const seen: KeyboardNavigationEventDetail[] = []
    const ui = mount(() => buttons('A', 'B'), () => ({ onNavigate: (d) => seen.push(d) }))
    must(ui.items()[0]).focus()
    seen.length = 0
    type(ui, 'Home')
    expect(seen).toEqual([])
  })

  it('names typeahead, pointer and plain focus moves as such', () => {
    const seen: KeyboardNavigationEventDetail[] = []
    const ui = mount(() => buttons('Apple', 'Banana'), () => ({ onNavigate: (d) => seen.push(d) }))
    must(ui.items()[0]).focus()
    seen.length = 0
    type(ui, 'b')
    expect(seen[0]?.reason).toBe('typeahead')

    // A bare `.focus()` is not a pointer, and used to be reported as one — so
    // `if (reason === 'pointer') track('click')` logged a click for every Tab.
    must(ui.items()[0]).focus()
    expect(seen[1]?.reason).toBe('focus')

    // With a real press inside the item first, it is.
    pointerDown(must(ui.items()[1]))
    must(ui.items()[1]).focus()
    expect(seen[2]?.reason).toBe('pointer')
  })
})

// ---------------------------------------------------------------------------
// The imperative api
// ---------------------------------------------------------------------------
describe('api', () => {
  it('fills the ref on mount and clears it on unmount', () => {
    const api = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B'), () => ({ ref: api }))
    expect(api.value?.items.length).toBe(2)
    expect(api.value?.activeIndex).toBe(0)
    expect(api.value?.activeItem).toBe(ui.items()[0])
    ui.unmount()
    expect(api.value).toBeUndefined()
  })

  it('drives the group and reports where it landed', () => {
    const api = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ ref: api }))
    const handle = must(api.value, 'api')

    handle.last()
    expect(document.activeElement).toBe(ui.items()[2])
    expect(handle.activeIndex).toBe(2)

    handle.first()
    expect(document.activeElement).toBe(ui.items()[0])

    handle.next()
    expect(handle.activeItem).toBe(ui.items()[1])

    handle.previous()
    expect(handle.activeIndex).toBe(0)

    handle.focus(2)
    expect(handle.activeIndex).toBe(2)
  })

  it('hands back the real elements, not reactive proxies of them', () => {
    const api = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B'), () => ({ ref: api }))
    expect(must(api.value).items[0]).toBe(ui.items()[0])
    expect(must(api.value).items[0] instanceof HTMLElement).toBe(true)
  })

  it('ignores an out-of-range index instead of throwing', () => {
    const api = ref<KeyboardNavigationApi>()
    mount(() => buttons('A', 'B'), () => ({ ref: api }))
    const handle = must(api.value, 'api')
    expect(() => handle.focus(9)).not.toThrow()
    expect(() => handle.focus(-1)).not.toThrow()
    expect(handle.activeIndex).toBe(0)
  })

  it('does not churn the api when nothing changed — the recursive-update trap', async () => {
    const api = ref<KeyboardNavigationApi>()
    const tick = ref(0)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({
      render: () => {
        // Read the reactive fields, exactly as a template showing them would.
        void api.value?.items.length
        void api.value?.activeIndex
        void tick.value
        return withDirectives(h('div', { class: 'host' }, buttons('A', 'B')), [
          // A fresh options object every render, which is what an inline
          // binding produces.
          [vKeyboardNavigation, { ref: api }],
        ])
      },
    })
    app.mount(root)

    const before = must(api.value).items
    tick.value++
    await settle()
    tick.value++
    await settle()
    // Same array identity across re-renders: an unconditional assignment here
    // re-triggers the render that read it, and Vue bails out with "Maximum
    // recursive updates exceeded" — which hangs the component.
    expect(must(api.value).items).toBe(before)
    app.unmount()
  })

  it('refresh() re-collects on demand', () => {
    const api = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A'), () => ({ ref: api }))
    const extra = document.createElement('button')
    extra.textContent = 'B'
    ui.host.appendChild(extra)
    // Synchronously, before the observer's microtask has run.
    must(api.value).refresh()
    expect(must(api.value).items.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// enabled, updates and teardown
// ---------------------------------------------------------------------------
describe('lifecycle', () => {
  it('enabled: false gives the DOM back and says so', async () => {
    const on = ref(true)
    const ui = mount(() => [
      h('button', { key: 'a', tabindex: '3' }, 'A'),
      h('button', { key: 'b' }, 'B'),
    ], () => ({ enabled: on.value }))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')

    on.value = false
    await settle()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('disabled')
    expect(must(ui.host.querySelector('button')).getAttribute('tabindex')).toBe('3')
    expect(press(must(ui.host.querySelector('button')), 'ArrowDown').defaultPrevented).toBe(false)

    on.value = true
    await settle()
    expect(ui.host.querySelectorAll('[tabindex="0"]').length).toBe(1)
  })

  it('takes an option change without a remount', async () => {
    const wrap = ref(false)
    const ui = mount(() => buttons('A', 'B'), () => ({ wrap: wrap.value }))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowUp')
    expect(ui.active()).toBe('A')

    wrap.value = true
    await settle()
    type(ui, 'ArrowUp')
    expect(ui.active()).toBe('B')
  })

  it('follows a role that changes at runtime', async () => {
    const role = ref('toolbar')
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({
      render: () =>
        withDirectives(h('div', { class: 'host', role: role.value }, buttons('A', 'B')), [
          [vKeyboardNavigation, undefined],
        ]),
    })
    app.mount(root)
    const host = must(root.querySelector<HTMLElement>('.host'))
    const first = must(host.querySelector<HTMLElement>('button'))
    first.focus()
    expect(press(first, 'ArrowDown').defaultPrevented).toBe(false)

    role.value = 'menu'
    await settle()
    expect(press(must(document.activeElement), 'ArrowDown').defaultPrevented).toBe(true)
    app.unmount()
  })

  it('leaves the DOM as it found it on unmount', () => {
    const ui = mount(() => [
      h('button', { key: 'a', tabindex: '5' }, 'A'),
      h('button', { key: 'b' }, 'B'),
    ])
    const [a, b] = [...ui.host.querySelectorAll('button')]
    expect(must(a).getAttribute('tabindex')).toBe('0')

    ui.unmount()
    expect(must(a).getAttribute('tabindex')).toBe('5')
    expect(must(b).hasAttribute('tabindex')).toBe(false)
    expect(must(a).hasAttribute('data-keyboard-navigation-item')).toBe(false)
  })

  it('stops observing and stops listening after unmount', async () => {
    const ui = mount(() => buttons('A', 'B'))
    const host = ui.host
    const detached = document.createElement('div')
    detached.appendChild(host)
    ui.unmount()

    const extra = document.createElement('button')
    extra.textContent = 'C'
    host.appendChild(extra)
    await settle()
    expect(extra.hasAttribute('tabindex')).toBe(false)
    expect(host.hasAttribute('data-keyboard-navigation-state')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PageUp / PageDown — a real page, which nobody else does
// ---------------------------------------------------------------------------
describe('paging', () => {
  it('moves by a fixed step when one is given', () => {
    const ui = mount(() => buttons('A', 'B', 'C', 'D', 'E', 'F'), () => ({ page: 5 }))
    must(ui.items()[0]).focus()
    type(ui, 'PageDown')
    expect(ui.active()).toBe('F')
    type(ui, 'PageUp')
    expect(ui.active()).toBe('A')
  })

  it('stops at the ends rather than wrapping a whole page', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ page: 2, wrap: true }))
    must(ui.items()[0]).focus()
    type(ui, 'PageUp')
    expect(ui.active()).toBe('A')
    type(ui, 'PageDown', 'PageDown')
    expect(ui.active()).toBe('C')
  })

  it('degrades to first / last where nothing scrolls — where the others start', () => {
    const ui = mount(() => buttons('A', 'B', 'C', 'D'))
    must(ui.items()[0]).focus()
    type(ui, 'PageDown')
    expect(ui.active()).toBe('D')
  })

  it('page: false leaves the keys to the browser', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ page: false }))
    must(ui.items()[0]).focus()
    expect(type(ui, 'PageDown').defaultPrevented).toBe(false)
    expect(ui.active()).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// Install path
// ---------------------------------------------------------------------------
describe('plugin', () => {
  it('registers the directive under the documented name', () => {
    expect(DIRECTIVE_NAME).toBe('keyboard-navigation')
    const app = createApp({ render: () => h('div') })
    app.use(KeyboardNavigationPlugin)
    expect(app.directive(DIRECTIVE_NAME)).toBe(vKeyboardNavigation)
  })
})

// ---------------------------------------------------------------------------
// pageStep, directly — the measurement jsdom cannot produce on its own.
// ---------------------------------------------------------------------------
describe('pageStep', () => {
  /** A real vertical list: the items tile down the block axis. */
  function list(count: number, height: number): HTMLElement[] {
    return Array.from({ length: count }, (_, i) => {
      const el = document.createElement('button')
      stubBox(el, { top: i * height, left: 0, width: 100, height })
      return el
    })
  }

  it('counts the items that fit the viewport', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    // 200px of viewport, 40px items: five fit.
    expect(pageStep(list(50, 40), 0, 1, viewport, 'block')).toBe(5)
    expect(pageStep(list(50, 40), 20, -1, viewport, 'block')).toBe(5)
  })

  it('follows the item height rather than a hard-coded number', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    expect(pageStep(list(50, 100), 0, 1, viewport, 'block')).toBe(2)
    expect(pageStep(list(50, 25), 0, 1, viewport, 'block')).toBe(8)
  })

  it('never returns a step of zero, however tall the item', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 30)
    expect(pageStep(list(10, 400), 0, 1, viewport, 'block')).toBe(1)
  })

  it('never returns a step of zero at the ends of the list', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    // Already on the last item: there is nothing to walk, and a step of 0
    // would claim the key while moving nothing.
    expect(pageStep(list(3, 40), 2, 1, viewport, 'block')).toBe(1)
    expect(pageStep(list(3, 40), 0, -1, viewport, 'block')).toBe(1)
  })

  it('treats an unmeasurable list as one page', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    expect(pageStep(list(7, 0), 0, 1, viewport, 'block')).toBe(7)
    expect(pageStep(list(7, 40), 0, 1, null, 'block')).toBe(7)
  })

  it('stops at the end of the list', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 1000)
    expect(pageStep(list(3, 40), 0, 1, viewport, 'block')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Which box scrolls
//
// The defect these exist for: `container: '.pane'` resolved with
// `document.querySelector`, so it found the FIRST `.pane` on the page rather
// than this group's. Two instances of one component and arrowing in the second
// scrolled the first. Every test in the suite above mounts exactly one host,
// which is why 99 green tests could not see it.
// ---------------------------------------------------------------------------
describe('container resolution is scoped to the group', () => {
  /** A host inside its own `.pane`, both with stated geometry. */
  function pane(binding: () => KeyboardNavigationBinding | undefined) {
    const box = document.createElement('div')
    box.className = 'pane'
    document.body.appendChild(box)
    stubBox(box, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(box, 'clientHeight', 100)

    const root = document.createElement('div')
    box.appendChild(root)
    const app = createApp({
      render: () =>
        withDirectives(h('div', { class: 'host' }, buttons('A', 'B', 'C')), [
          [vKeyboardNavigation, binding()],
        ]),
    })
    app.mount(root)
    const host = must(box.querySelector<HTMLElement>('.host'))
    const items = [...host.querySelectorAll<HTMLElement>('button')]
    items.forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))
    return { box, host, items, app }
  }

  it('two instances each scroll their own pane, not the first one on the page', () => {
    const options = () => ({ scroll: { container: '.pane' } })
    const one = pane(options)
    const two = pane(options)

    must(two.items[0]).focus()
    calls.length = 0
    press(two.items[0], 'ArrowDown')

    const scrolls = calls.filter((c) => c.kind === 'scrollTo')
    expect(scrolls.length).toBe(1)
    expect(scrolls[0]?.el).toBe(two.box)
    expect(scrolls[0]?.el).not.toBe(one.box)
    one.app.unmount()
    two.app.unmount()
  })

  it('a bare selector never resolves outside the group', () => {
    // A decoy that a document-wide query would find first — and one that is
    // scrollable enough for the old code to have written a scrollTop onto.
    const decoy = document.createElement('div')
    decoy.className = 'scroller'
    document.body.appendChild(decoy)
    stubBox(decoy, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(decoy, 'clientHeight', 100)

    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: '.scroller' } }))
    ui.items().forEach((el, i) => stubBox(el, { top: i * 400, left: 0, width: 200, height: 40 }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    // Nothing named `.scroller` is inside or above this host, so the option
    // resolves to null and the scroll is a silent no-op — never the decoy.
    expect(calls.filter((c) => c.kind === 'scrollTo')).toEqual([])
  })

  it("':scope <sel>' means a DESCENDANT, the way it does in CSS", () => {
    const ui = mount(() => [
      h('div', { key: 'inner', class: 'inner-pane' }, buttons('A', 'B')),
    ], () => ({ scroll: { container: ':scope .inner-pane' } }))

    const inner = must(ui.host.querySelector<HTMLElement>('.inner-pane'))
    stubBox(inner, { top: 0, left: 0, width: 200, height: 50 })
    stubMetric(inner, 'clientHeight', 50)
    const items = ui.items()
    items.forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))

    must(items[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    const scrolls = calls.filter((c) => c.kind === 'scrollTo')
    expect(scrolls[0]?.el).toBe(inner)
  })

  it("':scope <sel>' no longer walks out to an ANCESTOR, which is what closest() did", () => {
    const outer = document.createElement('div')
    outer.className = 'outer-pane'
    document.body.appendChild(outer)
    const root = document.createElement('div')
    outer.appendChild(root)
    const app = createApp({
      render: () =>
        withDirectives(h('div', { class: 'host' }, buttons('A', 'B')), [
          [vKeyboardNavigation, { scroll: { container: ':scope .outer-pane' } }],
        ]),
    })
    app.mount(root)
    const host = must(outer.querySelector<HTMLElement>('.host'))
    const items = [...host.querySelectorAll<HTMLElement>('button')]
    items.forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))

    must(items[0]).focus()
    calls.length = 0
    press(items[0], 'ArrowDown')
    expect(calls.filter((c) => c.kind === 'scrollTo')).toEqual([])
    app.unmount()
  })

  it('a bare selector still finds the pane the list sits in', () => {
    // An earlier, unrelated `.wrapper`: a document-wide query would take this
    // one and the list would never follow its own focus ring.
    const decoy = document.createElement('div')
    decoy.className = 'wrapper'
    document.body.appendChild(decoy)
    stubBox(decoy, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(decoy, 'clientHeight', 100)

    const box = document.createElement('div')
    box.className = 'wrapper'
    document.body.appendChild(box)
    stubBox(box, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(box, 'clientHeight', 100)
    const root = document.createElement('div')
    box.appendChild(root)
    const app = createApp({
      render: () =>
        withDirectives(h('div', { class: 'host' }, buttons('A', 'B')), [
          [vKeyboardNavigation, { scroll: { container: '.wrapper' } }],
        ]),
    })
    app.mount(root)
    const host = must(box.querySelector<HTMLElement>('.host'))
    const items = [...host.querySelectorAll<HTMLElement>('button')]
    items.forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))

    must(items[0]).focus()
    calls.length = 0
    press(items[0], 'ArrowDown')
    const scrolled = calls.filter((c) => c.kind === 'scrollTo')[0]
    expect(scrolled?.el).toBe(box)
    expect(scrolled?.el).not.toBe(decoy)
    app.unmount()
  })

  it('a bare selector finds a pane INSIDE the host when nothing above matches', () => {
    // The third branch of the bare form. Nothing named `.inner` is the host or
    // above it, so the descendant is the answer — dropping that fallback is a
    // silent no-op, which is the failure mode this whole block exists for.
    const ui = mount(
      () => [h('div', { key: 'inner', class: 'inner' }, buttons('A', 'B'))],
      () => ({ scroll: { container: '.inner' } }),
    )
    const inner = must(ui.host.querySelector<HTMLElement>('.inner'))
    stubBox(inner, { top: 0, left: 0, width: 200, height: 50 })
    stubMetric(inner, 'clientHeight', 50)
    ui.items().forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))

    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    expect(calls.filter((c) => c.kind === 'scrollTo')[0]?.el).toBe(inner)
  })

  it('an element handed over directly is the element that scrolls', () => {
    const box = document.createElement('div')
    document.body.appendChild(box)
    stubBox(box, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(box, 'clientHeight', 100)

    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: box } }))
    ui.items().forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    expect(calls.filter((c) => c.kind === 'scrollTo')[0]?.el).toBe(box)
  })

  it('a container that has left the document is not scrolled', () => {
    // A pane that was torn down between renders. Writing a scrollTop onto a
    // detached element moves nothing and hides the fact that the option is now
    // pointing at rubbish.
    const gone = document.createElement('div')
    stubBox(gone, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(gone, 'clientHeight', 100)

    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { container: () => gone } }))
    ui.items().forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    // No scroll at all — and specifically not a fall-through to the native
    // call, which would scroll the wrong thing rather than nothing.
    expect(calls.filter((c) => c.kind === 'scrollTo')).toEqual([])
    expect(calls.filter((c) => c.kind === 'scroll')).toEqual([])
  })

  it("block: 'start' leaves the offset as a gap above the item", () => {
    const box = document.createElement('div')
    document.body.appendChild(box)
    stubBox(box, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(box, 'clientHeight', 100)

    const ui = mount(
      () => buttons('A', 'B'),
      () => ({ scroll: { container: box, block: 'start', offset: { top: 24 } } }),
    )
    ui.items().forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    // Item B's top is 200 relative to the box; a 24px sticky header means the
    // scroll stops 24px short of it.
    expect(calls.filter((c) => c.kind === 'scrollTo')[0]?.arg).toMatchObject({ top: 176 })
  })

  it('the getter form is how you name an element outside the group, out loud', () => {
    const far = document.createElement('div')
    far.className = 'far-away'
    document.body.appendChild(far)
    stubBox(far, { top: 0, left: 0, width: 200, height: 100 })
    stubMetric(far, 'clientHeight', 100)

    const ui = mount(
      () => buttons('A', 'B'),
      () => ({ scroll: { container: () => far } }),
    )
    ui.items().forEach((el, i) => stubBox(el, { top: i * 200, left: 0, width: 200, height: 40 }))
    must(ui.items()[0]).focus()
    calls.length = 0
    type(ui, 'ArrowDown')
    expect(calls.filter((c) => c.kind === 'scrollTo')[0]?.el).toBe(far)
  })

  it('a page is measured against the same box the scroll uses', () => {
    // `pageViewport` used to resolve the container from the *item*, so the two
    // could disagree about which element the page is.
    // Same shape as the scroll defect: an earlier `.paged` that a
    // document-wide query would measure the page against instead.
    const decoy = document.createElement('div')
    decoy.className = 'paged'
    document.body.appendChild(decoy)
    stubMetric(decoy, 'clientHeight', 0)

    const box = document.createElement('div')
    box.className = 'paged'
    document.body.appendChild(box)
    stubMetric(box, 'clientHeight', 100)
    stubBox(box, { top: 0, left: 0, width: 200, height: 100 })
    const root = document.createElement('div')
    box.appendChild(root)
    const app = createApp({
      render: () =>
        withDirectives(h('div', { class: 'host' }, buttons('A', 'B', 'C', 'D', 'E', 'F')), [
          [vKeyboardNavigation, { scroll: { container: '.paged' } }],
        ]),
    })
    app.mount(root)
    const host = must(box.querySelector<HTMLElement>('.host'))
    const items = [...host.querySelectorAll<HTMLElement>('button')]
    items.forEach((el, i) => stubBox(el, { top: i * 50, left: 0, width: 200, height: 50 }))
    must(items[0]).focus()
    press(items[0], 'PageDown')
    // 100px of viewport, 50px items: two fit, so PageDown lands on C.
    expect(label(must(host.querySelector('[data-keyboard-navigation-item="active"]')))).toBe('C')
    app.unmount()
  })
})

// ---------------------------------------------------------------------------
// enabled: false really means idle
//
// `onKeydown` checked the flag; `onFocusin` and `onFocusout` did not. One
// click inside a switched-off group wrote state `active`, and clicking away
// wrote `empty` — the value documented as "no focusable items, the group has
// left the keyboard" — permanently, on a group that is merely off.
// ---------------------------------------------------------------------------
describe('enabled: false', () => {
  it('ignores focus and blur as well as keys, and keeps saying disabled', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ enabled: false }))
    const first = must(ui.host.querySelector<HTMLElement>('button'))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('disabled')

    // release() handed every tabindex back, so the buttons are natively
    // focusable again and a click really does fire focusin here.
    pointerDown(first)
    first.focus()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('disabled')

    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('disabled')
  })

  it('comes back to life when it is switched on again', async () => {
    const enabled = ref(false)
    const ui = mount(() => buttons('A', 'B'), () => ({ enabled: enabled.value }))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('disabled')
    enabled.value = true
    await settle()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')
    expect(ui.tabbable().length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The focus rescue, and the two things that are not a stranding
// ---------------------------------------------------------------------------
describe('focus rescue only fires for a real stranding', () => {
  it('does not yank focus back when the user has left the document', async () => {
    const rows = ref(['A', 'B', 'C'])
    const ui = mount(() => rows.value.map((r) => h('button', { key: r }, r)))
    const second = must(ui.items()[1])
    second.focus()

    // The user tabbed into the browser chrome: relatedTarget is null, exactly
    // as it is for a removal, but the document no longer holds focus.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    second.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    realFocus.call(document.body)

    rows.value = ['A', 'C']
    await settle()
    expect(document.activeElement).toBe(document.body)
    hasFocus.mockRestore()
  })

  it('does not yank focus back when the list refreshes a task later', async () => {
    const rows = ref(['A', 'B', 'C'])
    const ui = mount(() => rows.value.map((r) => h('button', { key: r }, r)))
    const second = must(ui.items()[1])
    second.focus()
    second.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    realFocus.call(document.body)

    // A removal blurs and mutates in the same task. An async refresh does not.
    await nextTask()
    rows.value = ['A', 'C']
    await settle()
    expect(document.activeElement).toBe(document.body)
  })

  it('still rescues the same-task removal it exists for', async () => {
    const rows = ref(['A', 'B', 'C'])
    const ui = mount(() => rows.value.map((r) => h('button', { key: r }, r)))
    const second = must(ui.items()[1])
    second.focus()
    second.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    realFocus.call(document.body)
    rows.value = ['A', 'C']
    await settle()
    expect(label(must(document.activeElement))).toBe('C')
  })
})

// ---------------------------------------------------------------------------
// Nesting — the invariant across a group boundary
//
// `el.closest(HOST_SELECTOR) !== host` skipped any descendant whose nearest
// host was not this host. An element that IS a host is its own nearest host,
// so a nested group's host was dropped from its parent's items — and kept its
// natural tabbability, which is the two-tab-stop failure the package exists to
// prevent, caused by the package. Nothing in the suite counted tab stops
// across a nesting boundary, which is why 99 green tests could not see it.
// ---------------------------------------------------------------------------

/**
 * What the Tab key would actually visit: an explicit `tabindex="0"`, or a
 * natively focusable control with no `tabindex` at all. Counting only
 * `[tabindex="0"]` misses exactly the failure here — an element nobody
 * manages, tabbable because the platform made it so.
 */
function tabStops(root: HTMLElement): string[] {
  const candidates = root.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]',
  )
  return [...candidates]
    .filter((el) => {
      const attr = el.getAttribute('tabindex')
      if (attr !== null) return attr === '0'
      return !el.hasAttribute('disabled')
    })
    .map(label)
}

/** The active item of ONE group — `ui.active()` cannot tell two groups apart. */
function activeIn(host: HTMLElement): string {
  const marked = [...host.querySelectorAll<HTMLElement>('[data-keyboard-navigation-item="active"]')]
  const own = marked.find((el) => el.parentElement?.closest('[data-keyboard-navigation-state]') === host)
  return label(must(own, 'active item of this host'))
}

describe('nested groups', () => {
  /** A menubar whose middle item is itself a group host. */
  function menubar(): { ui: Mounted; inner: HTMLElement } {
    const ui = mount(
      () => [
        h('button', { key: 'file', role: 'menuitem' }, 'File'),
        withDirectives(
          h('button', { key: 'edit', role: 'menuitem', class: 'edit' }, [
            'Edit',
            h('span', { key: 'inner', role: 'menuitem', tabindex: '-1' }, 'Undo'),
          ]),
          [[vKeyboardNavigation, { role: 'menu' } as KeyboardNavigationBinding]],
        ),
        h('button', { key: 'view', role: 'menuitem' }, 'View'),
      ],
      () => ({ role: 'menubar' }),
      { role: 'menubar' },
    )
    return { ui, inner: must(ui.host.querySelector<HTMLElement>('.edit')) }
  }

  /** The outer group's own items, ignoring the inner group's. */
  function outerLabels(ui: Mounted): string[] {
    return [...ui.host.querySelectorAll<HTMLElement>(ITEM)]
      .filter((el) => el.parentElement?.closest('[data-keyboard-navigation-state]') === ui.host)
      .map(label)
  }

  it('keeps a nested host as its parent\u2019s item instead of dropping it', () => {
    const { ui } = menubar()
    expect(outerLabels(ui)).toEqual(['File', 'EditUndo', 'View'])
  })

  it('leaves no tab stop that no group manages', () => {
    const { ui } = menubar()
    // Two groups, two tab stops — a nested group is deliberately its own. What
    // must not be here is a third: the outer roving `0` on `File` while
    // `Edit`, dropped from the item list, stayed natively tabbable beside it.
    expect(tabStops(ui.host)).toEqual(['File', 'Undo'])
  })

  it('walks past the nested host with the parent\u2019s own arrows', () => {
    const { ui } = menubar()
    must(ui.items()[0]).focus()
    press(document.activeElement, 'ArrowRight')
    expect(activeIn(ui.host)).toBe('EditUndo')
    press(document.activeElement, 'ArrowRight')
    expect(activeIn(ui.host)).toBe('View')
  })

  it('lets the inner group claim a key first, and the outer one keeps its hands off', () => {
    const { ui, inner } = menubar()
    inner.focus()
    // The menu inside is vertical: ArrowDown belongs to it, and the menubar —
    // horizontal — must not also act on it.
    const down = press(inner, 'ArrowDown')
    expect(down.defaultPrevented).toBe(true)
    expect(label(must(document.activeElement))).toBe('Undo')
    expect(activeIn(ui.host)).toBe('EditUndo')
  })
})

describe('a nested blur is not the parent\u2019s blur', () => {
  it('does not run the outer focusout path when focus leaves an inner group', () => {
    const seen: KeyboardNavigationEventDetail[] = []
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('div', { key: 'nested' }, [
          withDirectives(h('div', { key: 'inner', class: 'inner' }, buttons('X', 'Y')), [
            [vKeyboardNavigation, undefined],
          ]),
        ]),
        h('button', { key: 'b' }, 'B'),
      ],
      () => ({ memory: false, onNavigate: (d: KeyboardNavigationEventDetail) => seen.push(d) }),
    )
    const outerB = must(ui.host.querySelector<HTMLElement>(':scope > button:last-of-type'))
    outerB.focus()
    seen.length = 0

    const innerItem = must(ui.host.querySelector<HTMLElement>('.inner button'))
    innerItem.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))

    // The outer group is `nomemory`, so before the fix this blur reset its tab
    // stop to the first item and emitted a `sync` move nobody caused.
    expect(seen).toEqual([])
    expect(activeIn(ui.host)).toBe('B')
  })
})

// ---------------------------------------------------------------------------
// The observer must not hear its own writes
// ---------------------------------------------------------------------------
describe('the offset no longer wakes the group’s own observer', () => {
  it('produces no observer work across three keystrokes', async () => {
    const ui = mount(
      () => buttons('A', 'B', 'C', 'D'),
      () => ({ scroll: { offset: { top: 24 } } }),
    )
    let wakeups = 0
    const spy = new MutationObserver(() => (wakeups += 1))
    spy.observe(ui.host, {
      childList: true,
      subtree: true,
      attributes: true,
      // The group's own filter, minus the tabindex it legitimately writes.
      attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'aria-hidden', 'inert', 'style'],
    })
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown', 'ArrowDown', 'ArrowDown')
    await settle()
    expect(wakeups).toBe(0)
    spy.disconnect()
  })

  it('leaves the DOM as it found it on unmount, offset included', () => {
    const ui = mount(
      () => buttons('A', 'B'),
      () => ({ scroll: { offset: { top: 24, left: 8 } } }),
    )
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    const items = ui.items()
    ui.unmount()
    for (const item of items) {
      expect(item.hasAttribute('style')).toBe(false)
      expect(item.hasAttribute('tabindex')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Paging knows which way the group runs
//
// `pageStep` only ever read `clientHeight` and item `height`. On a horizontal
// strip every item's height is the strip height, so the second item already
// overflowed the "page" and the step collapsed to 1 — PageDown was
// ArrowRight, which is worse than the first/last mapping this beats.
// ---------------------------------------------------------------------------
describe('paging follows the axis', () => {
  function strip(count: number, width: number): HTMLElement[] {
    return Array.from({ length: count }, (_, i) => {
      const el = document.createElement('button')
      // A horizontal strip: the items tile along the inline axis and every
      // one of them spans the whole 34px of the block axis.
      stubBox(el, { top: 0, left: i * width, width, height: 34 })
      return el
    })
  }

  it('counts widths on the inline axis, not heights', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientWidth', 300)
    stubMetric(viewport, 'clientHeight', 34)
    // 300px of strip, 40px items: seven fit.
    expect(pageStep(strip(30, 40), 0, 1, viewport, 'inline')).toBe(7)
    // The same strip read on the block axis is one item tall however many
    // items it holds — they all cover the same 34px band — so the page runs
    // to the end of the list instead of collapsing to a single item, which is
    // ArrowRight by another name. (29, not 30: the walk starts at the item
    // *after* the active one, exactly as 'stops at the end of the list' says.)
    expect(pageStep(strip(30, 40), 0, 1, viewport, 'block')).toBe(29)
  })

  it('pages down the block axis when both axes are bound', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientWidth', 300)
    stubMetric(viewport, 'clientHeight', 100)
    const items = Array.from({ length: 20 }, (_, i) => {
      const el = document.createElement('button')
      stubBox(el, { top: i * 25, left: 0, width: 40, height: 25 })
      return el
    })
    expect(pageStep(items, 0, 1, viewport, 'both')).toBe(4)
  })

  it('moves a real page along a horizontal toolbar', () => {
    const ui = mount(
      () => buttons('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'),
      () => ({ role: 'toolbar', scroll: { container: '.host' } }),
    )
    stubMetric(ui.host, 'clientWidth', 120)
    stubMetric(ui.host, 'clientHeight', 34)
    stubBox(ui.host, { top: 0, left: 0, width: 120, height: 34 })
    ui.items().forEach((el, i) => stubBox(el, { top: 0, left: i * 40, width: 40, height: 34 }))

    must(ui.items()[0]).focus()
    type(ui, 'PageDown')
    // 120px of strip, 40px items: three fit, so the page lands on D.
    expect(ui.active()).toBe('D')
  })

  it('does not accept a sideways scroller as the vertical page viewport', () => {
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.style.overflowX = 'auto'
    box.style.overflowY = 'hidden'
    Object.defineProperty(box, 'scrollWidth', { value: 900, configurable: true })
    stubMetric(box, 'clientWidth', 300)
    Object.defineProperty(box, 'scrollHeight', { value: 34, configurable: true })
    stubMetric(box, 'clientHeight', 34)
    const inner = document.createElement('button')
    box.appendChild(inner)

    expect(scrollParent(inner, 'inline')).toBe(box)
    expect(scrollParent(inner, 'block')).toBe(null)
  })

  it('does not accept an upright scroller as the horizontal page viewport', () => {
    // The mirror of the case above, and the one that catches an axis test
    // widened to "either axis will do": both assertions have to be one-way.
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.style.overflowX = 'hidden'
    box.style.overflowY = 'auto'
    Object.defineProperty(box, 'scrollWidth', { value: 300, configurable: true })
    stubMetric(box, 'clientWidth', 300)
    Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true })
    stubMetric(box, 'clientHeight', 200)
    const inner = document.createElement('button')
    box.appendChild(inner)

    expect(scrollParent(inner, 'block')).toBe(box)
    expect(scrollParent(inner, 'inline')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// The keyboard dead end
//
// `FOCUSABLE_SELECTOR` contained bare `input`, so `<input type="text">` became
// an item and took the roving `0` — and `keys.ts` correctly refuses to
// navigate off a text field, so the arrows could enter it and never leave. The
// group is one tab stop, so Tab left entirely: the rest of the toolbar was
// unreachable without Shift+Tab and re-entering.
// ---------------------------------------------------------------------------
describe('controls that own their own keys', () => {
  function toolbarWithFilter(): Mounted {
    return mount(
      () => [
        h('button', { key: 'a' }, 'Bold'),
        h('input', { key: 'i', type: 'text', 'aria-label': 'Filter' }),
        h('button', { key: 'b' }, 'Quote'),
      ],
      () => ({ role: 'toolbar' }),
    )
  }

  it('is not an arrow stop', () => {
    const ui = toolbarWithFilter()
    expect(ui.labels()).toEqual(['Bold', 'Quote'])
    expect(ui.skippedLabels()).toEqual([])
  })

  it('keeps its own place in the tab order rather than vanishing', () => {
    const ui = toolbarWithFilter()
    const input = must(ui.host.querySelector<HTMLElement>('input'))
    // Untouched: no roving `-1`, no `data-*` hook, nothing.
    expect(input.hasAttribute('tabindex')).toBe(false)
    expect(input.hasAttribute('data-keyboard-navigation-item')).toBe(false)
    expect(tabStops(ui.host)).toEqual(['Bold', 'Filter'])
  })

  it('the arrows step over it instead of trapping focus in it', () => {
    const ui = toolbarWithFilter()
    must(ui.items()[0]).focus()
    type(ui, 'ArrowRight')
    expect(ui.active()).toBe('Quote')
    expect(label(must(document.activeElement))).toBe('Quote')
  })

  it('a select and a contenteditable are treated the same way', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('select', { key: 's', 'aria-label': 'Pick' }, [h('option', 'One')]),
      h('div', { key: 'c', contenteditable: 'true' }, 'Edit me'),
      h('button', { key: 'b' }, 'B'),
    ])
    expect(ui.labels()).toEqual(['A', 'B'])
  })

  it('checkboxes, radios and buttons are still items — they own no arrows', () => {
    const ui = mount(() => [
      h('input', { key: 'c', type: 'checkbox', 'aria-label': 'Check' }),
      h('input', { key: 'b', type: 'button', value: 'Press' }),
      h('input', { key: 'f', type: 'file', 'aria-label': 'Pick a file' }),
    ])
    expect(ui.items().length).toBe(3)
  })

  it('an explicit item selector cannot reintroduce the dead end', () => {
    const ui = mount(() => [
      h('button', { key: 'a', class: 'it' }, 'A'),
      h('input', { key: 'i', type: 'text', class: 'it', 'aria-label': 'Filter' }),
      h('button', { key: 'b', class: 'it' }, 'B'),
    ], () => ({ items: '.it' }))
    expect(ui.labels()).toEqual(['A', 'B'])
  })
})

// ---------------------------------------------------------------------------
// KB-3 — skipping is a choice, and it is not the same thing as disabled
// ---------------------------------------------------------------------------
describe('opting out with focusgroup="none"', () => {
  it('takes an element out of the arrows and leaves everything else alone', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'h', focusgroup: 'none' }, 'Load more'),
      h('button', { key: 'b' }, 'B'),
    ])
    expect(ui.labels()).toEqual(['A', 'B'])
    const optedOut = must(ui.host.querySelector<HTMLElement>('[focusgroup="none"]'))
    expect(optedOut.hasAttribute('tabindex')).toBe(false)
    expect(optedOut.hasAttribute('data-keyboard-navigation-item')).toBe(false)
  })

  it('is still reachable by Tab — an opted-out control is not a hidden one', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'h', focusgroup: 'none' }, 'Load more'),
      h('button', { key: 'b' }, 'B'),
    ])
    expect(tabStops(ui.host)).toEqual(['A', 'Load more'])
  })

  it('the arrows step straight over it', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'h', focusgroup: 'none' }, 'Load more'),
      h('button', { key: 'b' }, 'B'),
    ])
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('B')
  })

  it('takes effect the moment the attribute lands, with no remount', async () => {
    const out = ref(false)
    const ui = mount(() => [
      h('button', { key: 'a' }, 'A'),
      h('button', { key: 'm', focusgroup: out.value ? 'none' : undefined }, 'M'),
      h('button', { key: 'b' }, 'B'),
    ])
    expect(ui.labels()).toEqual(['A', 'M', 'B'])
    out.value = true
    await settle()
    expect(ui.labels()).toEqual(['A', 'B'])
    // And it gets its own tabindex back rather than keeping our `-1`.
    expect(must(ui.host.querySelectorAll('button')[1]).hasAttribute('tabindex')).toBe(false)
  })

  it('exports the selector it matches, so a consumer need not retype it', () => {
    expect(OPT_OUT_SELECTOR).toBe('[focusgroup="none"]')
  })

  it('typeahead agrees with the arrows about what is not there', () => {
    const ui = mount(() => [
      h('button', { key: 'a' }, 'Apple'),
      h('button', { key: 'r', focusgroup: 'none' }, 'Apricot'),
      h('button', { key: 'v' }, 'Avocado'),
    ])
    must(ui.items()[0]).focus()
    type(ui, 'a')
    // Apricot is out of the group, so `a` cycles Apple → Avocado.
    expect(ui.active()).toBe('Avocado')
  })
})

describe('skipDisabled, per role', () => {
  const withDisabledMiddle = (binding: () => KeyboardNavigationBinding | undefined) =>
    mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
        h('button', { key: 'c' }, 'C'),
      ],
      binding,
    )

  it('a menu keeps its unavailable options reachable', () => {
    const ui = withDisabledMiddle(() => 'menu')
    expect(ui.labels()).toEqual(['A', 'B', 'C'])
    expect(ui.skippedLabels()).toEqual([])
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('B')
  })

  it('a menubar does the same', () => {
    expect(withDisabledMiddle(() => 'menubar').labels()).toEqual(['A', 'B', 'C'])
  })

  it('a toolbar, a tablist, a listbox and a radiogroup step over them', () => {
    for (const role of ['toolbar', 'tablist', 'listbox', 'radiogroup'] as const) {
      const ui = withDisabledMiddle(() => role)
      expect(ui.labels(), role).toEqual(['A', 'C'])
      expect(ui.skippedLabels(), role).toEqual(['B'])
      ui.unmount()
    }
  })

  it('so does a group with no role at all', () => {
    expect(withDisabledMiddle(() => undefined).labels()).toEqual(['A', 'C'])
  })

  it('the option beats the role default, in both directions', () => {
    const kept = withDisabledMiddle(() => ({ role: 'toolbar', skipDisabled: false }))
    expect(kept.labels()).toEqual(['A', 'B', 'C'])
    kept.unmount()

    const stepped = withDisabledMiddle(() => ({ role: 'menu', skipDisabled: true }))
    expect(stepped.labels()).toEqual(['A', 'C'])
    expect(stepped.skippedLabels()).toEqual(['B'])
  })

  it('changes at runtime without a remount', async () => {
    const skip = ref(false)
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
        h('button', { key: 'c' }, 'C'),
      ],
      () => ({ role: 'menu', skipDisabled: skip.value }),
    )
    expect(ui.labels()).toEqual(['A', 'B', 'C'])
    skip.value = true
    await settle()
    expect(ui.labels()).toEqual(['A', 'C'])
  })

  it('a natively disabled control is never navigable, whatever skipDisabled says', () => {
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', disabled: true }, 'B'),
        h('button', { key: 'c' }, 'C'),
      ],
      () => ({ role: 'menu', skipDisabled: false }),
    )
    // The platform will not focus it, so no library can offer to stop there —
    // which is exactly why the APG suggests `aria-disabled` instead.
    expect(ui.labels()).toEqual(['A', 'C'])
    expect(ui.skippedLabels()).toEqual([])
    expect(must(ui.host.querySelectorAll('button')[1]).hasAttribute('tabindex')).toBe(false)
  })

  it('a skipped item is held at -1 so it cannot become a second tab stop', () => {
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
      ],
      () => 'toolbar',
    )
    expect(must(ui.skipped()[0]).getAttribute('tabindex')).toBe('-1')
    expect(tabStops(ui.host)).toEqual(['A'])
  })

  it('typeahead skips what the arrows skip', () => {
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'Apple'),
        h('button', { key: 'r', 'aria-disabled': 'true' }, 'Apricot'),
        h('button', { key: 'v' }, 'Avocado'),
      ],
      () => 'toolbar',
    )
    must(ui.items()[0]).focus()
    type(ui, 'a')
    expect(ui.active()).toBe('Avocado')
  })

  it('publishes the skipped set on the api', () => {
    const nav = ref<KeyboardNavigationApi>()
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
      ],
      () => ({ role: 'toolbar', ref: nav }),
    )
    expect(nav.value?.items.map(label)).toEqual(['A'])
    expect(nav.value?.skipped.map(label)).toEqual(['B'])
    ui.unmount()
  })

  it('hands a skipped item back the moment it stops being skipped', async () => {
    const off = ref(true)
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': off.value ? 'true' : undefined }, 'B'),
      ],
      () => 'toolbar',
    )
    expect(must(ui.host.querySelectorAll('button')[1]).getAttribute('tabindex')).toBe('-1')
    off.value = false
    await settle()
    expect(ui.labels()).toEqual(['A', 'B'])
    expect(tabStops(ui.host)).toEqual(['A'])
  })

  it('gives every skipped item its own tabindex back on unmount', () => {
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
      ],
      () => 'toolbar',
    )
    const skippedItem = must(ui.skipped()[0])
    ui.unmount()
    expect(skippedItem.hasAttribute('tabindex')).toBe(false)
    expect(skippedItem.hasAttribute('data-keyboard-navigation-item')).toBe(false)
  })

  it('aria-disabled="false" is a live control, not a disabled one', () => {
    // The attribute is tri-state in practice: absent, "false", "true". Reading
    // presence rather than value would take an explicitly-enabled control out
    // of the arrows, which is the opposite of what the author asked for.
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'false' }, 'B'),
        h('button', { key: 'c', 'aria-disabled': 'true' }, 'C'),
      ],
      () => 'toolbar',
    )
    expect(ui.labels()).toEqual(['A', 'B'])
    expect(ui.skippedLabels()).toEqual(['C'])
  })

  it('a skipped element that leaves the group entirely gets its own tabindex back', async () => {
    // It went from `skipped` to *not ours* rather than to `items`, so the
    // "hand back what departed" pass has to walk the skipped pile too —
    // otherwise our `-1` outlives the group's interest in the element.
    const out = ref(false)
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', {
          key: 'b',
          'aria-disabled': 'true',
          focusgroup: out.value ? 'none' : undefined,
        }, 'B'),
      ],
      () => 'toolbar',
    )
    const second = must(ui.host.querySelectorAll<HTMLElement>('button')[1])
    expect(second.getAttribute('tabindex')).toBe('-1')
    out.value = true
    await settle()
    expect(second.hasAttribute('tabindex')).toBe(false)
    expect(second.hasAttribute('data-keyboard-navigation-item')).toBe(false)
  })

  it('notices focusgroup="none" arriving from outside Vue', async () => {
    // The observer's attribute filter is the only thing that hears a DOM
    // change Vue did not make — an integration writing the attribute directly,
    // which is exactly the case the MutationObserver exists for.
    const ui = mount(() => buttons('A', 'B', 'C'))
    expect(ui.labels()).toEqual(['A', 'B', 'C'])
    must(ui.host.querySelectorAll<HTMLElement>('button')[1]).setAttribute('focusgroup', 'none')
    await settle()
    expect(ui.labels()).toEqual(['A', 'C'])
  })

  it('publishes the per-role defaults as data, so documentation cannot drift', () => {
    expect(ROLE_DEFAULTS.menu.skipDisabled).toBe(false)
    expect(ROLE_DEFAULTS.menubar.skipDisabled).toBe(false)
    expect(ROLE_DEFAULTS.toolbar.skipDisabled).toBe(true)
    expect(ROLE_DEFAULTS.listbox).toEqual({ axis: 'block', wrap: false, skipDisabled: true })
    expect(NO_ROLE_DEFAULTS).toEqual({ axis: 'both', wrap: false, skipDisabled: true })
  })
})

// ---------------------------------------------------------------------------
// Every item skipped — the obvious way to break the one-tabbable invariant
// ---------------------------------------------------------------------------
describe('a group where every item is skipped', () => {
  const allDisabled = () =>
    mount(
      () => [
        h('button', { key: 'a', 'aria-disabled': 'true' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
        h('button', { key: 'c', 'aria-disabled': 'true' }, 'C'),
      ],
      () => 'toolbar',
    )

  it('keeps exactly one tab stop, so the widget has not left the keyboard', () => {
    const ui = allDisabled()
    expect(ui.items()).toEqual([])
    expect(ui.skippedLabels()).toEqual(['A', 'B', 'C'])
    expect(tabStops(ui.host)).toEqual(['A'])
  })

  it('says empty, which is the only signal there is', () => {
    expect(allDisabled().host.getAttribute('data-keyboard-navigation-state')).toBe('empty')
  })

  it('claims no key, because there is nowhere to go', () => {
    const ui = allDisabled()
    must(ui.host.querySelector<HTMLElement>('button')).focus()
    expect(press(document.activeElement, 'ArrowRight').defaultPrevented).toBe(false)
  })

  it('gives the tab stop back to a real item the moment one appears', async () => {
    const off = ref(true)
    const ui = mount(
      () => [
        h('button', { key: 'a', 'aria-disabled': 'true' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': off.value ? 'true' : undefined }, 'B'),
      ],
      () => 'toolbar',
    )
    expect(tabStops(ui.host)).toEqual(['A'])
    off.value = false
    await settle()
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('idle')
    expect(tabStops(ui.host)).toEqual(['B'])
  })

  it('opting every item out hands the tab order straight back', () => {
    const ui = mount(() => [
      h('button', { key: 'a', focusgroup: 'none' }, 'A'),
      h('button', { key: 'b', focusgroup: 'none' }, 'B'),
    ])
    // Nothing is managed, so nothing is held: the author said these are not a
    // group, and they are exactly as tabbable as they were written.
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('empty')
    expect(tabStops(ui.host)).toEqual(['A', 'B'])
  })

  it('every item natively disabled really is off the keyboard, and says so', () => {
    const ui = mount(() => [
      h('button', { key: 'a', disabled: true }, 'A'),
      h('button', { key: 'b', disabled: true }, 'B'),
    ])
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('empty')
    expect(tabStops(ui.host)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Hover as an input
//
// jsdom can see the wiring — the option, the reason, the focus rule, the
// coordinate guard — but it cannot see the trap the guard exists for, because
// nothing here has layout to scroll. That case is playground card 16's browser
// regression, and it failed against a `mouseover` handler before this landed:
// twelve ArrowDowns from Row 3 finished on Row 7 with five spurious hovers.
// ---------------------------------------------------------------------------
describe('hover as an input', () => {
  /** A cursor at a point. `pointermove`, because `mouseover` is the trap. */
  function pointerMove(target: Element, x: number, y: number, pointerType?: string): void {
    const event = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y })
    // jsdom implements no `PointerEvent` at all, so the field has to be added.
    if (pointerType !== undefined) Object.defineProperty(event, 'pointerType', { value: pointerType })
    target.dispatchEvent(event)
  }

  /**
   * Park the cursor on an element, the way a hand does: the very first sample
   * a group ever sees is a baseline and is deliberately not acted on.
   */
  function cursorOnto(target: Element, y = 20): void {
    pointerMove(target, 10, y - 1)
    pointerMove(target, 10, y)
  }

  /**
   * A clock the test owns. The group is deaf to the cursor for 150ms after a
   * key, and wall-clock time inside a test never reaches that — so without
   * this every hover after a keystroke would be suppressed for a reason the
   * test never asked for.
   */
  let clock = 0
  beforeEach(() => {
    clock = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  const handOffTheKeyboard = (): void => {
    clock += HOVER_AFTER_KEY_MS
  }

  it('is off by default — the cursor is not an input unless you say so', () => {
    const ui = mount(() => buttons('A', 'B', 'C'))
    cursorOnto(must(ui.items()[2]))
    expect(ui.active()).toBe('A')
    expect(ui.tabbable().map(label)).toEqual(['A'])
  })

  it('makes the hovered item active, and the arrows continue from it', () => {
    const ui = mount(() => buttons('A', 'B', 'C', 'D'), () => ({ hover: true }))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('B')
    handOffTheKeyboard()
    cursorOnto(must(ui.items()[2]))
    expect(ui.active()).toBe('C')
    // The whole point of the ticket: the next key steps from the mouse, not
    // from where the keyboard was.
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('D')
  })

  it('reports the move as reason "hover" on both channels', () => {
    const seen: string[] = []
    const ui = mount(
      () => buttons('A', 'B', 'C'),
      () => ({ hover: true, onNavigate: (d: KeyboardNavigationEventDetail) => seen.push(`cb:${d.reason}`) }),
    )
    ui.host.addEventListener('keyboard-navigate', (e) => {
      seen.push(`ev:${(e as CustomEvent<KeyboardNavigationEventDetail>).detail.reason}`)
    })
    cursorOnto(must(ui.items()[2]))
    expect(seen).toEqual(['cb:hover', 'ev:hover'])
  })

  it('never scrolls — the hovered item is under the cursor, so it is already on screen', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    must(ui.items()[0]).focus()
    calls.length = 0
    cursorOnto(must(ui.items()[2]))
    expect(calls.filter((c) => c.kind !== 'focus')).toEqual([])
    // …and the same group does scroll for a key, so the assertion above is
    // about hover and not about a group whose scroll is switched off.
    calls.length = 0
    type(ui, 'ArrowUp')
    expect(calls.map((c) => c.kind)).toEqual(['focus', 'scroll'])
  })

  it('takes the DOM focus with it only when the keyboard is already on an item', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    must(ui.items()[0]).focus()
    calls.length = 0
    cursorOnto(must(ui.items()[2]))
    expect(document.activeElement).toBe(ui.items()[2])
    // One highlight, not two: the focus ring and the active marker agree.
    expect(ui.active()).toBe('C')
    // `preventScroll` unconditionally — the item is under the cursor, and
    // letting the user agent centre it would drag the list out from under the
    // mouse.
    expect(calls).toEqual([{ kind: 'focus', label: 'C', el: ui.items()[2], arg: { preventScroll: true } }])
  })

  it('keeps preventScroll even where the consumer handed scrolling back to the browser', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true, scroll: false }))
    must(ui.items()[0]).focus()
    calls.length = 0
    cursorOnto(must(ui.items()[2]))
    // `scroll: false` asks for the UA's own focus scroll on a *key*. A hover
    // has nothing to bring into view and everything to lose by moving the
    // list, so it opts out of that one too.
    expect(calls.map((c) => c.arg)).toEqual([{ preventScroll: true }])
  })

  it('never moves focus INTO the group — the filter-input case', () => {
    const outside = document.createElement('input')
    outside.type = 'text'
    document.body.appendChild(outside)
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    outside.focus()
    cursorOnto(must(ui.items()[2]))
    expect(document.activeElement).toBe(outside)
    // The marker and the one tab stop moved anyway, so a Tab from the field
    // lands where the mouse is.
    expect(ui.active()).toBe('C')
    expect(ui.tabbable().map(label)).toEqual(['C'])
    outside.remove()
  })

  it('does not blur a text field that is inside the group either', () => {
    const ui = mount(
      () => [
        h('input', { key: 'q', type: 'text', 'aria-label': 'Filter' }),
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b' }, 'B'),
      ],
      () => ({ hover: true }),
    )
    const field = must(ui.host.querySelector<HTMLElement>('input'))
    field.focus()
    cursorOnto(must(ui.items()[1]))
    expect(document.activeElement).toBe(field)
    expect(ui.active()).toBe('B')
  })

  it('does not blur a text field held INSIDE one of the items', () => {
    const ui = mount(
      () => [
        h('div', { key: 'row1', tabindex: '-1' }, ['Row 1', h('input', { key: 'q', type: 'text' })]),
        h('div', { key: 'row2', tabindex: '-1' }, 'Row 2'),
      ],
      () => ({ hover: true }),
    )
    const field = must(ui.host.querySelector<HTMLElement>('input'))
    field.focus()
    cursorOnto(must(ui.items()[1]))
    // The keyboard is standing on something the arrows do not own, one level
    // inside a row. "Focus is in an item's subtree" is not "focus is on an
    // item", and treating it as such would eat the user's typing.
    expect(document.activeElement).toBe(field)
    expect(ui.active()).toBe('Row 2')
  })

  it('in activedescendant mode it moves the pointer and never the focus', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true, activedescendant: true }))
    outside.focus()
    cursorOnto(must(ui.items()[2]))
    expect(document.activeElement).toBe(outside)
    const pointed = must(ui.host.getAttribute('aria-activedescendant'))
    expect(document.getElementById(pointed)).toBe(ui.items()[2])
    outside.remove()
  })

  it('ignores a pointer event whose coordinates have not changed', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    // The baseline, then the same point again — which is what a scroll moving
    // the document under a stationary cursor produces.
    pointerMove(must(ui.items()[1]), 40, 40)
    pointerMove(must(ui.items()[2]), 40, 40)
    expect(ui.active()).toBe('A')
    // One pixel of real movement, and it is heard.
    pointerMove(must(ui.items()[2]), 40, 41)
    expect(ui.active()).toBe('C')
  })

  it('treats the first cursor sample of all as a baseline, not as an input', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    pointerMove(must(ui.items()[2]), 10, 10)
    expect(ui.active()).toBe('A')
    pointerMove(must(ui.items()[2]), 10, 11)
    expect(ui.active()).toBe('C')
  })

  it('is deaf to the cursor for a moment after a key this group acted on', () => {
    const ui = mount(() => buttons('A', 'B', 'C', 'D'), () => ({ hover: true }))
    must(ui.items()[0]).focus()
    type(ui, 'ArrowDown')
    expect(ui.active()).toBe('B')

    // A resting hand's one-pixel jitter, 50ms after the key. Real movement,
    // and still not an input: the list is very likely still settling under it.
    clock += 50
    pointerMove(must(ui.items()[3]), 10, 10)
    pointerMove(must(ui.items()[3]), 10, 11)
    expect(ui.active()).toBe('B')

    clock += HOVER_AFTER_KEY_MS
    pointerMove(must(ui.items()[3]), 10, 12)
    expect(ui.active()).toBe('D')
  })

  it('is deaf after a keystroke in a filter field the group merely overheard', () => {
    const ui = mount(
      () => [
        h('input', { key: 'q', type: 'text', 'aria-label': 'Filter' }),
        ...buttons('A', 'B', 'C'),
      ],
      () => ({ hover: true }),
    )
    const field = must(ui.host.querySelector<HTMLElement>('input'))
    field.focus()
    // A key the group heard and deliberately did not act on — `keys.ts` never
    // claims a keystroke inside a text field. It still re-flows the list under
    // whatever the hand is resting on, which is the whole reason the stamp
    // sits above every early return in `onKeydown` rather than beside
    // `activate`.
    press(field, 'f')
    pointerMove(must(ui.items()[2]), 10, 10)
    pointerMove(must(ui.items()[2]), 10, 11)
    expect(ui.active()).toBe('A')

    clock += HOVER_AFTER_KEY_MS
    pointerMove(must(ui.items()[2]), 10, 12)
    expect(ui.active()).toBe('C')
  })

  it('is deaf after an api move too — a combobox drives its list from code', () => {
    const nav = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B', 'C', 'D'), () => ({ hover: true, ref: nav }))
    nav.value?.focus(1)
    expect(ui.active()).toBe('B')
    // The api scrolled the list; the hand has not moved anywhere on purpose.
    pointerMove(must(ui.items()[3]), 10, 10)
    pointerMove(must(ui.items()[3]), 10, 11)
    expect(ui.active()).toBe('B')

    clock += HOVER_AFTER_KEY_MS
    pointerMove(must(ui.items()[3]), 10, 12)
    expect(ui.active()).toBe('D')
  })

  it('ignores touch, so a tap does not activate whatever it passed over', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    pointerMove(must(ui.items()[1]), 10, 10, 'touch')
    pointerMove(must(ui.items()[2]), 10, 40, 'touch')
    expect(ui.active()).toBe('A')
    // A pen is a cursor and is heard.
    pointerMove(must(ui.items()[2]), 10, 60, 'pen')
    pointerMove(must(ui.items()[2]), 10, 61, 'pen')
    expect(ui.active()).toBe('C')
  })

  it('does not activate an item the arrows skip', () => {
    const ui = mount(
      () => [
        h('button', { key: 'a' }, 'A'),
        h('button', { key: 'b', 'aria-disabled': 'true' }, 'B'),
        h('button', { key: 'c' }, 'C'),
      ],
      () => ({ hover: true, role: 'listbox' }),
    )
    expect(ui.skippedLabels()).toEqual(['B'])
    cursorOnto(must(ui.skipped()[0]))
    expect(ui.active()).toBe('A')
    expect(ui.tabbable().map(label)).toEqual(['A'])
  })

  it('changes nothing for a cursor in the gap between items', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ hover: true }))
    cursorOnto(ui.host)
    expect(ui.active()).toBe('A')
  })

  it('adopts the item that holds the hovered element', () => {
    const ui = mount(
      () => [
        h('div', { key: 'a', tabindex: '-1' }, 'A'),
        h('div', { key: 'b', tabindex: '-1' }, ['B', h('span', { key: 'i' }, ' badge')]),
      ],
      () => ({ hover: true }),
    )
    const badge = must(ui.host.querySelector<HTMLElement>('span'))
    cursorOnto(badge)
    expect(ui.active()).toBe('B badge')
  })

  it('leaves exactly one tabbable item, wherever the mouse goes', () => {
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    cursorOnto(must(ui.items()[2]))
    expect(ui.tabbable().map(label)).toEqual(['C'])
    pointerMove(must(ui.items()[1]), 10, 30)
    expect(ui.tabbable().map(label)).toEqual(['B'])
    expect(ui.items().map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('leaves the active item where the mouse left it', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true }))
    cursorOnto(must(ui.items()[2]))
    ui.host.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }))
    outside.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 500, clientY: 500 }))
    // Staying is what a menu does; reverting to the last keyboard position
    // would make the mouse a mode rather than an input.
    expect(ui.active()).toBe('C')
    outside.remove()
  })

  it('does nothing at all for the item that is already active', () => {
    const seen: string[] = []
    const ui = mount(
      () => buttons('A', 'B'),
      () => ({ hover: true, onNavigate: (d: KeyboardNavigationEventDetail) => seen.push(d.reason) }),
    )
    must(ui.items()[0]).focus()
    calls.length = 0
    cursorOnto(must(ui.items()[0]))
    pointerMove(must(ui.items()[0]), 10, 40)
    // Not merely "emits nothing": re-focusing the element the user is already
    // on is a real event storm on a list the mouse is being dragged across.
    expect(calls).toEqual([])
    expect(seen).toEqual([])
  })

  it('honours enabled: false', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ hover: true, enabled: false }))
    cursorOnto(must(ui.host.querySelectorAll('button')[1] as HTMLElement))
    expect(ui.host.getAttribute('data-keyboard-navigation-state')).toBe('disabled')
    expect(ui.items()).toEqual([])
  })

  it('a disabled group does not so much as watch the cursor', async () => {
    const on = ref(false)
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: true, enabled: on.value }))
    const raw = [...ui.host.querySelectorAll<HTMLElement>('button')]
    // Two real moves while the group is switched off.
    pointerMove(must(raw[2]), 10, 10)
    pointerMove(must(raw[2]), 10, 11)
    on.value = true
    await settle()
    // If those had been recorded, this single move would be a second sample
    // and would activate C. A group that is off keeps no state at all.
    pointerMove(must(raw[2]), 10, 12)
    expect(ui.active()).toBe('A')
  })

  it('can be switched on and off at runtime', async () => {
    const on = ref(false)
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ hover: on.value }))
    cursorOnto(must(ui.items()[2]))
    expect(ui.active()).toBe('A')
    on.value = true
    await settle()
    // Nothing was recorded while the option was off, so the group's first
    // sample is still ahead of it — and a first sample is a baseline.
    cursorOnto(must(ui.items()[2]), 60)
    expect(ui.active()).toBe('C')
  })

  it('a nested group’s hover is not the parent’s', () => {
    const ui = mount(
      () => [
        h('button', { key: 'file', role: 'menuitem' }, 'File'),
        withDirectives(
          h('div', { key: 'edit', role: 'menuitem', tabindex: '-1', class: 'edit' }, [
            h('span', { key: 'u', role: 'menuitem', tabindex: '-1' }, 'Undo'),
            h('span', { key: 'r', role: 'menuitem', tabindex: '-1' }, 'Redo'),
          ]),
          [[vKeyboardNavigation, { role: 'menu', hover: true } as KeyboardNavigationBinding]],
        ),
        h('button', { key: 'view', role: 'menuitem' }, 'View'),
      ],
      () => ({ role: 'menubar', hover: true }),
      { role: 'menubar' },
    )
    const inner = must(ui.host.querySelector<HTMLElement>('.edit'))
    const redo = must(inner.querySelectorAll<HTMLElement>('span')[1])
    cursorOnto(redo)
    // The inner group moved. The outer one heard the same bubbling event and
    // left it alone — the same ownership rule `focusin` follows, so hover and
    // focus can never disagree about whose item an element is.
    expect(redo.getAttribute('data-keyboard-navigation-item')).toBe('active')
    const outerActive = [...ui.host.querySelectorAll<HTMLElement>(ITEM)]
      .filter((el) => el.parentElement?.closest('[data-keyboard-navigation-state]') === ui.host)
      .filter((el) => el.getAttribute('data-keyboard-navigation-item') === 'active')
    expect(outerActive.map(label)).toEqual(['File'])
  })

  it('stops listening on unmount', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ hover: true }))
    const item = must(ui.items()[1])
    ui.unmount()
    expect(() => cursorOnto(item)).not.toThrow()
    expect(item.getAttribute('data-keyboard-navigation-item')).toBe(null)
  })

  it('takes back every listener it added, the cursor one included', () => {
    const realAdd = HTMLElement.prototype.addEventListener
    const realRemove = HTMLElement.prototype.removeEventListener
    const added: Array<[HTMLElement, string]> = []
    const removed: Array<[HTMLElement, string]> = []
    vi.spyOn(HTMLElement.prototype, 'addEventListener').mockImplementation(function (
      this: HTMLElement, type: string, fn: EventListenerOrEventListenerObject | null, opts?: unknown,
    ) {
      added.push([this, type])
      realAdd.call(this, type, fn, opts as AddEventListenerOptions)
    })
    vi.spyOn(HTMLElement.prototype, 'removeEventListener').mockImplementation(function (
      this: HTMLElement, type: string, fn: EventListenerOrEventListenerObject | null, opts?: unknown,
    ) {
      removed.push([this, type])
      realRemove.call(this, type, fn, opts as EventListenerOptions)
    })

    const ui = mount(() => buttons('A', 'B'), () => ({ hover: true }))
    const host = ui.host
    const onHost = (log: Array<[HTMLElement, string]>): string[] =>
      log.filter(([el]) => el === host).map(([, type]) => type).sort()
    expect(onHost(added)).toEqual(['focusin', 'focusout', 'keydown', 'pointerdown', 'pointermove'])
    ui.unmount()
    // "Removes exactly what it added" is a claim `directive.ts` makes out
    // loud, and a listener left on a detached host keeps the whole group —
    // items, observer, api — alive with it.
    expect(onHost(removed)).toEqual(onHost(added))
  })
})

// ---------------------------------------------------------------------------
// The cursor guard on its own — hover.ts is a pure function over one record,
// and this is where the arithmetic is pinned down without a DOM in the way.
// ---------------------------------------------------------------------------
describe('the cursor guard', () => {
  it('records the first sample and does not act on it', () => {
    const track = createPointerTrack()
    expect(isCursorInput(track, { pointerType: 'mouse', x: 5, y: 7, now: 0 })).toBe(false)
    expect(track.at).toEqual({ x: 5, y: 7 })
    expect(isCursorInput(track, { pointerType: 'mouse', x: 5, y: 8, now: 0 })).toBe(true)
  })

  it('rejects the same point twice — the document moved, not the cursor', () => {
    const track = createPointerTrack()
    isCursorInput(track, { pointerType: 'mouse', x: 5, y: 7, now: 0 })
    expect(isCursorInput(track, { pointerType: 'mouse', x: 5, y: 7, now: 0 })).toBe(false)
    expect(isCursorInput(track, { pointerType: 'mouse', x: 6, y: 7, now: 0 })).toBe(true)
    expect(isCursorInput(track, { pointerType: 'mouse', x: 6, y: 9, now: 0 })).toBe(true)
  })

  it('stays shut for exactly HOVER_AFTER_KEY_MS after a key', () => {
    const track = createPointerTrack()
    isCursorInput(track, { pointerType: 'mouse', x: 0, y: 0, now: 0 })
    noteKey(track, 1000)
    expect(isCursorInput(track, { pointerType: 'mouse', x: 1, y: 0, now: 1000 })).toBe(false)
    expect(isCursorInput(track, { pointerType: 'mouse', x: 2, y: 0, now: 1000 + HOVER_AFTER_KEY_MS - 1 })).toBe(false)
    expect(isCursorInput(track, { pointerType: 'mouse', x: 3, y: 0, now: 1000 + HOVER_AFTER_KEY_MS })).toBe(true)
  })

  it('keeps recording while it is shut, so the next sample is not compared to a stale point', () => {
    const track = createPointerTrack()
    isCursorInput(track, { pointerType: 'mouse', x: 0, y: 0, now: 0 })
    noteKey(track, 1000)
    isCursorInput(track, { pointerType: 'mouse', x: 50, y: 50, now: 1010 })
    expect(track.at).toEqual({ x: 50, y: 50 })
    // The cursor has not moved since; the window opening must not be enough.
    expect(isCursorInput(track, { pointerType: 'mouse', x: 50, y: 50, now: 2000 })).toBe(false)
  })

  it('hears a group that has never seen a key', () => {
    const track = createPointerTrack()
    isCursorInput(track, { pointerType: 'mouse', x: 0, y: 0, now: 0 })
    expect(isCursorInput(track, { pointerType: 'mouse', x: 1, y: 0, now: 0 })).toBe(true)
  })

  it('rejects touch without recording it — a finger is not the cursor', () => {
    const track = createPointerTrack()
    expect(isCursorInput(track, { pointerType: 'touch', x: 9, y: 9, now: 0 })).toBe(false)
    expect(track.at).toBe(null)
  })

  it('reads an unknown pointerType as a mouse, because jsdom has no PointerEvent', () => {
    const track = createPointerTrack()
    isCursorInput(track, { pointerType: undefined, x: 0, y: 0, now: 0 })
    expect(isCursorInput(track, { pointerType: undefined, x: 1, y: 0, now: 0 })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// activedescendant and focus that is not ours
// ---------------------------------------------------------------------------
describe('activedescendant leaves focus where the user put it', () => {
  it('does not take the focus from an element outside the group', () => {
    const outside = document.createElement('input')
    outside.type = 'text'
    document.body.appendChild(outside)
    const nav = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ activedescendant: true, ref: nav }))
    outside.focus()
    nav.value?.focus(2)
    // This is the combobox: the pointer moves, the field keeps the caret.
    expect(document.activeElement).toBe(outside)
    const pointed = must(ui.host.getAttribute('aria-activedescendant'))
    expect(document.getElementById(pointed)).toBe(ui.items()[2])
    outside.remove()
  })

  it('still pulls focus up from an item inside the group', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ activedescendant: true }))
    // What a click on an option produces: the option itself takes the focus,
    // where `aria-activedescendant` on the host says nothing to a screen
    // reader.
    must(ui.items()[1]).focus()
    press(ui.items()[1], 'ArrowUp')
    expect(document.activeElement).toBe(ui.host)
    expect(ui.active()).toBe('A')
  })

  it('still claims focus that is nowhere at all', () => {
    const nav = ref<KeyboardNavigationApi>()
    const ui = mount(() => buttons('A', 'B', 'C'), () => ({ activedescendant: true, ref: nav }))
    // `<body>` is the browser's word for "focus is nowhere", not for
    // "somebody else is using it" — and it is what the browser leaves behind
    // when the focused item is removed, which is the state the focus rescue
    // in `sync` exists to repair.
    expect(document.activeElement).toBe(document.body)
    nav.value?.focus(2)
    expect(document.activeElement).toBe(ui.host)
    expect(ui.active()).toBe('C')
  })
})
