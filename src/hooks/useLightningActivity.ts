import { useEffect, useState } from 'react'
import { fetchLightningActivity } from '../services/lightningActivity'
import type { LightningActivityFeature } from '../types/weather'

const lightningRefreshMs = 5 * 60 * 1000

export function useLightningActivity(enabled: boolean) {
  const [features, setFeatures] = useState<LightningActivityFeature[]>([])
  const [observedAt, setObservedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setFeatures([])
      setObservedAt(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    async function loadLightningActivity() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetchLightningActivity()

        if (cancelled) {
          return
        }

        setFeatures(response.features)
        setObservedAt(response.observedAt)
      } catch (fetchError) {
        if (cancelled) {
          return
        }

        setFeatures([])
        setObservedAt(null)
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Lightning activity unavailable',
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadLightningActivity()
    const intervalId = window.setInterval(loadLightningActivity, lightningRefreshMs)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [enabled])

  return {
    features,
    observedAt,
    loading,
    error,
  }
}
