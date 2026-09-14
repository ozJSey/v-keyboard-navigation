/**
 * The `focusgroup` vocabulary: which roles this directive knows, and what
 * each one implies when the consumer says nothing.
 *
 * Leaf module: imports types only. Nothing here writes to the DOM — a role is
 * read, never injected.
 */
import type { KeyboardNavigationAxis, KeyboardNavigationRole } from './types'

/** Defaults a role implies. `axis` follows ARIA's own default orientation. */
export interface RoleDefaults {
  axis: KeyboardNavigationAxis
  wrap: boolean
  skipDisabled: boolean
}

/**
 * Per-role defaults, exported so documentation cannot drift from the code.
 *
 * **`wrap`** follows the APG: a toolbar and a listbox clamp at the ends (the
 * user needs to feel where the list stops), a menu / menubar / tablist / radio
 * group cycles.
 *
 * **`skipDisabled`** decides whether `aria-disabled="true"` items are arrow
 * stops, and it is per-role because there is no single right answer. The APG's
 * guidance on the focusability of disabled controls is that keeping them
 * reachable is valuable where the *set of options is itself information* — the
 * case it makes for menus and menubars, where a user who never lands on
 * "Paste" never learns that pasting exists here at all. A listbox of two
 * hundred options, a tablist whose disabled tab has no panel to show, and a
 * toolbar of icon buttons are the other way round: stopping on a control that
 * does nothing is friction with no payoff. Native radio groups skip disabled
 * radios in the browser's own arrow handling, so `radiogroup` matches the
 * platform.
 *
 * Either way it is a default, not a rule: `skipDisabled` overrides it, and a
 * **natively `disabled`** control is never navigable under any setting because
 * the platform will not focus it.
 */
export const ROLE_DEFAULTS: Readonly<Record<KeyboardNavigationRole, RoleDefaults>> = {
  toolbar: { axis: 'inline', wrap: false, skipDisabled: true },
  tablist: { axis: 'inline', wrap: true, skipDisabled: true },
  menubar: { axis: 'inline', wrap: true, skipDisabled: false },
  menu: { axis: 'block', wrap: true, skipDisabled: false },
  listbox: { axis: 'block', wrap: false, skipDisabled: true },
  radiogroup: { axis: 'both', wrap: true, skipDisabled: true },
}

/**
 * With no role there is no pattern to follow: bind both axes (the platform's
 * own `focusgroup` does the same) and clamp, because a silent jump from the
 * last item back to the first is the more surprising of the two. Skipping
 * unavailable controls is the safer default when we do not know what the
 * widget is.
 */
export const NO_ROLE_DEFAULTS: RoleDefaults = { axis: 'both', wrap: false, skipDisabled: true }

export function isKnownRole(value: string | null): value is KeyboardNavigationRole {
  return value !== null && value in ROLE_DEFAULTS
}
