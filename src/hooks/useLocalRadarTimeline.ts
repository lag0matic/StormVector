import { useEffect, useState } from 'react'
import {
  fetchRadarProductDefinition,
  type LocalRadarProduct,
  type RadarProductDefinition,
  type RadarSite,
} from '../services/radar'

const LOCAL_RADAR_POLL_MS = 120_000

type LocalRadarTimelineState = {
  definition: RadarProductDefinition | null
  frames: string[]
  loading: boolean
  error: string | null
}

export function useLocalRadarTimeline(
  site: RadarSite | null,
  product: LocalRadarProduct,
): LocalRadarTimelineState {
  const [state, setState] = useState<LocalRadarTimelineState>({
    definition: null,
    frames: [],
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!site) {
      setState({
        definition: null,
        frames: [],
        loading: false,
        error: null,
      })
      return
    }

    const controller = new AbortController()
    let timeoutId: number | null = null

    const loadDefinition = async (forceRefresh = false) => {
      if (!forceRefresh) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const definition = await fetchRadarProductDefinition(
          site,
          product,
          controller.signal,
          {
            forceRefresh,
          },
        )

        if (controller.signal.aborted) {
          return
        }

        setState({
          definition,
          frames: definition?.frames ?? [],
          loading: false,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setState((current) => ({
          definition:
            forceRefresh && current.definition ? current.definition : null,
          frames: forceRefresh && current.frames.length > 0 ? current.frames : [],
          loading: false,
          error: error instanceof Error ? error.message : 'Local radar refresh failed.',
        }))
      } finally {
        if (!controller.signal.aborted) {
          timeoutId = window.setTimeout(() => {
            void loadDefinition(true)
          }, LOCAL_RADAR_POLL_MS)
        }
      }
    }

    void loadDefinition(false)

    return () => {
      controller.abort()
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [product, site])

  return state
}
