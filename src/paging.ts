/**
 * PageUp / PageDown as a **real visible page**.
 *
 * Leaf module: imports nothing, and measures nothing itself — the viewport is
 * injected so the caller owns the "which element scrolls" question and this
 * stays a pure function of the geometry it is handed.
 *
 * Radix and Reka both map these keys to first / last, which is not what the
 * APG describes ("moves focus down/up by a page"). Doing it properly costs
 * one walk over the item boxes: count how many items fit the viewport,
 * starting from where focus is.
 *
 * When nothing scrolls — a six-button toolbar, or any environment without
 * layout, jsdom included — every item is on screen, one page is the whole
 * group, and the step degrades to first / last. Which is where the other
 * libraries start.
 */

/**
 * How many items one page holds, moving `direction` from `activeIndex`.
 * Never returns less than 1: a page that moves nothing is a dead key.
 */
export function pageStep(
  items: HTMLElement[],
  activeIndex: number,
  direction: 1 | -1,
  viewport: HTMLElement | null,
): number {
  const total = items.length
  if (total === 0) return 1
  const height = viewport?.clientHeight ?? 0
  if (height <= 0) return total

  let used = 0
  let count = 0
  for (let i = activeIndex + direction; i >= 0 && i < total; i += direction) {
    const item = items[i]
    if (!item) break
    const box = item.getBoundingClientRect().height || item.offsetHeight
    // No measurable box means no layout — fall back to "it all fits".
    if (box <= 0) return total
    if (used + box > height && count > 0) break
    used += box
    count++
  }
  return Math.max(count, 1)
}
