import { useEffect, useState } from 'react'
import { mockLocationWeather } from '../data/mockWeather'
import { fetchLocationWeather } from '../services/weatherData'
import type { WeatherLoadState } from '../types/weather'

const refreshIntervalMs = 10 * 60 * 1000

export function useLocationWeather(
  coordinates: [number, number],
): WeatherLoadState {
  const [state, setState] = useState<WeatherLoadState>({
    data: mockLocationWeather,
    loading: true,
    error: null,
    source: 'mock',
  })

  useEffect(() => {
    let activeController: AbortController | null = null
    let timeoutId: number | null = null

    const loadWeather = async (showLoadingState: boolean) => {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller

      if (showLoadingState) {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }))
      }

      try {
        const data = await fetchLocationWeather(coordinates, controller.signal)

        if (controller.signal.aborted) {
          return
        }

        setState({
          data,
          loading: false,
          error: null,
          source: 'live',
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setState((current) => ({
          data: current.source === 'live' ? current.data : mockLocationWeather,
          loading: false,
          error: error instanceof Error ? error.message : 'Weather refresh failed.',
          source: current.source === 'live' ? 'live' : 'mock',
        }))
      } finally {
        if (!controller.signal.aborted) {
          timeoutId = window.setTimeout(() => {
            void loadWeather(false)
          }, refreshIntervalMs)
        }
      }
    }

    void loadWeather(true)

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      activeController?.abort()
    }
  }, [coordinates])

  return state
}
