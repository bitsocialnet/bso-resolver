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
const address = await resolveBso({ name: "example.bso", provider: "viem" });

// Resolve using a custom RPC URL
const address2 = await resolveBso({
  name: "example.eth",
  provider: "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
});

// Optional cancellation with AbortController
const controller = new AbortController();
const address3 = await resolveBso({
  name: "example.bso",
  provider: "viem",
  abortSignal: controller.signal,
});
```

## API

### `canResolveBso({ name: string }): boolean`

Returns `true` if the name ends with `.bso` or `.eth` (case-insensitive).

### `resolveBso({ name: string, provider: string, abortSignal?: AbortSignal }): Promise<string | undefined>`

Resolves a `.bso` or `.eth` name by looking up the `bitsocial` TXT record on ENS.

- **`name`** - The domain name to resolve (e.g. `"example.bso"`, `"example.eth"`)
- **`provider`** - Either `"viem"` for the default public transport, or an HTTP(S) RPC URL
- **`abortSignal`** (optional) - Abort signal used to cancel an in-flight resolve

Returns the TXT record value, or `undefined` if not found.

### `isBsoAliasDomain(address: string): boolean`

Returns `true` if the address ends with `.bso` or `.eth`.

### `normalizeBsoAliasDomain(address: string): string`

Converts a `.bso` suffix to `.eth`. Leaves `.eth` addresses unchanged.

## Publishing to npm

This package is not yet published to npm. To set up automated publishing:

1. Create the `@bitsocial` organization on [npmjs.com](https://www.npmjs.com)
2. Do an initial manual publish: `npm login && npm run build && npm publish --access public`
3. On npmjs.com, go to the package settings → Publishing access → Configure trusted publishing
4. Add: owner=`bitsocialhq`, repo=`bso-resolver`, workflow=`publish.yml`
5. Apply the stashed changes (`git stash pop`) which add the `.github/workflows/publish.yml` workflow and `publishConfig` to `package.json`

After setup, releases created by `release-it` will automatically trigger npm publishing with provenance via OIDC trusted publishing.

## Future Considerations

- Whether the resolver should maintain internal client caching (reuse viem `PublicClient` instances across calls for the same provider URL) for performance.
- The resolver is currently stateless and HTTP-only. WebSocket provider lifecycle/cancellation support is intentionally deferred.

## License

GPL-2.0-only
