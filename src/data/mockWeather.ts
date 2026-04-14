import type { LocationWeather } from '../types/weather'

export const mockLocationWeather: LocationWeather = {
  location: {
    name: 'Indianapolis, IN',
    office: 'NWS Indianapolis',
    coordinates: [-86.1581, 39.7684],
  },
  current: {
    temperature: '67°F',
    summary: 'Mostly cloudy with a few showers nearby',
  },
  forecast: [
    {
      name: 'Tonight',
      temperature: '56°F',
      summary: 'Scattered showers late, breezy.',
    },
    {
      name: 'Tuesday',
      temperature: '72°F',
      summary: 'Warm, humid, and a few afternoon storms.',
    },
    {
      name: 'Wednesday',
      temperature: '61°F',
      summary: 'Cooler with lingering clouds and gusty wind.',
    },
    {
      name: 'Thursday',
      temperature: '58°F',
      summary: 'Drying out with a clearing sky.',
    },
  ],
  hazards: [
    {
      type: 'Storm Risk',
      title: 'SPC Day 2 Slight Risk',
      summary: 'Strong to severe thunderstorms possible Tuesday afternoon.',
    },
    {
      type: 'Alerts',
      title: 'Wind Advisory',
      summary: 'Southwest wind gusts may reach 40 mph through evening.',
    },
    {
      type: 'Winter',
      title: 'No winter impacts',
      summary: 'Winter products are quiet here, but the layer group is ready.',
    },
  ],
  radar: {
    currentFrameLabel: 'Live radar mosaic',
    sourceLabel: 'NWS radar + cached playback timeline',
  },
  services: [
    {
      name: 'forecast-service',
      role: 'Resolves point forecasts, hourly periods, and summaries.',
    },
    {
      name: 'alerts-service',
      role: 'Pulls active watches, warnings, and advisories for the map view.',
    },
    {
      name: 'radar-service',
      role: 'Normalizes live radar frames and recent playback metadata.',
    },
    {
      name: 'satellite-service',
      role: 'Adapts GOES imagery into the same timeline model as radar.',
    },
    {
      name: 'outlook-service',
      role: 'Loads SPC and winter outlook polygons and legend metadata.',
    },
  ],
}
