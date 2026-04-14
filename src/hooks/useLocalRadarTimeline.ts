import { useEffect, useState } from 'react'
import {
  fetchRadarProductDefinition,
  type LocalRadarProduct,
  type RadarProductDefinition,
  type RadarSite,
} from '../services/radar'

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

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }))

    fetchRadarProductDefinition(site, product, controller.signal)
      .then((definition) => {
        setState({
          definition,
          frames: definition?.frames ?? [],
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
  }, [product, site])

  return state
}
