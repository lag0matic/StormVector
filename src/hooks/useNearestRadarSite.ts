import { useEffect, useState } from 'react'
import { findNearestRadarSite, type RadarSite } from '../services/radar'

type NearestRadarSiteState = {
  site: RadarSite | null
  loading: boolean
  error: string | null
}

export function useNearestRadarSite(
  coordinates: [number, number],
): NearestRadarSiteState {
  const [state, setState] = useState<NearestRadarSiteState>({
    site: null,
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

    findNearestRadarSite(coordinates, controller.signal)
      .then((site) => {
        setState({
          site,
          loading: false,
          error: null,
        })
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          site: null,
          loading: false,
          error: error.message,
        })
      })

    return () => controller.abort()
  }, [coordinates])

  return state
}
