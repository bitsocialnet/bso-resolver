# @bitsocial/bso-resolver

Resolve `.bso` domain names via `bitsocial` TXT records.

## Install

```bash
npm install @bitsocial/bso-resolver
```



## With pkc-js

If you're wiring this into [`pkc-js`](https://github.com/pkcprotocol/pkc-js), create resolver instances per provider:

```ts
import Pkc from "@pkcprotocol/pkc-js";
import { BsoResolver } from "@bitsocial/bso-resolver";

const chainProviderUrls = [
  "https://eth.drpc.org", // see "Recommended chain providers" below
  "https://mainnet.infura.io/v3/YOUR_KEY",
  "wss://mainnet.infura.io/ws/v3/YOUR_KEY",
];

const resolvers = chainProviderUrls.map((url) => new BsoResolver({
  key: `bso-${new URL(url).origin}`,
  provider: url,
}));

const pkc = await Pkc({ nameResolvers: resolvers });

// Access a resolver instance later, it should not be needed in general:
const resolver = pkc.clients.nameResolvers["bso-https://eth.drpc.org"].resolver;

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
resolver.canResolve({ name: "example.com" }); // false

// Resolve a name
const record = await resolver.resolve({ name: "example.bso" });
// BsoResolveResult | undefined

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

// Optional: pin resolution to a historical block for deterministic reads
// (must be >= 23085558, the block where the ENS universal resolver was deployed)
const record3 = await resolver.resolve({
  name: "example.bso",
  blockNumber: 23500000n,
});

// Clean up when done
await resolver.destroy();
await resolver2.destroy();
```

## Recommended chain providers

The following free public mainnet RPCs have been verified to resolve `.bso` names reliably (verified 2026-04-19):

- `https://eth.drpc.org`
- `https://ethereum.publicnode.com`
- `https://ethereum-rpc.publicnode.com`
- `https://rpc.mevblocker.io`
- `https://1rpc.io/eth`
- `https://eth-pokt.nodies.app`

## API

### `new BsoResolver({ key, provider, batch? })`

Creates a resolver instance with a viem client. The client is lazily initialized on the first `resolve()` call.

- **`key`** - Unique identifier for this resolver instance (e.g. `` `bso-${new URL(chainProviderUrl).origin}` `` — `origin` keeps the scheme so `https://…` and `wss://…` to the same host don't collide)
- **`provider`** - Either `"viem"` for the default public transport, or an HTTP(S) RPC URL or a Websocket RPC URL
- **`batch`** (optional) - Multicall batching of concurrent resolves. Defaults to `{ wait: 200, batchSize: 100_000 }`. Pass `false` to disable, or an object to tune (see [Batching](#batching))

```ts
const resolver = new BsoResolver({
  key: "bso-viem",
  provider: "viem",
});
```

> **Caching is not handled here.** This module is a thin network wrapper. Callers (such as `pkc-js`) are responsible for caching resolution results. Every call to `resolve()` makes a fresh RPC request.

#### `resolver.resolve({ name, blockNumber?, abortSignal? }): Promise<BsoResolveResult | undefined>`

Resolves a `.bso` name by looking up the `bitsocial` TXT record.

- **`name`** - The domain name to resolve (e.g. `"example.bso"`)
- **`blockNumber`** (optional) - `bigint` block number to pin the text-record read to a canonical historical block. When omitted, resolves at head (`'latest'`). Useful when independent verifiers must read the same registry state deterministically. Must be `>= 23085558` — viem resolves through the ENS universal resolver, which was deployed at that block, and throws `ChainDoesNotSupportContract` for older blocks.
- **`abortSignal`** (optional) - Abort signal used to cancel an in-flight resolve

Returns a [`BsoResolveResult`](#return-type-bsoresolveresult), or `undefined` if not found.

`undefined` specifically means the lookup completed successfully but no `bitsocial` TXT record exists for `name` — either the name itself does not exist, or it exists but has no `bitsocial` text record set. Network/RPC failures and malformed TXT records throw rather than return `undefined`, so callers that need to distinguish "not found" from "lookup failed" should both `try/catch` and check for `result === undefined`.

TXT value format: `<ipnsPublicKey>[;key=value;other=value]` -> `{ publicKey, key, other }`

##### Return type: `BsoResolveResult`

```ts
interface BsoResolveResult {
  /** Required. The IPNS public key from the first segment of the
   *  `bitsocial` TXT record. */
  publicKey: string;
  /** Custom metadata from key=value segments in the TXT record.
   *  Reserved key: publicKey. */
  [key: string]: string;
}
```

> **Note:** Each `bitsocial` TXT record value points to a single identity — either a community or an author. A future revision of the format may allow both in the same record.

#### `resolver.canResolve({ name }): boolean`

Returns `true` if the name ends with `.bso` (case-insensitive).

#### `resolver.destroy(): Promise<void>`

Aborts in-flight resolves, closes the WebSocket connection (if any), and releases the viem client. Idempotent — safe to call multiple times.

After `destroy()`, calling `resolve()` will throw.

## Batching

Concurrent `resolve()` calls on the same resolver instance are batched into a single `Multicall3.aggregate3` `eth_call` (via viem's client-level multicall batching). Public RPC endpoints rate-limit exactly the burst pattern that name resolution produces (many small `eth_call`s in a short window), so batching reduces the possibility of RPC throttling — on a production cold start it cut 63 RPC requests down to 6 with identical results.

The default is `{ wait: 200, batchSize: 100_000 }`:

- **`wait`** - Milliseconds to wait for more concurrent resolves before flushing the batch. Each resolve pays up to this much extra latency, which is acceptable because name resolution is a background path whose results are cached by the caller. Same semantics as viem's `batch.multicall.wait`.
- **`batchSize`** - Maximum calldata size in bytes before a batch is split. Each resolve is ~500-600 bytes, so viem's default of 1024 would split after ~2 calls; the large default effectively means "never split". Same semantics as viem's `batch.multicall.batchSize`.

```ts
// Default: batch concurrent resolves within a 200ms window
new BsoResolver({ key, provider });

// Only coalesce resolves issued in the same tick (no added latency)
new BsoResolver({ key, provider, batch: { wait: 0 } });

// Disable batching: every resolve is an individual eth_call immediately
new BsoResolver({ key, provider, batch: false });
```

Notes:

- Resolves pinned to a `blockNumber` only batch with other resolves at the same block; resolves at different blocks are never merged.
- Each call in the batch is independent (`allowFailure: true`) — one failing name does not poison the batch, and CCIP-read (offchain) names keep working.
- If the batched RPC call itself fails, all names in that batch fail together; callers like `pkc-js` fall back to the next provider per name, where they re-batch.

## Caching

This module does not cache. Every call to `resolve()` makes a fresh RPC request to the configured provider. Caching is the consumer's responsibility — `pkc-js` (the primary consumer) maintains a persistent name-resolution cache with per-call freshness control and is the right layer for that policy.

## Testing

Run the full test suite with:

```bash
npm test
```

Install the Playwright browser binaries used by the browser suite with:

```bash
npm run test:browser:install
```

Run the browser suite on Playwright's Chromium and Firefox engines with:

```bash
npm run test:browser
```

On Linux CI or fresh machines, Playwright may also require:

```bash
npx playwright install --with-deps chromium firefox
```

## Entry Points

The package publishes separate Node and browser entry points.

- Browser-aware bundlers should resolve the root package import to the browser build automatically.
- Explicit subpaths are also available:
  - `@bitsocial/bso-resolver/browser`
  - `@bitsocial/bso-resolver/node`

## Publishing to npm

Publishing is automated via `.github/workflows/publish.yml`. When `release-it` creates a GitHub release (triggered by CI on `main`), the publish workflow builds and publishes to npm with `--provenance`.

### First-time setup

1. Create the `@bitsocial` organization on [npmjs.com](https://www.npmjs.com)
2. Do an initial manual publish: `npm login && npm run build && npm publish --access public`
3. On npmjs.com, go to the package settings → Publishing access → Configure trusted publishing
4. Add: owner=`bitsocialnet`, repo=`bso-resolver`, workflow=`publish.yml`

## License

GPL-2.0-only
