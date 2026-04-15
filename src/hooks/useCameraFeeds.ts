import { useEffect, useState } from 'react'
import {
  fetchCameraFeeds,
  type CameraFeed,
  type CameraFeedInput,
} from '../services/cameras'

type CameraFeedState = {
  feeds: CameraFeed[]
  loading: boolean
  error: string | null
}

export function useCameraFeeds(
  enabled: boolean,
  customFeeds: CameraFeedInput[],
): CameraFeedState {
  const [state, setState] = useState<CameraFeedState>({
    feeds: [],
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

    let cancelled = false

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }))

    fetchCameraFeeds(customFeeds)
      .then((feeds) => {
        if (cancelled) {
          return
        }

        setState({
          feeds,
          loading: false,
          error: null,
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setState({
          feeds: [],
          loading: false,
          error: error instanceof Error ? error.message : 'Camera feeds unavailable.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [customFeeds, enabled])

  return state
}
