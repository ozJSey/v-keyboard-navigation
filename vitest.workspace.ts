import { defineWorkspace } from 'vitest/config'

/**
 * Two projects:
 *
 *   - `jsdom` — the directive suite. jsdom has no layout, so anything
 *     geometric (the scroll maths, `pageStep`) is tested against stated
 *     boxes, and the real thing is measured in a browser by
 *     `playground/scripts/interactions/v-keyboard-navigation.mjs`.
 *
 *   - `ssr-node` — `environment: 'node'`, no DOM globals at all, proving the
 *     package imports and installs server-side.
 */
export default defineWorkspace([
  {
    test: {
      name: 'jsdom',
      environment: 'jsdom',
      include: ['vKeyboardNavigation.test.ts'],
    },
  },
  {
    test: {
      name: 'ssr-node',
      environment: 'node',
      include: ['vKeyboardNavigation.ssr.test.ts'],
    },
  },
])
