import { useEffect, useRef, useState } from 'react'
import { WeatherSourceLink } from './WeatherSourceLink'
import { fetchSnowfallGuidance, stormDeskSourceUrl, type StormDeskEvidence, type StormDeskRun } from '../services/stormDesk'

export function SnowfallOutlook({ evidence, disabled, onLoaded }: {evidence:StormDeskEvidence;disabled:boolean;onLoaded:(run:StormDeskRun)=>void}) {
  const [index,setIndex] = useState(0)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const active = useRef(true)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  const day = evidence.latest.hours[index]
  const snow = evidence.snow?.hours.at(-1)?.validTime === day.validTime ? evidence.snow : null
  async function load() {
    setBusy(true);setError(null)
    try {const result=await fetchSnowfallGuidance([evidence.longitude,evidence.latitude],day);if(active.current) onLoaded(result)}
    catch(cause) {setError(String(cause))}
    finally {setBusy(false)}
  }
  return <section className="desk-snowfall">
    <div className="panel-heading"><h3>Snowfall outlook</h3><span className="badge">NBM</span></div>
    <div className="desk-image-controls"><label>Forecast day
      <select value={index} disabled={busy} onChange={(event)=>{setIndex(Number(event.target.value));setError(null)}}>
        {evidence.latest.hours.map((hour,i)=><option key={hour.validTime} value={i}>{new Date(hour.intervalStartTime!).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'})}</option>)}
      </select>
    </label><button type="button" disabled={disabled||busy} onClick={load}>{busy?'Loading...':'Load snow outlook'}</button></div>
    {error?<p className="error-text" role="alert">{error}</p>:null}
    {snow ? <>
      <p className="source-note">Six-hour accumulation windows · run {new Date(snow.runTime).toLocaleString()}</p>
      <div className="snowfall-periods">{snow.hours.map((hour)=><article className="storm-desk-hour" key={hour.validTime}>
        <p className="card-label">{localTime(hour.intervalStartTime!)} – {localTime(hour.validTime)}</p>
        <div className="daily-probabilities">
          <SnowValue label="Modeled snowfall" value={amount(hour.snowfallInches)} />
          <SnowValue label="Chance of >0.1 in" value={percent(hour.snowProbabilityPercent)} />
          <SnowValue label="Chance of >2 in" value={percent(hour.snowOver2Percent)} />
          <SnowValue label="Chance of >4 in" value={percent(hour.snowOver4Percent)} />
          <SnowValue label="Median snowfall" value={amount(hour.snowP50Inches)} />
          <SnowValue label="Amount range (80%)" value={hour.snowP10Inches!=null && hour.snowP90Inches!=null?`${hour.snowP10Inches.toFixed(1)}–${hour.snowP90Inches.toFixed(1)} in`:'Unavailable'} />
        </div>
        <WeatherSourceLink href={`${stormDeskSourceUrl(snow,hour)}.idx`}>Source inventory</WeatherSourceLink>
      </article>)}</div>
      <p className="source-note">Snowfall inches, not water equivalent. Amount ranges include no-snow outcomes. Probabilities apply to each six-hour window, not the whole day.</p>
    </>:null}
  </section>
}
function SnowValue({label,value}:{label:string;value:string}) {return <div><span>{label}</span><strong>{value}</strong></div>}
function amount(value:number|null|undefined) {return value==null?'Unavailable':`${value.toFixed(1)} in`}
function percent(value:number|null|undefined) {return value==null?'Unavailable':`${Math.round(value)}%`}
function localTime(value:string) {return new Date(value).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}
