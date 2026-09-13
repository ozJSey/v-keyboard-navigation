/**
 * Typeahead — jump to an item by typing the start of its label.
 *
 * Leaf module: imports nothing. The buffer is a plain object so the group can
 * own one and this module stays free of per-element state.
 *
 * `focusgroup`, the platform attribute this package shadows, lists typeahead
 * as a permanent non-goal. It is one of the reasons this directive is worth
 * having at all.
 */

export interface TypeaheadBuffer {
  text: string
  timer: ReturnType<typeof setTimeout> | undefined
}

export function createBuffer(): TypeaheadBuffer {
  return { text: '', timer: undefined }
}

export function clearBuffer(buffer: TypeaheadBuffer): void {
  if (buffer.timer !== undefined) clearTimeout(buffer.timer)
  buffer.timer = undefined
  buffer.text = ''
}

/** Append a character and (re)arm the reset timer. Returns the new buffer text. */
export function pushChar(
  buffer: TypeaheadBuffer,
  char: string,
  timeout: number,
  onReset: () => void,
): string {
  if (buffer.timer !== undefined) clearTimeout(buffer.timer)
  buffer.text += char
  buffer.timer = setTimeout(() => {
    buffer.text = ''
    buffer.timer = undefined
    onReset()
  }, timeout)
  return buffer.text
}

/**
 * The text a user would say out loud for this item: its accessible name where
 * one is spelled out, else its own text, else the label wrapping it (the
 * usual `<label><input type="radio"> Banana</label>` markup), else `title`.
 */
export function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return normalize(aria)

  const own = normalize(el.textContent ?? '')
  if (own) return own

  const label = el.closest('label')
  if (label) {
    const text = normalize(label.textContent ?? '')
    if (text) return text
  }

  return normalize(el.getAttribute('title') ?? el.getAttribute('value') ?? '')
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Index of the item the buffer points at, or `-1`.
 *
 * Two APG behaviours in one function: a repeated single character cycles
 * through the items starting with it (`a`, `a`, `a` walks Apple → Apricot →
 * Avocado), while a growing buffer keeps refining from the current item so
 * typing `b`, `a` does not skip past Banana.
 */
export function matchIndex(items: HTMLElement[], buffer: string, activeIndex: number): number {
  if (!buffer) return -1
  const query = buffer.toLowerCase()
  const first = query[0]
  if (first === undefined) return -1

  const repeated = query.length > 1 && [...query].every((char) => char === first)
  const needle = repeated ? first : query
  // A fresh single character, or a repeat of one, means "the next match after
  // where I am". A growing buffer means "still this one, if it still fits".
  const from = query.length === 1 || repeated ? activeIndex + 1 : activeIndex

  for (let step = 0; step < items.length; step++) {
    const index = (((from + step) % items.length) + items.length) % items.length
    const item = items[index]
    if (item && labelOf(item).toLowerCase().startsWith(needle)) return index
  }
  return -1
}
