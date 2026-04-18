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

    const loadWeather = (showLoadingState: boolean) => {
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

      fetchLocationWeather(coordinates, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) {
            return
          }

          setState({
            data,
            loading: false,
            error: null,
            source: 'live',
          })
        })
        .catch((error: Error) => {
          if (controller.signal.aborted) {
            return
          }

          setState((current) => ({
            data: current.source === 'live' ? current.data : mockLocationWeather,
            loading: false,
            error: error.message,
            source: current.source === 'live' ? 'live' : 'mock',
          }))
        })
    }

    loadWeather(true)
    const intervalId = window.setInterval(() => loadWeather(false), refreshIntervalMs)

    return () => {
      window.clearInterval(intervalId)
      activeController?.abort()
    }
  }, [coordinates])

  return state
}
