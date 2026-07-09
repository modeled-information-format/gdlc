/**
 * Get-or-create the in-flight promise for `key` in `cache`, computing it via
 * `compute()` if absent. Concurrent callers for the same not-yet-resolved
 * key share the one in-flight promise instead of each firing their own
 * compute. A rejection self-evicts its entry so the next call retries; a
 * resolved value is never evicted (no TTL) — callers that need a reset
 * (e.g. between test cases) own their `cache` Map and can clear it directly.
 */
export async function singleflightCache(cache, key, compute) {
    let cached = cache.get(key);
    if (!cached) {
        cached = compute();
        cached.catch(() => cache.delete(key));
        cache.set(key, cached);
    }
    return cached;
}
//# sourceMappingURL=index.js.map