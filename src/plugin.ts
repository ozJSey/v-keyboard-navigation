/**
 * Plugin install path — `app.use(KeyboardNavigationPlugin)` registers the
 * directive under the kebab-case name `keyboard-navigation`.
 *
 * SSR-safe: `install` never touches the DOM.
 */
import type { App, Plugin } from 'vue'
import { vKeyboardNavigation } from './directive'

/** Public constant for the conventional Vue directive name. */
export const DIRECTIVE_NAME = 'keyboard-navigation' as const

export const KeyboardNavigationPlugin: Plugin = {
  install(app: App) {
    app.directive(DIRECTIVE_NAME, vKeyboardNavigation)
  },
}
