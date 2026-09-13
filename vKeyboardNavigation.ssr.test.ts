/**
 * Node environment, no jsdom: no `window`, no `document`, no
 * `MutationObserver`. Proves the package can be imported and installed on a
 * server without touching the DOM — Vue runs directive hooks client-side by
 * contract, so nothing here should need a guard.
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import {
  DIRECTIVE_NAME,
  KeyboardNavigationPlugin,
  vKeyboardNavigation,
} from './vKeyboardNavigation'

describe('server-side import', () => {
  it('has no DOM globals to lean on', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof MutationObserver).toBe('undefined')
  })

  it('installs without touching the DOM', () => {
    const app = createSSRApp({ render: () => h('div') })
    expect(() => app.use(KeyboardNavigationPlugin)).not.toThrow()
    expect(app.directive(DIRECTIVE_NAME)).toBe(vKeyboardNavigation)
  })

  it('exposes only the client hooks, so nothing runs during render', () => {
    expect(typeof vKeyboardNavigation.mounted).toBe('function')
    expect(typeof vKeyboardNavigation.updated).toBe('function')
    expect(typeof vKeyboardNavigation.unmounted).toBe('function')
    expect(vKeyboardNavigation.created).toBeUndefined()
    expect(vKeyboardNavigation.getSSRProps).toBeUndefined()
  })
})
