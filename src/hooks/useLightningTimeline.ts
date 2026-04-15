import { useEffect, useState } from 'react'
import {
  fetchLightningTimeline,
  type LightningLayerId,
  type LightningTimelineDefinition,
} from '../services/lightning'

const LIGHTNING_POLL_MS = 60_000

type LightningTimelineState = {
  definition: LightningTimelineDefinition | null
  frames: string[]
  loading: boolean
  error: string | null
}

export function useLightningTimeline(
  layerId: LightningLayerId,
): LightningTimelineState {
  const [state, setState] = useState<LightningTimelineState>({
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
        const definition = await fetchLightningTimeline(layerId, controller.signal, {
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
          error: error instanceof Error ? error.message : 'Lightning refresh failed.',
        }))
      }
    }

    void loadTimeline(false)
    intervalId = window.setInterval(() => {
      void loadTimeline(true)
    }, LIGHTNING_POLL_MS)

    return () => {
      controller.abort()
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [layerId])

  return state
}
