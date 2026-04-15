import { useEffect, useState } from 'react'
import {
  fetchRegionalRadarTimeline,
  type RegionalRadarProduct,
} from '../services/radar'

const REGIONAL_RADAR_POLL_MS = 120_000

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
    let intervalId: number | null = null

    const loadFrames = async (forceRefresh = false) => {
      if (!forceRefresh) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const frames = await fetchRegionalRadarTimeline(product, controller.signal, {
          forceRefresh,
        })

        if (controller.signal.aborted) {
          return
        }

        setState({
          frames,
          loading: false,
          error: null,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setState((current) => ({
          frames: forceRefresh && current.frames.length > 0 ? current.frames : [],
          loading: false,
          error: error instanceof Error ? error.message : 'Regional radar refresh failed.',
        }))
      }
    }

    void loadFrames(false)
    intervalId = window.setInterval(() => {
      void loadFrames(true)
    }, REGIONAL_RADAR_POLL_MS)

    return () => {
      controller.abort()
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [product])

  return state
}
