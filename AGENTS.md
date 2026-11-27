# AGENTS.md

## Package Manager

npm

## Commands

- `npm run build` - Build with tsup (ESM + types)
- `npm test` - Run tests with vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run typecheck` - Type-check `src/` and the type tests (`tsconfig.test.json`)

## Workflow

After any change to `src/` or `package.json`, run `npm test` to make sure nothing is broken.
Make sure to add tests to reproduce reported bugs before fixing them
Make sure to add tests when you add new features

## Conventions

- **ESM only** - No CommonJS. `"type": "module"` in package.json.
- **Node >= 22** required
- **Browser + Node compatible** - No Node-specific APIs in source
- **Object parameter convention** - Public functions accept `{ name, provider }`, not positional args
- **`"bitsocial"` TXT record key** - This is a protocol-level constant, not configurable
- **Fully typed TypeScript** with `strict: true`
- **Add tests** for all new features and bug fixes
- **Exact dependency versions** - No `^` or `~` prefixes in package.json. Exception: `peerDependencies` use a lower-bound range (`>=x.y.z`), since an exact peer would force every consumer onto one pkc-js version (and `^0.0.x` matches a single version only).
- **Loggers come from the caller** - Never create a module-level logger. `resolve()` and `destroy()` log only through the `log` they are passed (pkc-js passes its own). `@pkcprotocol/pkc-logger` is a devDependency for its `Logger` type, which tsup inlines into the published `.d.ts` (`test/node/published-types.test.ts` checks this). Log the provider via `providerHost()`, never the full URL: it often carries an API key.
- **One resolver per provider URL** - Do not create multiple BsoResolver instances with the same provider URL. Each resolver owns its transport connection and closes it on destroy().
- **`BsoResolveResult` docs** - `src/runtime/shared/resolver.ts` (`BsoResolveResult` interface) is the source of truth for the return type of `resolver.resolve()`. Keep README's "Return type: BsoResolveResult" subsection in sync when the interface changes.
