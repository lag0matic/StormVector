import { useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'

export function WeatherSourceLink({href,children}:{href:string;children:ReactNode}) {
  const [error,setError] = useState(false)
  return <><a href={href} onClick={(event)=>{
    event.preventDefault();setError(false)
    invoke('open_weather_source',{url:href}).catch(()=>setError(true))
  }}>{children}</a>{error ? <span role="alert"> Could not open source.</span> : null}</>
}
