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

### `new BsoResolver({ key, provider })`

Creates a resolver instance with a viem client. The client is lazily initialized on the first `resolve()` call.

- **`key`** - Unique identifier for this resolver instance (e.g. `` `bso-${new URL(chainProviderUrl).origin}` `` — `origin` keeps the scheme so `https://…` and `wss://…` to the same host don't collide)
- **`provider`** - Either `"viem"` for the default public transport, or an HTTP(S) RPC URL or a Websocket RPC URL

```ts
const resolver = new BsoResolver({
  key: "bso-viem",
  provider: "viem",
});
```

> **Caching is not handled here.** This module is a thin network wrapper. Callers (such as `pkc-js`) are responsible for caching resolution results. Every call to `resolve()` makes a fresh RPC request.

#### `resolver.resolve({ name, abortSignal? }): Promise<BsoResolveResult | undefined>`

Resolves a `.bso` name by looking up the `bitsocial` TXT record.

- **`name`** - The domain name to resolve (e.g. `"example.bso"`)
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
