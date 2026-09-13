/**
 * Public surface. Internals — items, roving, keys, typeahead, paging, scroll,
 * state, resolve — stay un-exported: they are there to be read and copied,
 * not to be depended on.
 */
export { vKeyboardNavigation, default } from './directive'
export { DIRECTIVE_NAME, KeyboardNavigationPlugin } from './plugin'
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
