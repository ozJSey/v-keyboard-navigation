/**
 * THE scroll. Nothing else in this package moves a scroll position.
 *
 * This is the reason the package exists. Roving-tabindex libraries leave
 * scrolling to the user agent on purpose — the APG says the benefit of roving
 * tabindex over `aria-activedescendant` is that "the user agent will scroll
 * the newly focused element into view" — but the user agent **centres** the
 * item. Measured in Chrome, 200px viewport, 40px items, one ArrowDown per
 * step:
 *
 *   native focus()                    0,0,0,0,0,120,120,120,240,240,240,360
 *   preventScroll + block:'nearest'   0,0,0,0,0, 40, 80,120,160,200,240,280
 *
 * The first column lurches three items at a time; the second follows the
 * focus ring one item at a time.
 *
 * **The order is load-bearing.** `focus()` and then
 * `scrollIntoView({block:'nearest'})` is a silent no-op: the UA has already
 * centred the item, so `nearest` finds it on screen and does nothing. The
 * focus call must carry `preventScroll: true` — see `roving.ts`, which is the
 * only caller.
 *
 * The option shape (`container`, `offset`, `behavior`, `block`, `inline`) is
 * borrowed verbatim from `v-scroll-into-view`, deliberately: learning one
 * teaches the other. The code is not shared — that package is declarative and
 * edge-driven and defaults to `smooth`; this one runs per keystroke, where
 * `smooth` needs >400ms to settle against a ~30ms key repeat.
 */
import type { KeyboardNavigationContainer, ResolvedScroll } from './types'

/** Element, CSS selector, `:scope <sel>` (via `closest`), or a getter. */
export function resolveContainer(
  el: HTMLElement,
  ref: KeyboardNavigationContainer | undefined,
): HTMLElement | null {
  if (ref === undefined) return null
  if (typeof ref === 'function') return ref()
  if (ref instanceof HTMLElement) return ref
  try {
    if (ref.startsWith(':scope ')) return el.closest<HTMLElement>(ref.slice(7).trim())
    return document.querySelector<HTMLElement>(ref)
  } catch {
    // A malformed selector is the consumer's typo, not a reason to throw
    // inside a keydown handler.
    return null
  }
}

/**
 * Nearest ancestor that actually scrolls, or `null`. Only used to size a
 * PageUp / PageDown step — the scroll itself never needs it, because native
 * `scrollIntoView` walks the chain on its own.
 */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const scrollable = /auto|scroll|overlay/.test(`${style.overflowY}${style.overflowX}`)
    if (scrollable && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** Where a single axis has to land, or `null` when it is already in view. */
function alignFor(
  align: ScrollLogicalPosition,
  rel: number,
  size: number,
  scroll: number,
  client: number,
  offset: number,
): number | null {
  const far = rel + size
  if (align === 'start') return rel - offset
  if (align === 'end') return far - client
  if (align === 'center') return rel + size / 2 - client / 2
  // nearest — the leading `offset` pixels count as obscured (sticky header),
  // so "in view" means inside the shrunk window.
  const visibleStart = scroll + offset
  const visibleEnd = scroll + client
  if (rel >= visibleStart && far <= visibleEnd) return null
  return rel < visibleStart ? rel - offset : far - client
}

/**
 * Bring the item into view. Must run *after* `focus({ preventScroll: true })`.
 *
 * With a `container` the maths is ours and only that element scrolls. Without
 * one, native `scrollIntoView` walks every scrollable ancestor — which is the
 * right behaviour, and is not the part the browser gets wrong.
 */
export function scrollItemIntoView(item: HTMLElement, opts: ResolvedScroll | null): void {
  if (!opts) return

  if (opts.container !== undefined) {
    const container = resolveContainer(item, opts.container)
    if (!container || !container.isConnected) return

    const itemRect = item.getBoundingClientRect()
    const boxRect = container.getBoundingClientRect()
    const relTop = itemRect.top - boxRect.top + container.scrollTop
    const relLeft = itemRect.left - boxRect.left + container.scrollLeft

    const top = alignFor(
      opts.block, relTop, itemRect.height,
      container.scrollTop, container.clientHeight, opts.offset?.top ?? 0,
    )
    const left = alignFor(
      opts.inline, relLeft, itemRect.width,
      container.scrollLeft, container.clientWidth, opts.offset?.left ?? 0,
    )
    if (top === null && left === null) return
    // jsdom implements neither `scrollTo` on an element nor `scrollIntoView`.
    // A consumer running their own component tests must not get a TypeError
    // out of an arrow key, so both calls are guarded and simply do nothing
    // where there is no layout to scroll.
    if (typeof container.scrollTo !== 'function') return

    container.scrollTo({
      top: top ?? container.scrollTop,
      left: left ?? container.scrollLeft,
      behavior: opts.behavior,
    })
    return
  }

  // Native path. `offset` becomes an ephemeral scroll-margin across the call —
  // `scroll-margin` is honoured by scroll-into-view, so a sticky header costs
  // one line of CSS rather than a second implementation here.
  const top = opts.offset?.top
  const left = opts.offset?.left
  const style = item.style
  const previousTop = style.scrollMarginTop
  const previousLeft = style.scrollMarginLeft
  if (top !== undefined) style.scrollMarginTop = `${top}px`
  if (left !== undefined) style.scrollMarginLeft = `${left}px`
  try {
    // Guarded for the same reason as `scrollTo` above: no layout, no scroll.
    if (typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ behavior: opts.behavior, block: opts.block, inline: opts.inline })
    }
  } finally {
    if (top !== undefined) style.scrollMarginTop = previousTop
    if (left !== undefined) style.scrollMarginLeft = previousLeft
  }
}
