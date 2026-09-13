/**
 * The imperative handle, for the cases a keyboard cannot reach: opening a
 * menu and landing on its first item, restoring a selection after a fetch,
 * driving the group from a toolbar button.
 *
 * Shallow-reactive on purpose. A deep `reactive` would hand back proxies of
 * the DOM elements themselves, so `api.activeItem === myRef.value` would be
 * false and every identity check a consumer writes would quietly fail.
 */
import { shallowReactive } from 'vue'
import { activate, indexAfter, sync } from './roving'
import type { Group } from './state'
import type { KeyboardNavigationApi } from './types'

/**
 * Takes a getter rather than the group, because the group holds the api it is
 * being handed — the one place in this package where the dependency has to
 * point back up, and it is injected instead of imported.
 */
export function createApi(getGroup: () => Group): KeyboardNavigationApi {
  const move = (delta: number): void => {
    const group = getGroup()
    activate(group, indexAfter(group, delta, group.opts.wrap), 'api')
  }

  return shallowReactive<KeyboardNavigationApi>({
    items: [],
    activeIndex: -1,
    activeItem: null,
    focus(index: number) {
      activate(getGroup(), index, 'api')
    },
    next() {
      move(1)
    },
    previous() {
      move(-1)
    },
    first() {
      activate(getGroup(), 0, 'api')
    },
    last() {
      const group = getGroup()
      activate(group, group.items.length - 1, 'api')
    },
    refresh() {
      sync(getGroup())
    },
  })
}
