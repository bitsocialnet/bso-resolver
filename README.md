# @bitsocial/bso-resolver

Resolve `.bso` and `.eth` domain names via ENS `bitsocial` TXT records.

`.bso` is an alias for `.eth` -- names are normalized before resolution.

## Install

```bash
npm install @bitsocial/bso-resolver
```

Or install directly from git:

```bash
npm install git+ssh://git@github.com:bitsocialhq/bso-resolver.git
```

## Usage

```ts
import { resolveBso, canResolveBso } from "@bitsocial/bso-resolver";

// Check if a name can be resolved
canResolveBso({ name: "example.bso" }); // true
canResolveBso({ name: "example.eth" }); // true
canResolveBso({ name: "example.com" }); // false

// Resolve using viem's default public transport
const record = await resolveBso({ name: "example.bso", provider: "viem" });
// { publicKey: "12D3KooW..." } or { publicKey: "12D3KooW...", name: "memes.bso", ... }

// Resolve using a custom RPC URL
const record2 = await resolveBso({
  name: "example.eth",
  provider: "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
});

// Optional cancellation with AbortController
const controller = new AbortController();
const record3 = await resolveBso({
  name: "example.bso",
  provider: "viem",
  abortSignal: controller.signal,
});
```

## With pkc-js

If you're wiring this into [`pkc-js`](https://github.com/pkc/pkc-js), register one resolver object per provider:

```ts
import Pkc from "@pkc/pkc-js";
import { canResolveBso, resolveBso } from "@bitsocial/bso-resolver";

const ethProviders = [
  "viem",
  "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
];

const pkc = await Pkc({
  nameResolvers: ethProviders.map((provider) => ({
    key: provider === "viem" ? "eth-viem" : `eth-${new URL(provider).hostname}`,
    canResolve: canResolveBso,
    resolve: resolveBso,
    provider,
  })),
});
```

This matches the `pkc-js` resolver shape: `{ key, canResolve, resolve, provider }`.

If you're still on `@plebbit/plebbit-js`, the same `nameResolvers` setup applies there too; only the package/import name differs.

## API

### `canResolveBso({ name: string }): boolean`

Returns `true` if the name ends with `.bso` or `.eth` (case-insensitive).

### `resolveBso({ name: string, provider: string, abortSignal?: AbortSignal }): Promise<{ publicKey: string, ...otherFields } | undefined>`

Resolves a `.bso` or `.eth` name by looking up the `bitsocial` TXT record on ENS.

This is a breaking API change from the earlier raw-string return type.

- **`name`** - The domain name to resolve (e.g. `"example.bso"`, `"example.eth"`)
- **`provider`** - Either `"viem"` for the default public transport, or an HTTP(S) RPC URL
- **`abortSignal`** (optional) - Abort signal used to cancel an in-flight resolve

Returns a parsed object from the `bitsocial` TXT record, or `undefined` if not found.

Supported TXT value formats:
- Legacy: `<ipnsPublicKey>` -> `{ publicKey }`
- Extended: `<ipnsPublicKey>;key=value;other=value` -> `{ publicKey, key, other }`

### `isBsoAliasDomain(address: string): boolean`

Returns `true` if the address ends with `.bso` or `.eth`.

### `normalizeBsoAliasDomain(address: string): string`

Converts a `.bso` suffix to `.eth`. Leaves `.eth` addresses unchanged.

### `createBsoResolver({ provider, dataPath? }): Resolver`

Creates a stateful resolver with a singleton viem client and persistent cache. Both are lazily initialized on the first `resolve()` call and persist for the lifetime of the resolver.

```ts
import { createBsoResolver } from "@bitsocial/bso-resolver";

const resolver = createBsoResolver({
  provider: "viem",
  dataPath: "/path/to/data", // optional — enables SQLite persistence
});

const result = await resolver.resolve({ name: "example.bso", provider: "viem" });
// { publicKey: "12D3KooW...", ... }
```

Returns an object compatible with plebbit-js's `NameResolverSchema`.

**Cache behavior:**

| Environment | `dataPath` provided? | Cache backend |
|---|---|---|
| Node | Yes | SQLite via `better-sqlite3` (stored at `<dataPath>/.bso-resolver/bso-cache.sqlite`) |
| Browser | No | IndexedDB (`bso-resolver-cache` database) |
| Any | No + no IndexedDB | In-memory `Map` |

All cache entries expire after 1 hour (TTL).

## Publishing to npm

This package is not yet published to npm. To set up automated publishing:

1. Create the `@bitsocial` organization on [npmjs.com](https://www.npmjs.com)
2. Do an initial manual publish: `npm login && npm run build && npm publish --access public`
3. On npmjs.com, go to the package settings → Publishing access → Configure trusted publishing
4. Add: owner=`bitsocialhq`, repo=`bso-resolver`, workflow=`publish.yml`
5. Apply the stashed changes (`git stash pop`) which add the `.github/workflows/publish.yml` workflow and `publishConfig` to `package.json`

After setup, releases created by `release-it` will automatically trigger npm publishing with provenance via OIDC trusted publishing.

## Future Considerations

- WebSocket provider lifecycle/cancellation support is intentionally deferred.

## License

GPL-2.0-only
