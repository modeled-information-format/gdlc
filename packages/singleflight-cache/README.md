# @github-sdlc-plugins/singleflight-cache

A tiny, domain-free per-key singleflight-promise-cache helper: get-or-create
an in-flight promise, cache it, self-evict only on rejection (no TTL on a
resolved entry). Concurrent callers for the same not-yet-resolved key share
one in-flight computation instead of each firing their own.

Extracted from the near-identical implementations that had accumulated in
`github-sdlc-planning`'s `resolvers.ts` (`issueTypesCache`) and
`github-org-identity`'s `roles.ts` (`orgPlanSupportCache`) — see
[gdlc#130](https://github.com/modeled-information-format/gdlc/issues/130).

Carries no MCP, GitHub, or MIF domain logic, so a consuming plugin's
dependency on this package is a plain generic-utility dependency, not a
dependency on another plugin's domain machinery.

## Usage

```ts
import { singleflightCache } from '@github-sdlc-plugins/singleflight-cache';

const cache = new Map<string, Promise<Widget>>();

async function fetchWidget(id: string): Promise<Widget> {
  return singleflightCache(cache, id, () => fetchWidgetFromApi(id));
}

// Callers that need a reset (e.g. between test cases) own the Map and clear
// it directly:
export function resetWidgetCacheForTests(): void {
  cache.clear();
}
```
