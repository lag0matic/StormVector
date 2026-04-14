import { useEffect, useState } from 'react'
import {
  fetchSatelliteTimeline,
  type SatelliteLayerId,
  type SatelliteTimelineDefinition,
} from '../services/satellite'

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

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }))

    fetchSatelliteTimeline(layerId, controller.signal)
      .then((definition) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          definition,
          frames: definition.frames,
          loading: false,
          error: null,
        })
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          definition: null,
          frames: [],
          loading: false,
          error: error.message,
        })
      })

    return () => controller.abort()
  }, [layerId])

  return state
}
