import { useEffect, useState } from 'react'
import { mockLocationWeather } from '../data/mockWeather'
import { fetchLocationWeather } from '../services/weatherData'
import type { WeatherLoadState } from '../types/weather'

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
    const controller = new AbortController()

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }))

    fetchLocationWeather(coordinates, controller.signal)
      .then((data) => {
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

        setState({
          data: mockLocationWeather,
          loading: false,
          error: error.message,
          source: 'mock',
        })
      })

    return () => controller.abort()
  }, [coordinates])

  return state
}
