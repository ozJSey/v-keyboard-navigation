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
   * The one element to scroll, instead of the ancestor chain native
   * `scrollIntoView` would walk. Accepts an `HTMLElement`, a
   * `() => HTMLElement | null` getter, or a CSS selector — and **a selector is
   * always resolved against this group's host, never against the document**:
   * `':scope <sel>'` is a descendant (as in CSS), a bare selector is the host
   * itself or its nearest matching ancestor, else a descendant. Use the getter
   * form to name an element outside the group. Resolving to `null` or to a
   * detached element is a silent no-op — it never falls back to native.
   */
  container?: KeyboardNavigationContainer
  /**
   * Gap to leave between the item and the leading scroll edge — sticky
   * headers. Setting it means this package owns the maths: with no
   * `container`, the nearest scrolling ancestor is scrolled rather than the
   * whole chain.
   */
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

/**
 * Why the active item changed.
 *
 * `pointer` means a pointer really was involved: a `pointerdown` inside the
 * item immediately preceded the focus. Focus arriving any other way —
 * keyboard Tab, a programmatic `el.focus()`, a focus restore — is `focus`.
 * (Before 0.2.0 every one of those was reported as `pointer`, so
 * `if (reason === 'pointer') track('click')` logged a click for every Tab.)
 *
 * `hover` is the cursor moving onto an item under `hover: true`. It is kept
 * apart from `pointer` on purpose: `pointer` is a press the user committed to,
 * `hover` is a cursor passing through, and a consumer that opens a detail pane
 * on `pointer` must not open one for every row the mouse crosses. It is also
 * the only reason that never scrolls — see `scroll.ts`.
 */
export type KeyboardNavigationReason =
  | 'key'
  | 'typeahead'
  | 'pointer'
  | 'hover'
  | 'focus'
  | 'api'
  | 'sync'

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
  /** Current arrow stops, in DOM order. */
  items: HTMLElement[]
  /**
   * Matched the item selector but the arrows do not stop there — see
   * `skipDisabled` and `focusgroup="none"`. Held at `tabindex="-1"`, so
   * reading this is how you check a group has not quietly gone unreachable.
   */
  skipped: HTMLElement[]
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
  /**
   * `false` releases the group: every original `tabindex` is restored and no
   * listener acts — keys, focus and blur are all ignored, and the host reports
   * `data-keyboard-navigation-state="disabled"` until it is turned back on.
   * Default `true`.
   */
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
  /**
   * Whether the arrows step over `aria-disabled="true"` items.
   *
   * Defaults per role (`ROLE_DEFAULTS`): `false` for `menu` and `menubar`,
   * where the set of options is itself information, `true` everywhere else.
   *
   * Only `aria-disabled` is a choice. A natively `disabled` control cannot be
   * focused by anything, so it is never an arrow stop whatever this says —
   * which is precisely why the APG recommends `aria-disabled` when you want an
   * unavailable control to stay discoverable.
   *
   * A skipped item is held at `tabindex="-1"` so it does not become a second
   * tab stop, and it stays announced as disabled, so the arrow list and the
   * screen-reader list still agree. To take an element out of the group
   * *without* calling it disabled, put `focusgroup="none"` on it: the arrows
   * ignore it and it keeps its own place in the tab order.
   */
  skipDisabled?: boolean
  /**
   * CSS selector for items, scoped to the host. Defaults to every focusable
   * descendant *except* controls that own their own keys — a text input, a
   * `select`, a contenteditable — which are never arrow stops and keep their
   * own place in the tab order. An explicit selector does not change that: a
   * text field the arrows could enter but never leave is a dead end.
   */
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
   * Let the cursor moving onto an item make it the active one, so the arrows
   * continue from where the mouse is: arrow to item 3, hover item 7, press
   * ArrowDown, land on item 8. Default `false` — silently moving the active
   * item is right for a menu and wrong for a toolbar.
   *
   * Three rules make it safe, and all three are the reason this is not a
   * one-line option:
   *
   *   - **It never moves focus *into* the group.** Focus follows the cursor
   *     only when the keyboard is already standing on one of these items, so
   *     hovering a list while typing in a filter input above it cannot blur
   *     the input. See the README's "Hover as an input".
   *   - **It never scrolls.** The hovered item is under the cursor and is
   *     therefore already on screen; a scroll here would move the list out
   *     from under the mouse, which fires another hover.
   *   - **It reacts to the cursor moving, not to the document moving.**
   *     Arrowing through a long list scrolls it, so the item under a
   *     *stationary* cursor changes and the browser fires a pointer event
   *     for it. Acting on that yanks the highlight back to the mouse on every
   *     keystroke. See `hover.ts`.
   *
   * Moves are reported with `reason: 'hover'`. A hovered item that the arrows
   * skip is not activated — the two lists always agree.
   */
  hover?: boolean
  /**
   * Keep focus on the host and track the item with `aria-activedescendant`.
   * Default `false` (roving tabindex). In this mode the browser scrolls
   * nothing at all, so the controlled scroll is not an improvement — it is
   * the only scroll there is.
   *
   * Focus is claimed for the host only from *inside* the group (a click lands
   * on the option, and the pointer means nothing unless the host holds the
   * focus) or from nowhere at all. Focus that is outside the group — a
   * combobox's text input, the button that opened this menu — is left exactly
   * where it is; separating the two is what this mode is for.
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
  skipDisabled: boolean
  hover: boolean
  activedescendant: boolean
  scroll: ResolvedScroll | null
  ref: KeyboardNavigationApiRef | undefined
  onNavigate: ((detail: KeyboardNavigationEventDetail) => void) | undefined
}
