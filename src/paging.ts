/**
 * PageUp / PageDown as a **real visible page**.
 *
 * Leaf module: imports one type, and measures nothing itself — the viewport
 * and the axis are injected so the caller owns both the "which element
 * scrolls" and the "which way does this widget run" questions, and this stays
 * a pure function of the geometry it is handed.
 *
 * Radix and Reka both map these keys to first / last, which is not what the
 * APG describes ("moves focus down/up by a page"). Doing it properly costs
 * one walk over the item boxes: measure how much of the axis they cover,
 * starting from where focus is, and stop when that exceeds one viewport.
 *
 * **The axis is an input, not an assumption.** This used to read
 * `clientHeight` and item `height` whatever the group was doing. On a
 * horizontally scrolling toolbar every item's height equals the strip height,
 * so one item filled the "page" on its own, the second one broke the walk and
 * the step collapsed to 1 — PageDown was indistinguishable from ArrowRight,
 * which is worse than the first/last mapping this module exists to beat.
 *
 * When nothing scrolls — a six-button toolbar, or any environment without
 * layout, jsdom included — every item is on screen, one page is the whole
 * group, and the step degrades to first / last. Which is where the other
 * libraries start.
 */
import type { KeyboardNavigationAxis } from './types'

/**
 * How many items one page holds, moving `direction` from `activeIndex`.
 * Never returns less than 1: a page that moves nothing is a dead key.
 *
 * **A page is the span the items cover, not the sum of their sizes.** Summing
 * box sizes ignores every gap, margin and separator between them, so a gapped
 * list pages further than one screenful; and on the axis the group does *not*
 * run along — a horizontal strip measured for its height — every item covers
 * the same band, the sum overflows on the second item, and the step collapses
 * to 1, which is PageDown as an alias for ArrowRight. Measuring the union of
 * the boxes from the first one walked gets both right: the strip's span never
 * grows, so the whole group is one page, which is the documented degradation.
 */
export function pageStep(
  items: HTMLElement[],
  activeIndex: number,
  direction: 1 | -1,
  viewport: HTMLElement | null,
  axis: KeyboardNavigationAxis,
): number {
  const total = items.length
  if (total === 0) return 1
  // `both` pages down the block axis: PageUp / PageDown are block-axis keys
  // everywhere else on the platform, and a group that binds all four arrows
  // has no reason to redefine them.
  const inline = axis === 'inline'
  const extent = (inline ? viewport?.clientWidth : viewport?.clientHeight) ?? 0
  if (extent <= 0) return total

  let near = Infinity
  let far = -Infinity
  let count = 0
  for (let i = activeIndex + direction; i >= 0 && i < total; i += direction) {
    const item = items[i]
    if (!item) break
    const rect = item.getBoundingClientRect()
    const size = inline ? rect.width || item.offsetWidth : rect.height || item.offsetHeight
    // No measurable box means no layout — fall back to "it all fits".
    if (size <= 0) return total
    const start = inline ? rect.left : rect.top
    const nextNear = Math.min(near, start)
    const nextFar = Math.max(far, start + size)
    // The first item is always taken, however large: a row taller than the
    // viewport still has to be one page, or the key does nothing.
    if (nextFar - nextNear > extent && count > 0) break
    near = nextNear
    far = nextFar
    count++
  }
  return Math.max(count, 1)
}
