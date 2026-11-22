import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { StormDeskPanel } from './StormDeskPanel'
import { AifsPrecipitation } from './AifsPrecipitation'
import { StormDeskAi } from './StormDeskAi'
import '../App.css'

export function WeatherDeskWindow() {
  const [view, setView] = useState<'briefing' | 'aifs'>('briefing')
  const params = new URLSearchParams(window.location.search)
  const [coordinates,setCoordinates] = useState<[number, number]>([
    Number(params.get('lon') ?? -86.1581), Number(params.get('lat') ?? 39.7684),
  ])
  useEffect(()=>{
    let disposed=false
    let unlisten:(()=>void)|undefined
    listen<{longitude:number;latitude:number;theme:string}>('forecast-location',({payload})=>{
      setCoordinates([payload.longitude,payload.latitude])
      document.documentElement.dataset.theme=payload.theme==='dark'?'dark':'light'
    }).then((stop)=>{if(disposed)stop();else unlisten=stop}).catch(() => {})
    return ()=>{disposed=true;unlisten?.()}
  },[])
  return <main className="weather-desk-window">
    <header><h1>Forecast Briefing</h1><span>{coordinates[1].toFixed(3)}, {coordinates[0].toFixed(3)}</span></header>
    <nav className="desk-view-nav" aria-label="Forecast briefing views">
      <button type="button" aria-pressed={view === 'briefing'} onClick={() => setView('briefing')}>Model guidance</button>
      <button type="button" aria-pressed={view === 'aifs'} onClick={() => setView('aifs')}>AIFS maps</button>
    </nav>
    <StormDeskAi key={coordinates.join(',')} coordinates={coordinates} />
    <div hidden={view !== 'briefing'}><StormDeskPanel coordinates={coordinates} /></div>
    <div hidden={view !== 'aifs'}><AifsPrecipitation coordinates={coordinates} active={view === 'aifs'} /></div>
  </main>
}
