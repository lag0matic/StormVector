import { useEffect, useState } from 'react'
import { fetchRecentLocalStormReports } from '../services/lsr'
import type { LocalStormReportFeature } from '../types/weather'

const LSR_POLL_MS = 5 * 60 * 1000

type LocalStormReportsState = {
  features: LocalStormReportFeature[]
  loading: boolean
  error: string | null
}

export function useLocalStormReports(enabled: boolean): LocalStormReportsState {
  const [state, setState] = useState<LocalStormReportsState>({
    features: [],
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState((current) => ({
        ...current,
        loading: false,
        error: null,
      }))
      return
    }

    const controller = new AbortController()
    let timeoutId: number | null = null

    const loadReports = async (background = false) => {
      if (!background) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const features = await fetchRecentLocalStormReports(controller.signal)

        if (controller.signal.aborted) {
          return
        }

        setState({
          features,
          loading: false,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setState((current) => ({
          features: current.features,
          loading: false,
          error: error instanceof Error ? error.message : 'LSR refresh failed.',
        }))
      } finally {
        if (!controller.signal.aborted) {
          timeoutId = window.setTimeout(() => {
            void loadReports(true)
          }, LSR_POLL_MS)
        }
      }
    }

    void loadReports(false)

    return () => {
      controller.abort()
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [enabled])

  return state
}
