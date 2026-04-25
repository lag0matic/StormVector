import { useEffect, useState } from 'react'
import { fetchNexradStormTracks } from '../services/nexradStormTracks'
import type { RadarSite } from '../services/radar'
import type { NexradStormTrackFeature } from '../types/weather'

type NexradStormTracksState = {
  tracks: NexradStormTrackFeature[]
  loading: boolean
  error: string | null
  updatedAt: string
}

const refreshIntervalMs = 2 * 60 * 1000

export function useNexradStormTracks(
  site: RadarSite | null,
  enabled: boolean,
): NexradStormTracksState {
  const [state, setState] = useState<NexradStormTracksState>({
    tracks: [],
    loading: false,
    error: null,
    updatedAt: '',
  })

  useEffect(() => {
    if (!site || !enabled) {
      setState({
        tracks: [],
        loading: false,
        error: null,
        updatedAt: '',
      })
      return
    }

    let active = true
    let timeoutId: number | null = null

    const loadTracks = async () => {
      setState((current) => ({
        ...current,
        loading: current.tracks.length === 0,
        error: null,
      }))

      try {
        const tracks = await fetchNexradStormTracks(site)

        if (!active) {
          return
        }

        setState({
          tracks,
          loading: false,
          error: null,
          updatedAt: new Date().toISOString(),
        })
      } catch (error) {
        if (!active) {
          return
        }

        setState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'NEXRAD storm tracks are unavailable.',
        }))
      } finally {
        if (active) {
          timeoutId = window.setTimeout(loadTracks, refreshIntervalMs)
        }
      }
    }

    void loadTracks()

    return () => {
      active = false
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [enabled, site])

  return state
}
