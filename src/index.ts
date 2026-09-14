/**
 * Public surface. Internals — items, roving, keys, typeahead, paging, scroll,
 * state, resolve — stay un-exported: they are there to be read and copied,
 * not to be depended on.
 */
export { vKeyboardNavigation, default } from './directive'
export { DIRECTIVE_NAME, KeyboardNavigationPlugin } from './plugin'
// The per-role defaults table, exported as data so documentation — the
// README's table, the playground's card — cannot drift from the code.
export { NO_ROLE_DEFAULTS, ROLE_DEFAULTS, type RoleDefaults } from './roles'
// The opt-out selector, so a consumer can assert against the same string the
// directive matches rather than retyping `focusgroup="none"`.
export { OPT_OUT_SELECTOR } from './items'
export type {
  KeyboardNavigationApi,
  KeyboardNavigationApiRef,
  KeyboardNavigationAxis,
  KeyboardNavigationBinding,
  KeyboardNavigationContainer,
  KeyboardNavigationEventDetail,
  KeyboardNavigationOptions,
  KeyboardNavigationReason,
  KeyboardNavigationRole,
  KeyboardNavigationScrollOptions,
  KeyboardNavigationState,
  KeyboardNavigationWrap,
} from './types'
