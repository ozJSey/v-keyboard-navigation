/**
 * THE scroll. Nothing else in this package moves a scroll position.
 *
 * This is the reason the package exists. Roving-tabindex libraries leave
 * scrolling to the user agent on purpose — the APG says the benefit of roving
 * tabindex over `aria-activedescendant` is that "the user agent will scroll
 * the newly focused element into view" — but the user agent **centres** the
 * item. Measured in headless Chrome, a 200px viewport of 40px rows, one
 * ArrowDown per step, `scrollTop` read back after each key:
 *
 *   focus()                           0,0,0,0,120,120,120,240,240,240,360,360
 *   focus() then 'nearest'            0,0,0,0,120,120,120,240,240,240,360,360
 *   focus({preventScroll}) + nearest  0,0,0,0, 40, 80,120,160,200,240,280,320
 *
 * The first column lurches three items at a time; the third follows the focus
 * ring one item at a time. The second is the trap: identical to the first.
 *
 * **The order is load-bearing.** `focus()` and then
 * `scrollIntoView({block:'nearest'})` is a silent no-op: the UA has already
 * centred the item, so `nearest` finds it on screen and does nothing. The
 * focus call must carry `preventScroll: true` — see `roving.ts`, which is the
 * only caller.
 *
 * Those three rows are re-measured on every run of the playground's
 * interaction spec (`scripts/interactions/v-keyboard-navigation.mjs`), which
 * compares the live card's trace against this exact array rather than against
 * a shape. If they ever disagree, the check fails and this comment is what it
 * names.
 *
 * The option shape (`container`, `offset`, `behavior`, `block`, `inline`) is
 * borrowed verbatim from `v-scroll-into-view`, deliberately: learning one
 * teaches the other. The code is not shared — that package is declarative and
 * edge-driven and defaults to `smooth`; this one runs per keystroke, where
 * `smooth` needs >400ms to settle against a ~30ms key repeat.
 *
 * Lifting this file on its own: it imports two type aliases from `./types` and
 * nothing else. Delete the import, inline the two shapes, and it stands alone.
 */
import type { KeyboardNavigationAxis, KeyboardNavigationContainer, ResolvedScroll } from './types'

/**
 * Resolve the `container` option **against this group**, never against the
 * document.
 *
 * `document.querySelector(sel)` returns the first match on the page, so two
 * instances of the same component both resolved to instance one's pane: the
 * second list never followed its own focus ring and the first one jumped
 * instead. Every string form is now anchored to the host:
 *
 *   - `':scope <sel>'` is a **descendant** of the host, exactly as `:scope`
 *     means in CSS. (It used to be `el.closest()`, i.e. an ANCESTOR — the
 *     opposite of what the syntax says, and out through the host as well.)
 *     `Element.querySelector` implements `:scope` natively, so the string is
 *     handed over whole.
 *   - a bare selector is the host itself, else the nearest **ancestor** that
 *     matches — the usual "pin the pane my list sits in" — else a descendant.
 *
 * Nothing here can leave the group. A genuinely unrelated element is still
 * reachable, but you have to say so out loud with the getter form:
 * `container: () => document.querySelector('#somewhere-else')`.
 */
export function resolveContainer(
  host: HTMLElement,
  ref: KeyboardNavigationContainer | undefined,
): HTMLElement | null {
  if (ref === undefined) return null
  if (typeof ref === 'function') return ref()
  if (ref instanceof HTMLElement) return ref
  try {
    if (ref.trimStart().startsWith(':scope')) return host.querySelector<HTMLElement>(ref)
    return host.closest<HTMLElement>(ref) ?? host.querySelector<HTMLElement>(ref)
  } catch {
    // A malformed selector is the consumer's typo, not a reason to throw
    // inside a keydown handler.
    return null
  }
}

/**
 * Nearest ancestor that actually scrolls **along `axis`**, or `null`.
 *
 * The axis matters: this used to concatenate `overflowY + overflowX` into one
 * regex test, so a strip that scrolls only sideways was accepted as the
 * vertical page viewport and vice versa. Used to size a PageUp / PageDown
 * step, and to own the maths when an `offset` is set.
 */
export function scrollParent(el: HTMLElement, axis: KeyboardNavigationAxis): HTMLElement | null {
  const wantsBlock = axis !== 'inline'
  const wantsInline = axis !== 'block'
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const scrollsBlock =
      wantsBlock && /auto|scroll|overlay/.test(style.overflowY) && node.scrollHeight > node.clientHeight
    const scrollsInline =
      wantsInline && /auto|scroll|overlay/.test(style.overflowX) && node.scrollWidth > node.clientWidth
    if (scrollsBlock || scrollsInline) return node
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

/** Our own maths, on one named box. The only place `scrollTo` is called. */
function scrollWithin(container: HTMLElement, item: HTMLElement, opts: ResolvedScroll): void {
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
  // A consumer running their own component tests must not get a TypeError out
  // of an arrow key, so both calls are guarded and simply do nothing where
  // there is no layout to scroll. Both guards are exercised by the suite —
  // see 'degrades quietly where the environment has no scrolling at all'.
  if (typeof container.scrollTo !== 'function') return

  container.scrollTo({
    top: top ?? container.scrollTop,
    left: left ?? container.scrollLeft,
    behavior: opts.behavior,
  })
}

/**
 * Bring the item into view. Must run *after* `focus({ preventScroll: true })`.
 *
 * Three paths, in order:
 *
 *   1. A pinned `container` — the maths is ours and only that element scrolls.
 *   2. No container but an `offset` — the maths is still ours, on the nearest
 *      scrolling ancestor. `offset` used to be applied as an ephemeral inline
 *      `scroll-margin`, but `style` is one of the attributes the group's own
 *      `MutationObserver` watches: that woke a full re-sync twice per
 *      keystroke, left `style=""` on every item it ever touched (including
 *      after unmount), and relied on `scrollIntoView` snapshotting
 *      scroll-margin synchronously, which no spec promises.
 *   3. Neither — native `scrollIntoView`, which walks every scrollable
 *      ancestor. That is the right behaviour, and it is not the part the
 *      browser gets wrong.
 *
 * `host` is passed rather than derived so container resolution can be scoped
 * to the group; see `resolveContainer`.
 */
export function scrollItemIntoView(
  host: HTMLElement,
  item: HTMLElement,
  opts: ResolvedScroll | null,
): void {
  if (!opts) return

  if (opts.container !== undefined) {
    const container = resolveContainer(host, opts.container)
    if (!container || !container.isConnected) return
    scrollWithin(container, item, opts)
    return
  }

  if (opts.offset !== undefined) {
    const viewport = scrollParent(item, 'both')
    // Nothing scrolls, so there is no gap to leave: fall through to the
    // native call, which will also do nothing.
    if (viewport) {
      scrollWithin(viewport, item, opts)
      return
    }
  }

  if (typeof item.scrollIntoView === 'function') {
    item.scrollIntoView({ behavior: opts.behavior, block: opts.block, inline: opts.inline })
  }
}
