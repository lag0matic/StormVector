import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { StormDeskPanel } from './StormDeskPanel'
import '../App.css'

export function WeatherDeskWindow() {
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
    }).then((stop)=>{if(disposed)stop();else unlisten=stop})
    return ()=>{disposed=true;unlisten?.()}
  },[])
  return <main className="weather-desk-window">
    <header><h1>Forecast Briefing</h1><span>{coordinates[1].toFixed(3)}, {coordinates[0].toFixed(3)}</span></header>
    <StormDeskPanel coordinates={coordinates} />
  </main>
}
