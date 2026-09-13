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
}

/**
 * Wrap follows the APG: a toolbar and a listbox clamp at the ends (the user
 * needs to feel where the list stops), a menu / menubar / tablist / radio
 * group cycles.
 */
export const ROLE_DEFAULTS: Record<KeyboardNavigationRole, RoleDefaults> = {
  toolbar: { axis: 'inline', wrap: false },
  tablist: { axis: 'inline', wrap: true },
  menubar: { axis: 'inline', wrap: true },
  menu: { axis: 'block', wrap: true },
  listbox: { axis: 'block', wrap: false },
  radiogroup: { axis: 'both', wrap: true },
}

/**
 * With no role there is no pattern to follow: bind both axes (the platform's
 * own `focusgroup` does the same) and clamp, because a silent jump from the
 * last item back to the first is the more surprising of the two.
 */
export const NO_ROLE_DEFAULTS: RoleDefaults = { axis: 'both', wrap: false }

export function isKnownRole(value: string | null): value is KeyboardNavigationRole {
  return value !== null && value in ROLE_DEFAULTS
}
