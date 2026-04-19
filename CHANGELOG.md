# Changelog

## [0.0.5](https://github.com/bitsocialnet/bso-resolver/compare/v0.0.4...v0.0.5) (2026-04-19)

## [0.0.4](https://github.com/bitsocialnet/bso-resolver/compare/v0.0.3...v0.0.4) (2026-04-10)

### Bug Fixes

* **ci:** fix npm trusted publishing failures ([6c6d9db](https://github.com/bitsocialnet/bso-resolver/commit/6c6d9db3ad84593c2097a643e254a506129272d7))
* trigger initial trusted publishing pipeline test ([ae62998](https://github.com/bitsocialnet/bso-resolver/commit/ae629980fb7cad70c724fd1f80f39e90c5f7d9e5))

## [0.0.3](https://github.com/bitsocialnet/bso-resolver/compare/v0.0.2...v0.0.3) (2026-04-08)

## 0.0.2 (2026-04-08)

### Features

* abort/destroy cancels connections, add WebSocket transport support ([22a68e5](https://github.com/bitsocialnet/bso-resolver/commit/22a68e5f632b66aba866c7958fa8e8bcfb9359b8))
* add abortSignal support to resolveBso ([923ced7](https://github.com/bitsocialnet/bso-resolver/commit/923ced740fe3a598562d1a447e77addd19d204ab))
* add automatic versioning with release-it and CI workflows ([76dca57](https://github.com/bitsocialnet/bso-resolver/commit/76dca574fbe7b4ab11ed1daec2f8945c4542d1a7))
* add browser runtime and Vitest Playwright tests ([6098de0](https://github.com/bitsocialnet/bso-resolver/commit/6098de0d15ea973625d538b0b5daaf0ef68e9e75))
* add createBsoResolver factory with caching and singleton client ([7410b32](https://github.com/bitsocialnet/bso-resolver/commit/7410b32eda7481e3d082822a74973498086ec404))
* add input validation and error context to resolveBso ([5255ff5](https://github.com/bitsocialnet/bso-resolver/commit/5255ff5e53d72849639c5e099027e94b2c4fe7a2))
* add persistent cache with SQLite and IndexedDB backends ([7d6ba9d](https://github.com/bitsocialnet/bso-resolver/commit/7d6ba9dd4ef8c085c229c994c551aff9f1a95e3d))
* refactor to BsoResolver class with destroy() and shared resource registries ([1e56e9f](https://github.com/bitsocialnet/bso-resolver/commit/1e56e9fec3f3747af45d6f4f8be15d0acc311a9b))
* return parsed object from resolveBso ([1491791](https://github.com/bitsocialnet/bso-resolver/commit/14917911f387eb66f28c8a1f07aa413d06c898e5))
* stale-while-revalidate cache with in-flight deduplication ([8412add](https://github.com/bitsocialnet/bso-resolver/commit/8412add2dd42174f8c63cdd2268c0c3e5080017f))

### Bug Fixes

* handle unhandled errors in destroy() and IndexedDB operations ([9972b26](https://github.com/bitsocialnet/bso-resolver/commit/9972b2661bf03c3b9aafaef3cbefd873c666cf44))
* resolve IndexedDB transactions on tx.oncomplete instead of request.onsuccess ([c3130b4](https://github.com/bitsocialnet/bso-resolver/commit/c3130b4c76c0d5df3ff56ab02115db3c0283f549))
