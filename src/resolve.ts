/**
 * Binding value + the host's own attributes → one resolved options object.
 *
 * Re-run on every sync, so changing `role` or `aria-orientation` at runtime
 * takes effect without remounting. Reads the host; never writes to it.
 */
import { FOCUSABLE_SELECTOR } from './items'
import { isKnownRole, NO_ROLE_DEFAULTS, ROLE_DEFAULTS } from './roles'
import type {
  KeyboardNavigationAxis,
  KeyboardNavigationBinding,
  KeyboardNavigationOptions,
  ResolvedOptions,
  ResolvedScroll,
} from './types'

const DEFAULT_SCROLL: ResolvedScroll = {
  container: undefined,
  offset: undefined,
  behavior: 'instant',
  block: 'nearest',
  inline: 'nearest',
}

function axisFrom(value: string | null): KeyboardNavigationAxis | null {
  if (value === 'horizontal' || value === 'inline') return 'inline'
  if (value === 'vertical' || value === 'block') return 'block'
  if (value === 'both') return 'both'
  return null
}

export function resolve(
  host: HTMLElement,
  raw: KeyboardNavigationBinding | undefined,
): ResolvedOptions {
  const opts: KeyboardNavigationOptions = typeof raw === 'string' ? { role: raw } : (raw ?? {})

  const roleAttr = host.getAttribute('role')
  const role = opts.role ?? (isKnownRole(roleAttr) ? roleAttr : null)
  const defaults = role ? ROLE_DEFAULTS[role] : NO_ROLE_DEFAULTS

  const axis =
    axisFrom(opts.orientation ?? null) ??
    axisFrom(host.getAttribute('aria-orientation')) ??
    defaults.axis

  const wrap =
    opts.wrap === undefined
      ? defaults.wrap
      : typeof opts.wrap === 'boolean'
        ? opts.wrap
        : opts.wrap === 'wrap'

  const scroll: ResolvedScroll | null =
    opts.scroll === false
      ? null
      : typeof opts.scroll === 'object'
        ? { ...DEFAULT_SCROLL, ...opts.scroll }
        : DEFAULT_SCROLL

  return {
    enabled: opts.enabled ?? true,
    role,
    axis,
    wrap,
    itemSelector: opts.items ?? FOCUSABLE_SELECTOR,
    memory: opts.memory ?? true,
    typeahead: opts.typeahead ?? true,
    typeaheadTimeout: opts.typeaheadTimeout ?? 500,
    homeEnd: opts.homeEnd ?? true,
    page: opts.page ?? true,
    skipDisabled: opts.skipDisabled ?? defaults.skipDisabled,
    hover: opts.hover ?? false,
    activedescendant: opts.activedescendant ?? false,
    scroll,
    ref: opts.ref,
    onNavigate: opts.onNavigate,
  }
}
