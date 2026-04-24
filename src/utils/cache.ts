export function trimCache<K, V>(cache: Map<K, V>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value

    if (oldestKey === undefined) {
      return
    }

    cache.delete(oldestKey)
  }
}
