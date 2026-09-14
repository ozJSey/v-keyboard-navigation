/**
 * Build entry — a re-export barrel over `src/`, nothing else.
 *
 * Most people copy these files into their project rather than installing the
 * package, so the module split *is* the distribution. `ARCHITECTURE.md`,
 * beside this file at the package root, names what each module owns.
 */
export * from './src/index'
export { default } from './src/index'
