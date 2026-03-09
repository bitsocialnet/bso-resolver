# AGENTS.md

## Package Manager

npm

## Commands

- `npm run build` - Build with tsup (ESM + types)
- `npm test` - Run tests with vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run typecheck` - Type-check with `tsc --noEmit`

## Workflow

After any change to `src/` or `package.json`, run `npm test` to make sure nothing is broken.

## Conventions

- **ESM only** - No CommonJS. `"type": "module"` in package.json.
- **Node >= 22** required
- **Browser + Node compatible** - No Node-specific APIs in source
- **Object parameter convention** - Public functions accept `{ name, provider }`, not positional args
- **`"bitsocial"` TXT record key** - This is a protocol-level constant, not configurable
- **Fully typed TypeScript** with `strict: true`
- **Add tests** for all new features and bug fixes
- **Exact dependency versions** - No `^` or `~` prefixes in package.json
