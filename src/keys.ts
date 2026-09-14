/**
 * Key → intent. The one place that decides whether a keystroke belongs to
 * this directive at all.
 *
 * Leaf module: imports types only. Two of the package's non-negotiables live
 * here and nowhere else:
 *
 *   - **Never intercept keys inside a text field, a `select`, or
 *     contenteditable.** Those controls own their arrows and their letters.
 *   - **Never claim a key you did not handle.** Anything this function
 *     answers `null` for is left entirely alone — no `preventDefault`, no
 *     `stopPropagation` — so Tab, Enter, Space and every application shortcut
 *     behave exactly as they would without the directive.
 */
import type { KeyboardNavigationAxis } from './types'

export type NavigationIntent =
  | { kind: 'move'; to: 'next' | 'previous' | 'first' | 'last' }
  | { kind: 'page'; to: 'next' | 'previous' }
  | { kind: 'type'; char: string }

export interface KeyContext {
  axis: KeyboardNavigationAxis
  /** Right-to-left writing mode: ArrowLeft is "next" along the inline axis. */
  rtl: boolean
  homeEnd: boolean
  page: boolean | number
  typeahead: boolean
  /** Whether the typeahead buffer already holds something — Space extends it. */
  buffered: boolean
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/**
 * Input types where a keystroke means something to the control itself.
 * Everything not in this set — text, search, email, number, date, range —
 * is left alone.
 */
const NAVIGABLE_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'reset',
  'submit',
])

/**
 * A control that owns its own keys: text-ish input, `select`, contenteditable.
 *
 * Also used by `items.ts` to keep these controls out of the default item set
 * entirely. The two rules have to agree: a text field that the arrows can
 * enter but never leave is a keyboard trap, and that is exactly what the
 * package used to ship — the toolbar's roving `0` landed on the filter input
 * and neither arrow nor Home could get back out. Left out of the group, it
 * keeps its own place in the tab order and stays reachable.
 */
export function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable) return true
  // jsdom does not implement `isContentEditable`, and a consumer's own test
  // suite is exactly where "the directive ate my typing" must not appear.
  // The attribute is inherited, so the nearest one wins.
  const editable = el.closest('[contenteditable]')?.getAttribute('contenteditable')
  if (editable !== undefined && editable !== null && editable !== 'false') return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    return !NAVIGABLE_INPUT_TYPES.has(type)
  }
  return false
}

export function intentFor(event: KeyboardEvent, ctx: KeyContext): NavigationIntent | null {
  // Somebody upstream already dealt with it. That upstream is often another
  // instance of this directive: a nested group's host is an item of its
  // parent, so a key pressed on it reaches both listeners, inner one first,
  // and this is how the outer group learns to keep its hands off.
  if (event.defaultPrevented) return null
  // Modified keystrokes belong to the browser or the application.
  if (event.ctrlKey || event.metaKey || event.altKey) return null

  const target = event.target
  if (target instanceof HTMLElement) {
    if (isTextEntry(target)) return null
    // A native radio group already implements roving tabindex AND moves the
    // selection with the arrows. Handling the key here would move focus while
    // suppressing the check — worse than doing nothing. `role="radio"`
    // elements, which have no native behaviour, are still handled.
    if (ARROWS.has(event.key) && target.matches('input[type="radio"]')) return null
  }

  const forward = ctx.rtl ? 'ArrowLeft' : 'ArrowRight'
  const backward = ctx.rtl ? 'ArrowRight' : 'ArrowLeft'
  const inline = ctx.axis === 'inline' || ctx.axis === 'both'
  const block = ctx.axis === 'block' || ctx.axis === 'both'

  switch (event.key) {
    case 'ArrowDown':
      return block ? { kind: 'move', to: 'next' } : null
    case 'ArrowUp':
      return block ? { kind: 'move', to: 'previous' } : null
    case forward:
      return inline ? { kind: 'move', to: 'next' } : null
    case backward:
      return inline ? { kind: 'move', to: 'previous' } : null
    case 'Home':
      return ctx.homeEnd ? { kind: 'move', to: 'first' } : null
    case 'End':
      return ctx.homeEnd ? { kind: 'move', to: 'last' } : null
    case 'PageDown':
      return ctx.page === false ? null : { kind: 'page', to: 'next' }
    case 'PageUp':
      return ctx.page === false ? null : { kind: 'page', to: 'previous' }
  }

  if (!ctx.typeahead) return null
  if (event.key.length !== 1) return null
  // Space activates the control unless a word is already being typed, in
  // which case it is part of the word.
  if (event.key === ' ' && !ctx.buffered) return null
  return { kind: 'type', char: event.key }
}
