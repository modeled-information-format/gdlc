/**
 * Get-or-create the in-flight promise for `key` in `cache`, computing it via
 * `compute()` if absent. Concurrent callers for the same not-yet-resolved
 * key share the one in-flight promise instead of each firing their own
 * compute. A rejection self-evicts its entry so the next call retries; a
 * resolved value is never evicted (no TTL) — callers that need a reset
 * (e.g. between test cases) own their `cache` Map and can clear it directly.
 *
 * The eviction only removes the entry if it's still the same promise this
 * call created (Copilot review finding on gdlc#130's PR): a bare
 * `cache.delete(key)` would otherwise let a stale rejection race a
 * concurrent external reset (e.g. a test-reset helper clearing the cache)
 * and delete a newer, unrelated in-flight entry for the same key.
 */
export async function singleflightCache(cache, key, compute) {
    const existing = cache.get(key);
    if (existing)
        return existing;
    const created = compute();
    created.catch(() => {
        if (cache.get(key) === created)
            cache.delete(key);
    });
    cache.set(key, created);
    return created;
}
//# sourceMappingURL=index.js.map