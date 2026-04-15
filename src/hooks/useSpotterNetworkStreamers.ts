import { useEffect, useState } from 'react'
import { fetchSpotterNetworkStreamers } from '../services/spotterNetwork'
import type { SpotterNetworkFeature } from '../types/weather'

const SPOTTER_NETWORK_POLL_MS = 60 * 1000

type SpotterNetworkState = {
  features: SpotterNetworkFeature[]
  loading: boolean
  error: string | null
}

export function useSpotterNetworkStreamers(
  enabled: boolean,
): SpotterNetworkState {
  const [state, setState] = useState<SpotterNetworkState>({
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

    const loadStreamers = async (background = false) => {
      if (!background) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const features = await fetchSpotterNetworkStreamers(controller.signal)

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
          error:
            error instanceof Error
              ? error.message
              : 'Spotter Network refresh failed.',
        }))
      }
    }

    void loadStreamers(false)
    const intervalId = window.setInterval(() => {
      void loadStreamers(true)
    }, SPOTTER_NETWORK_POLL_MS)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [enabled])

  return state
}
