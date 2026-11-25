import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Minus, Moon, Sun } from 'lucide-react'
import type { Conditions, Phase } from '../services/forecastBriefing'

const symbols = { sun: Sun, partly: CloudSun, cloud: Cloud, rain: CloudRain, snow: CloudSnow, mix: CloudDrizzle, storm: CloudLightning, fog: CloudFog, dry: Minus }

export function WeatherIcon({ condition, night = false, size = 21 }: { condition: Conditions | Phase; night?: boolean; size?: number }) {
  if (condition === 'freezing-rain' || condition === 'sleet') {
    return <svg className="briefing-weather-icon" data-weather={condition} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" transform="translate(0 -1)" />
      {condition === 'freezing-rain' ? <><path d="M8 12.8v3.4m4-2.3v4m4-5.1v3.4" /><path d="M3 21h7l2-1 2 1h7" /></> :
        <><g fill="currentColor" stroke="none"><circle cx="8" cy="13.6" r="1.65" /><circle cx="13.2" cy="15.2" r="1.65" /><circle cx="6.4" cy="19.6" r="1.65" /></g><path d="m11 19 2.8 2.2 4.3-4.3" /></>}
    </svg>
  }
  const Icon = night && condition === 'sun' ? Moon : night && condition === 'partly' ? CloudMoon : symbols[condition]
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} className="briefing-weather-icon" data-weather={condition} />
}
