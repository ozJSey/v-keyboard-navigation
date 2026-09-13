/**
 * Public types + the internal resolved-options shape.
 *
 * Leaf module: imports nothing. The vocabulary is deliberately the HTML
 * `focusgroup` attribute's own — `toolbar | tablist | menu | menubar |
 * listbox | radiogroup`, `inline | block`, `wrap | nowrap`, memory — so the
 * migration path when the platform ships is "delete the directive, add the
 * attribute, keep the scroll option".
 */

/**
 * A composite-widget pattern whose keyboard interaction this directive
 * implements. It is read from the host's `role` attribute, or stated
 * explicitly via `role` / the string binding form.
 *
 * **The directive never writes `role`.** A container that gains
 * `role="listbox"` without `aria-selected` on every option is worse than
 * plain markup, so naming the pattern here changes key handling only.
 */
export type KeyboardNavigationRole =
  | 'toolbar'
  | 'tablist'
  | 'menu'
  | 'menubar'
  | 'listbox'
  | 'radiogroup'

/**
 * Which arrow keys move focus. `inline` is Left/Right, `block` is Up/Down,
 * `both` binds all four. Never inferred from measured layout — that would
 * change behaviour on resize — only from `role` / `aria-orientation` / this
 * option.
 */
export type KeyboardNavigationAxis = 'inline' | 'block' | 'both'

/** `focusgroup`'s words for "does the last item step back to the first". */
export type KeyboardNavigationWrap = 'wrap' | 'nowrap'

/** Every form the scroll `container` option accepts. Resolved at scroll time. */
export type KeyboardNavigationContainer = HTMLElement | string | (() => HTMLElement | null)

/**
 * Controlled scroll — the reason this package exists.
 *
 * Option shape is borrowed verbatim from `v-scroll-into-view` so learning one
 * teaches the other, but the code is separate and the defaults differ: this
 * one runs per keystroke, so `behavior` defaults to `'instant'` (a `smooth`
 * scroll needs >400ms to settle against a ~30ms key repeat, and the list
 * visibly lags the focus ring).
 */
export interface KeyboardNavigationScrollOptions {
  /**
   * Scrollable ancestor to scroll instead of the one native `scrollIntoView`
   * would pick. Accepts an `HTMLElement`, a CSS selector, `:scope <sel>`
   * (resolved with `el.closest`), or a `() => HTMLElement | null` getter.
   * Resolving to `null` or a detached element is a silent no-op.
   */
  container?: KeyboardNavigationContainer
  /** Gap to leave between the item and the scroll edge — sticky headers. */
  offset?: { top?: number; left?: number }
  /** Default `'instant'`. `'smooth'` is the wrong default for key repeat. */
  behavior?: ScrollBehavior
  /** Vertical alignment. Default `'nearest'` — the one-item follow. */
  block?: ScrollLogicalPosition
  /** Horizontal alignment. Default `'nearest'`. */
  inline?: ScrollLogicalPosition
}

/**
 * Reflected in `data-keyboard-navigation-state` on the host.
 *
 * `empty` is the signal for the failure mode this package is built around: a
 * group with no focusable item has left the keyboard entirely, and nothing
 * else tells the developer. `disabled` is `enabled: false` — also a state
 * that would otherwise be invisible.
 */
export type KeyboardNavigationState = 'idle' | 'active' | 'empty' | 'disabled'

/** Why the active item changed. */
export type KeyboardNavigationReason = 'key' | 'typeahead' | 'pointer' | 'api' | 'sync'

/** Detail of the `keyboard-navigate` CustomEvent and of `onNavigate`. */
export interface KeyboardNavigationEventDetail {
  item: HTMLElement
  index: number
  previousItem: HTMLElement | null
  previousIndex: number
  reason: KeyboardNavigationReason
}

/**
 * Imperative handle, populated into the `ref` option. Shallow-reactive:
 * `activeIndex` / `activeItem` / `items` re-render templates that read them.
 */
export interface KeyboardNavigationApi {
  /** Current items, in DOM order, after disabled/hidden filtering. */
  items: HTMLElement[]
  /** Index of the one tabbable item, or `-1` when the group is empty. */
  activeIndex: number
  /** The one tabbable item, or `null` when the group is empty. */
  activeItem: HTMLElement | null
  /** Move focus to an index. Out-of-range is a no-op. */
  focus(index: number): void
  /** Move focus one item forward, honouring `wrap`. */
  next(): void
  /** Move focus one item backward, honouring `wrap`. */
  previous(): void
  /** Move focus to the first item. */
  first(): void
  /** Move focus to the last item. */
  last(): void
  /** Re-collect items now. The MutationObserver normally does this for you. */
  refresh(): void
}

/**
 * Ref-like target the directive populates with its api. Typed structurally so
 * `ref()`, `shallowRef()` or a plain `{ value }` object all work.
 */
export interface KeyboardNavigationApiRef {
  value: KeyboardNavigationApi | null | undefined
}

/** Top-level options. Every one of them exists to opt *out* of a default. */
export interface KeyboardNavigationOptions {
  /** `false` releases the group: tabindex restored, listeners idle. Default `true`. */
  enabled?: boolean
  /**
   * Name the pattern when the host has no `role`. Read from `role` otherwise.
   * Changes key handling only — the directive never writes `role`.
   */
  role?: KeyboardNavigationRole
  /** Override the axis. `'horizontal'` / `'vertical'` are accepted aliases. */
  orientation?: KeyboardNavigationAxis | 'horizontal' | 'vertical'
  /** Wrap past the ends. Defaults per role: clamp for toolbar/listbox, wrap for the rest. */
  wrap?: boolean | KeyboardNavigationWrap
  /** CSS selector for items, scoped to the host. Defaults to every focusable descendant. */
  items?: string
  /** Remember the last focused item across Tab out/in. `focusgroup`'s `nomemory` is `memory: false`. Default `true`. */
  memory?: boolean
  /** Jump to an item by typing its label. Default `true`. Never fires inside a text field. */
  typeahead?: boolean
  /** Milliseconds before the typeahead buffer resets. Default `500`. */
  typeaheadTimeout?: number
  /** Home / End jump to first / last. Default `true`. */
  homeEnd?: boolean
  /**
   * PageUp / PageDown. `true` (default) moves by a **real visible page** —
   * as many items as fit the scroll viewport, which degrades to first/last
   * when nothing scrolls. A number fixes the step. `false` leaves the keys
   * to the browser.
   */
  page?: boolean | number
  /**
   * Keep focus on the host and track the item with `aria-activedescendant`.
   * Default `false` (roving tabindex). In this mode the browser scrolls
   * nothing at all, so the controlled scroll is not an improvement — it is
   * the only scroll there is.
   */
  activedescendant?: boolean
  /** Controlled scroll. `false` hands scrolling back to the browser. Default on. */
  scroll?: boolean | KeyboardNavigationScrollOptions
  /** Target to receive the imperative api. Build the options object in `<script setup>`, not inline in the template. */
  ref?: KeyboardNavigationApiRef
  /** Called after every move. The `keyboard-navigate` CustomEvent carries the same detail. */
  onNavigate?: (detail: KeyboardNavigationEventDetail) => void
}

/** What the directive accepts: nothing, a role name, or the options object. */
export type KeyboardNavigationBinding = KeyboardNavigationRole | KeyboardNavigationOptions

/** Scroll options after defaults are filled in. `null` means "leave it to the browser". */
export interface ResolvedScroll {
  container: KeyboardNavigationContainer | undefined
  offset: { top?: number; left?: number } | undefined
  behavior: ScrollBehavior
  block: ScrollLogicalPosition
  inline: ScrollLogicalPosition
}

/** What a binding value plus the host's own attributes normalize to. */
export interface ResolvedOptions {
  enabled: boolean
  role: KeyboardNavigationRole | null
  axis: KeyboardNavigationAxis
  wrap: boolean
  itemSelector: string
  memory: boolean
  typeahead: boolean
  typeaheadTimeout: number
  homeEnd: boolean
  page: boolean | number
  activedescendant: boolean
  scroll: ResolvedScroll | null
  ref: KeyboardNavigationApiRef | undefined
  onNavigate: ((detail: KeyboardNavigationEventDetail) => void) | undefined
}
