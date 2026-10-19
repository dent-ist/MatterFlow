/**
 * Unit-test helper for the admin lists (#369): with the default Status the lists also ask for the one row the Status hides, so the last
 * call of a list API mock is no longer the request for the page. This returns the arguments of the last call that fetched a page
 * (`size` is the tenth argument of `listWorkflows` and `listStepDefinitions`; the hidden-count request asks for one row).
 */
export function lastMain(fn: { mock: { calls: unknown[][] } }): unknown[] | undefined {
  return fn.mock.calls.filter((c) => c[9] !== 1).at(-1);
}
