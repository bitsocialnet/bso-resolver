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

## With pkc-js

If you're wiring this into [`pkc-js`](https://github.com/pkc/pkc-js), create resolver instances per provider:

```ts
import Pkc from "@pkc/pkc-js";
import { BsoResolver } from "@bitsocial/bso-resolver";

const chainProviderUrls = [
  "viem",
  "https://mainnet.infura.io/v3/YOUR_KEY",
];

const resolvers = chainProviderUrls.map((url) => new BsoResolver({
  key: `bso-${url === "viem" ? "viem" : new URL(url).hostname}`,
  provider: url,
}));

const pkc = await Pkc({ nameResolvers: resolvers });

// Later, when shutting down:
await pkc.destroy(); // should cascade to resolver.destroy() for each resolver
```

## Usage

```ts
import { BsoResolver } from "@bitsocial/bso-resolver";

// Create a resolver instance
const resolver = new BsoResolver({ key: "bso-viem", provider: "viem" });

// Check if a name can be resolved
resolver.canResolve({ name: "example.bso" }); // true
resolver.canResolve({ name: "example.eth" }); // true
resolver.canResolve({ name: "example.com" }); // false

// Resolve a name
const record = await resolver.resolve({ name: "example.bso" });
// { publicKey: "12D3KooW...", ...otherPotentialFieldsInTheFuture }

// Resolve using a custom RPC URL
const resolver2 = new BsoResolver({
  key: "bso-infura",
  provider: "https://mainnet.infura.io/v3/YOUR_KEY",
});

// Optional cancellation with AbortController
const controller = new AbortController();
const record2 = await resolver.resolve({
  name: "example.bso",
  abortSignal: controller.signal,
});

// Clean up when done
await resolver.destroy();
await resolver2.destroy();
```

## API

### `new BsoResolver({ key, provider, dataPath? })`

Creates a resolver instance with a shared viem client and persistent cache. Both are lazily initialized on the first `resolve()` call.

- **`key`** - Unique identifier for this resolver instance (e.g. `` `bso-${new URL(chainProviderUrl).hostname}` ``)
- **`provider`** - Either `"viem"` for the default public transport, or an HTTP(S) RPC URL
- **`dataPath`** (optional) - Enables SQLite persistence for the cache

```ts
const resolver = new BsoResolver({
  key: "bso-viem",
  provider: "viem",
  dataPath: "/path/to/data", // optional — enables SQLite persistence
});
```

#### `resolver.resolve({ name, abortSignal? }): Promise<{ publicKey: string, ...otherFields } | undefined>`

Resolves a `.bso` or `.eth` name by looking up the `bitsocial` TXT record on ENS.

- **`name`** - The domain name to resolve (e.g. `"example.bso"`, `"example.eth"`)
- **`abortSignal`** (optional) - Abort signal used to cancel an in-flight resolve

Returns a parsed object from the `bitsocial` TXT record, or `undefined` if not found.

Supported TXT value formats:
- Legacy: `<ipnsPublicKey>` -> `{ publicKey }`
- Extended: `<ipnsPublicKey>;key=value;other=value` -> `{ publicKey, key, other }`

#### `resolver.canResolve({ name }): boolean`

Returns `true` if the name ends with `.bso` or `.eth` (case-insensitive).

#### `resolver.destroy(): Promise<void>`

Releases shared resources (viem client, cache/DB connection). The underlying resource is only closed when the last resolver using it is destroyed. Idempotent — safe to call multiple times.

After `destroy()`, calling `resolve()` will throw.

### `canResolveBso({ name: string }): boolean`

Returns `true` if the name ends with `.bso` or `.eth` (case-insensitive).

### `isBsoAliasDomain(address: string): boolean`

Returns `true` if the address ends with `.bso` or `.eth`.

### `normalizeBsoAliasDomain(address: string): string`

Converts a `.bso` suffix to `.eth`. Leaves `.eth` addresses unchanged.

## Cache behavior

| Environment | `dataPath` provided? | Cache backend |
|---|---|---|
| Node | Yes | SQLite via `better-sqlite3` (stored at `<dataPath>/.bso-resolver/bso-cache.sqlite`) |
| Browser | No | IndexedDB (`bso-resolver-cache` database) |
| Any | No + no IndexedDB | In-memory `Map` |

All cache entries expire after 1 hour (TTL).

## Concurrency

### Same process, multiple resolvers, same provider

Resolvers share a single viem client via an internal reference-counted registry. No conflicts.

### Same process, multiple resolvers, same `dataPath`

Resolvers share a single SQLite connection via an internal reference-counted registry. All operations go through the same `better-sqlite3` instance (synchronous, single-threaded). No conflicts.

### Multiple processes, same SQLite database file

Each process opens its own connection. SQLite WAL mode allows concurrent reads. Writes are serialized by SQLite internally with a 5-second busy timeout (`busy_timeout = 5000`). Cache writes are simple `INSERT OR REPLACE` operations that complete in microseconds, so contention is negligible.

### Multiple browser tabs, same IndexedDB

IndexedDB handles concurrency natively via transactions. No conflicts.

### Lifecycle / cleanup

Call `resolver.destroy()` when done. Resources (DB connections, client references) are released when the last resolver using them is destroyed. Calling `destroy()` is idempotent and safe to call multiple times.

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
