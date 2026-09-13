import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, h, nextTick, ref, withDirectives, type App, type VNode } from 'vue'
import {
  DIRECTIVE_NAME,
  KeyboardNavigationPlugin,
  vKeyboardNavigation,
  type KeyboardNavigationApi,
  type KeyboardNavigationBinding,
  type KeyboardNavigationEventDetail,
} from './vKeyboardNavigation'
// Internal, imported directly: it is pure geometry, and the directive path
// through it can only ever exercise the no-layout branch under jsdom.
import { pageStep } from './src/paging'

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
  arg: unknown
}
let calls: Call[] = []
const realFocus = HTMLElement.prototype.focus

function label(el: Element): string {
  return (el.textContent ?? '').trim() || el.tagName.toLowerCase()
}

beforeEach(() => {
  calls = []
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    calls.push({ kind: 'focus', label: label(this), arg: options })
    realFocus.call(this, options)
  })
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    calls.push({ kind: 'scroll', label: label(this), arg })
  }
  Element.prototype.scrollTo = function (this: Element, arg?: unknown) {
    calls.push({ kind: 'scrollTo', label: label(this), arg })
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
  items(): HTMLElement[]
  tabbable(): HTMLElement[]
  labels(): string[]
  active(): string
  unmount(): void
}

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
    items: () => [...host.querySelectorAll<HTMLElement>('[data-keyboard-navigation-item]')],
    tabbable: () => [...host.querySelectorAll<HTMLElement>('[tabindex="0"]')],
    labels: () => [...host.querySelectorAll('[data-keyboard-navigation-item]')].map(label),
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

  it('writes an offset as an ephemeral scroll margin and restores it', () => {
    const ui = mount(() => buttons('A', 'B'), () => ({ scroll: { offset: { top: 64 } } }))
    const second = must(ui.items()[1])
    second.style.scrollMarginTop = '8px'
    must(ui.items()[0]).focus()

    let duringCall = ''
    Element.prototype.scrollIntoView = function (this: Element) {
      duringCall = (this as HTMLElement).style.scrollMarginTop
    }
    type(ui, 'ArrowDown')
    expect(duringCall).toBe('64px')
    expect(second.style.scrollMarginTop).toBe('8px')
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
    const input = must(ui.items()[1])
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
    for (const el of ui.items()) {
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

  it('names typeahead and pointer moves as such', () => {
    const seen: KeyboardNavigationEventDetail[] = []
    const ui = mount(() => buttons('Apple', 'Banana'), () => ({ onNavigate: (d) => seen.push(d) }))
    must(ui.items()[0]).focus()
    seen.length = 0
    type(ui, 'b')
    expect(seen[0]?.reason).toBe('typeahead')

    must(ui.items()[0]).focus()
    expect(seen[1]?.reason).toBe('pointer')
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
  function list(count: number, height: number): HTMLElement[] {
    return Array.from({ length: count }, () => {
      const el = document.createElement('button')
      stubBox(el, { top: 0, left: 0, width: 100, height })
      return el
    })
  }

  it('counts the items that fit the viewport', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    // 200px of viewport, 40px items: five fit.
    expect(pageStep(list(50, 40), 0, 1, viewport)).toBe(5)
    expect(pageStep(list(50, 40), 20, -1, viewport)).toBe(5)
  })

  it('follows the item height rather than a hard-coded number', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    expect(pageStep(list(50, 100), 0, 1, viewport)).toBe(2)
    expect(pageStep(list(50, 25), 0, 1, viewport)).toBe(8)
  })

  it('never returns a step of zero, however tall the item', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 30)
    expect(pageStep(list(10, 400), 0, 1, viewport)).toBe(1)
  })

  it('never returns a step of zero at the ends of the list', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    // Already on the last item: there is nothing to walk, and a step of 0
    // would claim the key while moving nothing.
    expect(pageStep(list(3, 40), 2, 1, viewport)).toBe(1)
    expect(pageStep(list(3, 40), 0, -1, viewport)).toBe(1)
  })

  it('treats an unmeasurable list as one page', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 200)
    expect(pageStep(list(7, 0), 0, 1, viewport)).toBe(7)
    expect(pageStep(list(7, 40), 0, 1, null)).toBe(7)
  })

  it('stops at the end of the list', () => {
    const viewport = document.createElement('div')
    stubMetric(viewport, 'clientHeight', 1000)
    expect(pageStep(list(3, 40), 0, 1, viewport)).toBe(2)
  })
})
