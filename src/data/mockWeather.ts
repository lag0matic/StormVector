import type { LocationWeather } from '../types/weather'

export const mockLocationWeather: LocationWeather = {
  location: {
    name: 'Indianapolis, IN',
    office: 'NWS Indianapolis',
    coordinates: [-86.1581, 39.7684],
  },
  current: {
    temperature: '46°F',
    summary: 'Overcast and breezy',
    feelsLike: '38°F',
    wind: 'W 21 mph gusting 28',
    sky: 'Overcast',
    precip: 'Dry',
    lastUpdated: 'Updated 3:55 PM',
  },
  sun: {
    sunrise: '6:55 AM',
    sunset: '8:22 PM',
  },
  nextHours: [
    {
      label: '+1h',
      condition: 'Chance rain showers',
      temperature: '54°F',
      feelsLike: '54°F',
      wind: 'NW 13 mph gusting 28',
      precip: '29% rain',
      secondary: 'Cloud cover 100%',
    },
    {
      label: '+2h',
      condition: 'Slight chance rain showers',
      temperature: '52°F',
      feelsLike: '52°F',
      wind: 'NW 12 mph gusting 26',
      precip: '24% rain',
      secondary: 'Cloud cover 100%',
    },
    {
      label: '+3h',
      condition: 'Mostly cloudy',
      temperature: '50°F',
      feelsLike: '46°F',
      wind: 'NW 10 mph gusting 22',
      precip: '13% precip',
      secondary: 'Cloud cover 92%',
    },
  ],
  forecast: [
    {
      name: 'Saturday, April 18th',
      temperature: '54°F',
      summary: 'Rain showers tapering off late with breezy northwest wind.',
    },
    {
      name: 'Sunday, April 19th',
      temperature: '62°F',
      summary: 'Cooler and drier with a mix of sun and clouds.',
    },
    {
      name: 'Monday, April 20th',
      temperature: '66°F',
      summary: 'Milder with increasing clouds and late-day shower chances.',
    },
    {
      name: 'Tuesday, April 21st',
      temperature: '71°F',
      summary: 'Warm with scattered showers and gusty wind.',
    },
    {
      name: 'Wednesday, April 22nd',
      temperature: '58°F',
      summary: 'Turning cooler again with lingering clouds.',
    },
  ],
  hazards: [
    {
      type: 'Alerts',
      title: 'Alerts on map',
      summary: 'Warning and watch details are driven by the dedicated polygon layer.',
    },
    {
      type: 'Storm Risk',
      title: 'SPC outlooks on map',
      summary: 'Severe-weather outlooks are shown as forecast overlays rather than cards.',
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
