import { useEffect, useState } from 'react'
import {
  fetchFutureRadarTimeline,
  type FutureRadarFrame,
  type FutureRadarProduct,
} from '../services/futureRadar'

const FUTURE_RADAR_POLL_MS = 15 * 60_000

type FutureRadarTimelineState = {
  frames: FutureRadarFrame[]
  loading: boolean
  error: string | null
}

export function useFutureRadarTimeline(
  product: FutureRadarProduct,
  enabled: boolean,
): FutureRadarTimelineState {
  const [state, setState] = useState<FutureRadarTimelineState>({
    frames: [],
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      return
    }

    const controller = new AbortController()
    let timeoutId: number | null = null

    const loadFrames = async (forceRefresh = false) => {
      if (!forceRefresh) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const frames = await fetchFutureRadarTimeline(
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
          error:
            error instanceof Error
              ? error.message
              : 'Future radar refresh failed.',
        }))
      } finally {
        if (!controller.signal.aborted) {
          timeoutId = window.setTimeout(() => {
            void loadFrames(true)
          }, FUTURE_RADAR_POLL_MS)
        }
      }
    }

    void loadFrames(false)

    return () => {
      controller.abort()
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [enabled, product])

  return state
}
