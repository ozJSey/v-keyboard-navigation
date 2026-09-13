/**
 * Build entry — a re-export barrel over `src/`, nothing else.
 *
 * Most people copy these files into their project rather than installing the
 * package, so the module split *is* the distribution. `src/ARCHITECTURE.md`
 * at the repo root names what each file owns.
 */
export * from './src/index'
export { default } from './src/index'
