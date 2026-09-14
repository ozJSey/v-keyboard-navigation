/**
 * Hover as an input — and the one trap that makes it hard.
 *
 * Leaf module: imports nothing, touches no DOM, holds no timers. It answers a
 * single question about one pointer event — *did the **cursor** move, and is
 * it allowed to speak right now?* — and the group's active item follows only
 * when it answers yes.
 *
 * ## The trap
 *
 * Arrowing through a long list scrolls it. The cursor does not move, but the
 * **document underneath it does**, so a different row is now under the mouse
 * and the browser dutifully fires `mouseover` / `pointerover` for it — and, in
 * Chromium, a compatibility `mousemove` / `pointermove` at the *same*
 * coordinates. A naive `mouseover` handler activates that row, so the user
 * presses ArrowDown and the highlight jumps to wherever the mouse happens to
 * be parked. Every keystroke after that fights the mouse. Every menu library
 * hits this, and it is invisible to jsdom and to unit tests, because neither
 * has layout to scroll.
 *
 * Two guards, in this order:
 *
 *   1. **The coordinates must actually have changed.** A cursor that has not
 *      moved has `clientX` / `clientY` it already had, whatever the element
 *      under it now is. This is the load-bearing one — it is what separates
 *      "the user moved the mouse" from "the list moved under the mouse", and
 *      it costs two comparisons.
 *   2. **Nothing for a short window after a key we acted on.** Belt to the
 *      first brace: a scroll can settle a frame or two later, a hand resting
 *      on a mouse jitters by a pixel, and a 1px jitter is a real coordinate
 *      change. Held key repeat arrives every ~30ms, so the window stays shut
 *      for as long as the arrow is down and reopens ~{@link HOVER_AFTER_KEY_MS}
 *      after it is released — under human reaction time, so a deliberate move
 *      to the mouse is never noticeably deaf.
 *
 * The first sample of all is recorded and not acted on. A cursor already
 * parked over the list when the page loads (or when `hover` is switched on)
 * has no previous position to differ from, and the very first event it
 * produces may well be the scroll-driven one.
 *
 * ## Touch
 *
 * Some browsers synthesise a `mousemove` at the tap point. Only `'touch'` is
 * rejected here, and it is rejected by name rather than by inferring it: an
 * unknown or absent `pointerType` is treated as a mouse, because jsdom
 * implements no `PointerEvent` at all and a consumer's own component test
 * dispatching `new MouseEvent('pointermove', …)` must still drive the feature.
 */

/**
 * Milliseconds after a key this group acted on during which the cursor is
 * ignored. Long enough to cover an instant scroll settling and a resting
 * hand's jitter; short enough that a deliberate reach for the mouse is not
 * swallowed.
 */
export const HOVER_AFTER_KEY_MS = 150

/** Last known cursor position, and when this group last acted on a key. */
export interface PointerTrack {
  /**
   * Where the cursor was, `null` until the first sample — see "The first
   * sample of all" above. One nullable pair rather than two nullable numbers:
   * they are only ever written together, and two of them invites a check that
   * reads one and forgets the other.
   */
  at: { x: number; y: number } | null
  /** `performance.now()` of the last key this group acted on. */
  lastKeyAt: number
}

/** One pointer event, reduced to the four things the decision needs. */
export interface CursorSample {
  /** `PointerEvent.pointerType`. `undefined` where there is no PointerEvent. */
  pointerType: string | undefined
  x: number
  y: number
  /** `performance.now()`, injected so this module owns no clock. */
  now: number
}

export function createPointerTrack(): PointerTrack {
  // `-Infinity` rather than 0: a group that has never seen a key must not be
  // deaf for the first 150ms of the page's life.
  return { at: null, lastKeyAt: -Infinity }
}

/**
 * Shut the cursor's window: something other than the cursor just happened.
 *
 * Two callers, and they cover different ground. `directive.ts` stamps **every
 * key the group heard**, acted on or not — a filter keystroke in a text field
 * inside the host re-flows the list without moving the active item at all.
 * `roving.ts` stamps **every non-hover activation**, which is how the window
 * shuts for `api.next()`: a combobox drives its list from code, and that
 * scrolls just as hard as an arrow key does.
 */
export function noteKey(track: PointerTrack, now: number): void {
  track.lastKeyAt = now
}

/**
 * Did the **cursor** move, and may it move the active item right now?
 *
 * Records every sample it accepts as a cursor position, whether or not it
 * answers `true`: the position is a fact about the cursor and stays the
 * baseline for the next event, so a mouse that travels during the post-key
 * window does not get to compare against a stale point once the window opens.
 * A touch is the one thing not recorded — a finger is not the cursor, and
 * letting it set the baseline would make the next real mouse move look like a
 * jump from wherever the screen was last tapped.
 */
export function isCursorInput(track: PointerTrack, sample: CursorSample): boolean {
  if (sample.pointerType === 'touch') return false

  const previous = track.at
  track.at = { x: sample.x, y: sample.y }

  if (previous === null) return false
  if (previous.x === sample.x && previous.y === sample.y) return false
  return sample.now - track.lastKeyAt >= HOVER_AFTER_KEY_MS
}
