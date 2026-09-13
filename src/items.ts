/**
 * Collecting the group's items: which descendants count, and which are
 * skipped.
 *
 * Two rules this module exists to keep in one place:
 *   - **DOM order, never CSS `order` or grid placement.** `querySelectorAll`
 *     returns document order and that is the order the arrows follow.
 *   - **Skipping is attribute-driven, never measured.** `[disabled]`,
 *     `[aria-disabled="true"]`, `[hidden]`, `[inert]` and an inline
 *     `display: none` / `visibility: hidden` (what `v-show` writes). A
 *     geometry test would make the group's behaviour depend on the window
 *     size, and a stylesheet-driven `display: none` is deliberately not
 *     detected — use `hidden`, `v-show` or `v-if`.
 */
import { HOST_SELECTOR } from './state'

/**
 * Everything that can hold focus, plus the ARIA item roles.
 *
 * `[tabindex]` matches any value including `-1`: the APG's own listbox and
 * menu markup gives every option `tabindex="-1"` and moves a `0` between
 * them, so treating `-1` as "not an item" would break the most standard
 * markup there is. The ARIA roles are here so a plain `<li role="option">`
 * with no tabindex at all still becomes an item — adding `tabindex` is this
 * directive's job; adding `role` never is.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="tab"]',
  '[role="radio"]',
].join(', ')

export function isDisabled(el: HTMLElement): boolean {
  return (
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.closest('fieldset[disabled]') !== null
  )
}

/** Hidden by an attribute, or by the inline style `v-show` writes. */
export function isHidden(el: HTMLElement, host: HTMLElement): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.hasAttribute('hidden') || node.hasAttribute('inert')) return true
    if (node.getAttribute('aria-hidden') === 'true') return true
    if (node.style.display === 'none' || node.style.visibility === 'hidden') return true
    if (node === host) return false
    node = node.parentElement
  }
  return false
}

/**
 * The group's items, in DOM order. Descendants owned by a nested group are
 * left to that group — otherwise the outer directive would move focus inside
 * a menu it does not own.
 */
export function collectItems(host: HTMLElement, selector: string): HTMLElement[] {
  const items: HTMLElement[] = []
  for (const el of host.querySelectorAll<HTMLElement>(selector)) {
    if (el.closest(HOST_SELECTOR) !== host) continue
    if (isDisabled(el) || isHidden(el, host)) continue
    items.push(el)
  }
  return items
}

/**
 * Where the tab stop sits before anything has been focused: the item the
 * application has already marked as current, else the first.
 *
 * Reading `aria-selected` / `aria-checked` / `:checked` is not the same as
 * writing them — selection stays the application's, always.
 */
export function initialIndex(items: HTMLElement[]): number {
  for (let i = 0; i < items.length; i++) {
    const el = items[i]
    if (!el) continue
    if (el.getAttribute('aria-selected') === 'true') return i
    if (el.getAttribute('aria-checked') === 'true') return i
    const current = el.getAttribute('aria-current')
    if (current !== null && current !== 'false') return i
    if (el.matches(':checked')) return i
  }
  return 0
}
