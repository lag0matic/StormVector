import { useEffect, useState } from 'react'
import {
  fetchSatelliteTimeline,
  type SatelliteLayerId,
  type SatelliteTimelineDefinition,
} from '../services/satellite'

const SATELLITE_POLL_MS = 180_000

type SatelliteTimelineState = {
  definition: SatelliteTimelineDefinition | null
  frames: string[]
  loading: boolean
  error: string | null
}

export function useSatelliteTimeline(
  layerId: SatelliteLayerId,
): SatelliteTimelineState {
  const [state, setState] = useState<SatelliteTimelineState>({
    definition: null,
    frames: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    let intervalId: number | null = null

    const loadTimeline = async (forceRefresh = false) => {
      if (!forceRefresh) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const definition = await fetchSatelliteTimeline(layerId, controller.signal, {
          forceRefresh,
        })

        if (controller.signal.aborted) {
          return
        }

        setState({
          definition,
          frames: definition.frames,
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
          error: error instanceof Error ? error.message : 'Satellite refresh failed.',
        }))
      }
    }

    void loadTimeline(false)
    intervalId = window.setInterval(() => {
      void loadTimeline(true)
    }, SATELLITE_POLL_MS)

    return () => {
      controller.abort()
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [layerId])

  return state
}
