/**
 * npm package-name rules, in one place.
 *
 * Format 1 requires a plugin's `name` to be a valid npm package name, and the
 * two facts that make this a real check rather than a formality are both
 * present in the upstream data: 225 repository names in the current list carry
 * uppercase letters, and 271 names are shared by two or more owners. A name
 * that reaches the rendered document unchecked does not degrade the entry — it
 * fails the whole index.
 *
 * Shared by the resolver, which uses it to refuse a manifest early, and by the
 * renderer, which uses it to refuse a candidate. Duplicating the pattern would
 * let the two drift, and the drift would only show up as a published index
 * that DSH refuses to load.
 */

/** The npm package-name grammar, matching the format-1 validator. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

/** npm's own ceiling on package-name length. */
export const PACKAGE_NAME_MAX_LENGTH = 214

/**
 * Test a candidate package name.
 * @param name - the name to test.
 * @returns `undefined` when usable, otherwise why it is not.
 */
export function packageNameProblem(name: string): string | undefined {
  if (name.trim() === '') return 'package name is empty'
  if (name.length > PACKAGE_NAME_MAX_LENGTH) {
    return `package name exceeds ${String(PACKAGE_NAME_MAX_LENGTH)} characters`
  }
  if (!PACKAGE_NAME.test(name)) {
    return `not a valid npm package name: ${JSON.stringify(name)}`
  }
  return undefined
}
