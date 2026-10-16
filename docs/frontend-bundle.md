# Frontend bundle size

The production build has an `initial` budget in `frontend/angular.json` (warning 700 kB, error 1 MB). The initial
total is `main` + the chunks it imports statically + `styles.css`. Keep it well under the warning line so features
have room; do not raise the budget to make a build pass.

## Measuring

```bash
cd frontend
npx ng build --stats-json          # prints "Initial total" (raw and estimated transfer) and writes dist/frontend/stats.json
```

`stats.json` is an esbuild metafile. Two ways to read it:

- Drop it on <https://esbuild.github.io/analyze/> for an interactive treemap.
- Walk the static import graph of the `main-*.js` output and sum `outputs[chunk].inputs[file].bytesInOutput` per
  package (`node_modules/<pkg>`) or per `src/app/<folder>`. Only chunks reachable through `import-statement` imports
  from `main` are initial; `dynamic-import` chunks are lazy.

Look at the packages first: a third-party package that is big in the initial graph but only used by one route is
the usual culprit.

## What was saved

| Change                                                                                                        | Initial raw |
| ------------------------------------------------------------------------------------------------------------- | ----------- |
| `AuraLite` (`core/theme/aura-lite.ts`): the PrimeNG theme preset contains only the components the app renders | -78.6 kB    |

Before: 699.91 kB raw / 172.99 kB transfer. After: 621.30 kB raw / 165.23 kB transfer.

`@primeuix/themes/aura` imports the token set of all ~100 PrimeNG components and the preset object is passed to
`providePrimeNG` in `app.config.ts`, so every token set landed in `main` (about 115 kB) even though the app renders
a dozen components. `AuraLite` imports the token sets one by one (`@primeuix/themes/aura/<component>`).
`core/theme/aura-lite.spec.ts` scans `src` and `projects/form-engine/src` for `primeng/*` imports, follows them
through PrimeNG itself, and fails when a themed component is missing from `AuraLite`. A component that is not
listed renders without its theme CSS, so when a new PrimeNG component is introduced, add its token set to
`aura-lite.ts` (the spec tells you which).

## Rules of thumb

- Check the number after every feature that adds an import to `app.config.ts`, `app.routes.ts`, the shell
  (`shared/layout`) or anything they import. Those are initial.
- Routes use `loadChildren` / `loadComponent`; do not import page components or feature barrels from the shell or
  from `core`.
- Never pass a whole library catalogue (preset, icon set, locale bundle) to a root provider; import the parts used.
- Dev-only code (stubs, in-memory APIs) selected with a runtime `environment` check is still bundled; prefer a lazy
  import or a file replacement in `angular.json` when it is large.
- Heavy things used on one screen (charts, editors, the generated api-client parts) belong in that route's chunk or
  behind `@defer`.
- Keep global `styles.scss` for tokens and resets; component styles go in the component (and have their own budget).
