import { useEffect, useState } from 'react'
import {
  fetchRegionalRadarTimeline,
  type RegionalRadarProduct,
} from '../services/radar'

type RegionalRadarTimelineState = {
  frames: string[]
  loading: boolean
  error: string | null
}

export function useRegionalRadarTimeline(
  product: RegionalRadarProduct,
): RegionalRadarTimelineState {
  const [state, setState] = useState<RegionalRadarTimelineState>({
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

    fetchRegionalRadarTimeline(product, controller.signal)
      .then((frames) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          frames,
          loading: false,
          error: null,
        })
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          frames: [],
          loading: false,
          error: error.message,
        })
      })

    return () => controller.abort()
  }, [product])

  return state
}
