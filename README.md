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
```

## API

### `canResolveBso({ name: string }): boolean`

Returns `true` if the name ends with `.bso` or `.eth` (case-insensitive).

### `resolveBso({ name: string, provider: string }): Promise<string | undefined>`

Resolves a `.bso` or `.eth` name by looking up the `bitsocial` TXT record on ENS.

- **`name`** - The domain name to resolve (e.g. `"example.bso"`, `"example.eth"`)
- **`provider`** - Either `"viem"` for the default public transport, or an RPC URL

Returns the TXT record value, or `undefined` if not found.

### `isEthAliasDomain(address: string): boolean`

Returns `true` if the address ends with `.bso` or `.eth`.

### `normalizeEthAliasDomain(address: string): string`

Converts a `.bso` suffix to `.eth`. Leaves `.eth` addresses unchanged.

## Future Considerations

- Whether the resolver should maintain internal client caching (reuse viem `PublicClient` instances across calls for the same provider URL) for performance.

## License

GPL-2.0-only
