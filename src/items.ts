/**
 * Collecting the group's descendants and sorting them into three piles: the
 * ones the arrows stop on, the ones they skip, and the ones that are none of
 * this group's business.
 *
 * Rules this module exists to keep in one place:
 *
 *   - **DOM order, never CSS `order` or grid placement.** `querySelectorAll`
 *     returns document order and that is the order the arrows follow.
 *   - **Skipping is attribute-driven, never measured.** A geometry test would
 *     make the group's behaviour depend on the window size, and a
 *     stylesheet-driven `display: none` is deliberately not detected — use
 *     `hidden`, `v-show` or `v-if`.
 *   - **Nothing this group skips becomes unreachable.** A skipped element is
 *     still in the accessibility tree, so if the arrows dropped it silently a
 *     screen-reader user browsing by role would find a control a sighted
 *     keyboard user cannot reach. Every pile below is consistent between the
 *     two: see the three-pile table.
 *
 * ## The three piles
 *
 * | Pile | What lands here | What happens to it |
 * |---|---|---|
 * | `items` | everything else | roving `tabindex`: exactly one `0`, the rest `-1` |
 * | `skipped` | `aria-disabled="true"` under a skipping role, and anything under `aria-hidden="true"` | held at `tabindex="-1"` so it is not a second tab stop — *unless* it is all that is left, in which case the first one holds the group's one tab stop |
 * | *(not ours)* | `focusgroup="none"`, controls that own their own keys, natively unfocusable elements, and anything owned by a nested group | never touched at all — it keeps whatever `tabindex` the author gave it |
 *
 * Each pile agrees with what a screen reader is told:
 *   - `aria-disabled` is announced as disabled, and the arrows skip it. Same list.
 *   - `aria-hidden` is not announced at all, and it is not focusable either. Same list.
 *   - `disabled` / `hidden` / `inert` / `display:none` are not in the a11y tree
 *     and cannot be focused by anything. Same list.
 *   - `focusgroup="none"` and a text field stay in the **tab** order, so they
 *     are reachable both ways — the arrows just do not stop there.
 */
import { isTextEntry } from './keys'
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

/**
 * The platform's own word for "not part of this focus group".
 *
 * The HTML `focusgroup` attribute — whose vocabulary this package shadows
 * everywhere else — spells the opt-out `focusgroup="none"` on the descendant.
 * Using the same spelling means the migration path stays "delete the
 * directive, add the attribute": the markup does not change. It is inert in a
 * browser that has shipped `focusgroup`, because the host here does not carry
 * the attribute that would activate it.
 */
export const OPT_OUT_SELECTOR = '[focusgroup="none"]'

/**
 * Natively unfocusable. The platform will not put focus here whatever we do,
 * so these are simply not the group's business — no `tabindex` is written and
 * none is taken away.
 *
 * `fieldset[disabled]` and the `hidden` / `inert` / inline-style chain are
 * walked upwards, because a container disables or hides everything inside it.
 * The walk stops at the host: what is above the group is the page's business.
 */
export function isUnfocusable(el: HTMLElement, host: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return true
  if (el.closest('fieldset[disabled]') !== null) return true
  let node: HTMLElement | null = el
  while (node) {
    if (node.hasAttribute('hidden') || node.hasAttribute('inert')) return true
    if (node.style.display === 'none' || node.style.visibility === 'hidden') return true
    if (node === host) return false
    node = node.parentElement
  }
  return false
}

/** `aria-hidden="true"` on the element or anywhere up to the host. */
export function isAriaHidden(el: HTMLElement, host: HTMLElement): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.getAttribute('aria-hidden') === 'true') return true
    if (node === host) return false
    node = node.parentElement
  }
  return false
}

/**
 * `aria-disabled="true"` — the *only* disabled state that is a policy choice.
 *
 * A natively `disabled` control cannot be focused at all, so "keep disabled
 * items navigable" is not something any library can offer for it; `disabled`
 * is handled by `isUnfocusable` above and is never negotiable. `aria-disabled`
 * keeps the element focusable and announced, which is exactly why the APG
 * recommends it where the presence of an unavailable option is information.
 */
export function isAriaDisabled(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true'
}

/**
 * The group that owns an element: the nearest host **strictly above** it.
 *
 * `el.closest(HOST_SELECTOR)` would answer "itself" for an element that is a
 * group host, which silently dropped a nested group's host out of its
 * parent's item list — and a dropped element keeps its natural tabbability,
 * so a menubar with a nested menu grew a second tab stop. Starting the walk
 * at the parent is the whole fix.
 */
export function ownerHost(el: HTMLElement): HTMLElement | null {
  return el.parentElement?.closest<HTMLElement>(HOST_SELECTOR) ?? null
}

/** What one pass over the host's descendants produced. */
export interface CollectedItems {
  /** Arrow stops, in DOM order. */
  items: HTMLElement[]
  /** Matched, focusable, but not an arrow stop. Held at `tabindex="-1"`. */
  skipped: HTMLElement[]
}

/**
 * Sort the host's matching descendants into the three piles above.
 *
 * `skipDisabled` decides only what happens to `aria-disabled="true"`; it is
 * resolved per role (see `roles.ts`) because the APG's answer differs per
 * pattern — a menu wants its unavailable options discoverable, a long listbox
 * does not.
 */
export function collectItems(
  host: HTMLElement,
  selector: string,
  skipDisabled: boolean,
): CollectedItems {
  const items: HTMLElement[] = []
  const skipped: HTMLElement[] = []
  for (const el of host.querySelectorAll<HTMLElement>(selector)) {
    // Owned by a nested group — including the nested group's own host, which
    // belongs to *this* group as an item.
    if (ownerHost(el) !== host) continue
    // Opted out by the author, or a control that owns its own arrows and
    // letters. Both keep their place in the tab order: they are reachable,
    // just not by the arrows. Anything else would be a keyboard dead end.
    if (el.matches(OPT_OUT_SELECTOR)) continue
    if (isTextEntry(el)) continue
    if (isUnfocusable(el, host)) continue
    if (isAriaHidden(el, host) || (skipDisabled && isAriaDisabled(el))) {
      skipped.push(el)
      continue
    }
    items.push(el)
  }
  return { items, skipped }
}

/**
 * Where the tab stop sits before anything has been focused: the item the
 * application has already marked as current, else the first.
 *
 * Read live, every time it is asked for. `:checked` follows the IDL property
 * that a click or a `v-model` writes, which never produces an attribute
 * mutation — so observing it would be useless, and observing it is exactly
 * what this package used to (uselessly) do.
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
