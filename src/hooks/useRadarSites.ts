import { useEffect, useState } from 'react'
import { fetchRadarSites, type RadarSite } from '../services/radar'

type RadarSitesState = {
  sites: RadarSite[]
  loading: boolean
  error: string | null
}

export function useRadarSites(): RadarSitesState {
  const [state, setState] = useState<RadarSitesState>({
    sites: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()

    fetchRadarSites(controller.signal)
      .then((sites) => {
        setState({
          sites,
          loading: false,
          error: null,
        })
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          sites: [],
          loading: false,
          error: error.message,
        })
      })

    return () => controller.abort()
  }, [])

  return state
}
