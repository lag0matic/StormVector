import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { buildFutureRadarImageUrl } from '../services/futureRadar'
import { stormDeskSourceUrl, type StormDeskEvidence } from '../services/stormDesk'
import { StormDeskMap } from './StormDeskMap'

export function StormDeskImagery({ evidence }: { evidence: StormDeskEvidence }) {
  const [index, setIndex] = useState(0)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requested, setRequested] = useState(0)
  const [linkError, setLinkError] = useState<string | null>(null)
  async function openChart(chart: 'noaa' | 'ecmwf') {
    setLinkError(null)
    try { await invoke('open_weather_chart', { chart }) }
    catch (cause) { setLinkError(String(cause)) }
  }
  const [coordinates] = useState<[number, number]>([evidence.longitude, evidence.latitude])
  const hour = evidence.latest.hours[index] ?? evidence.latest.hours[0]
  useEffect(() => {
    if (!requested || evidence.latest.model !== 'HRRR' || !hour) return
    let active = true
    let objectUrl: string | undefined
    const sourceUrl = stormDeskSourceUrl(evidence.latest, hour)
    const bounds = { west: -134.12, south: 21.12, east: -60.9, north: 52.62, width: 1000, height: 500 }
    invoke<number[]>('fetch_future_radar_render', { request: {
      sourceUrl, band: 1, renderUrl: buildFutureRadarImageUrl({ sourceUrl, band: 1, ...bounds }), ...bounds,
    } }).then((bytes) => {
      if (!active) return
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      setImage(objectUrl)
    }).catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [requested, evidence, hour])

  return <section className="desk-imagery">
    <div className="panel-heading"><h3>Forecast imagery</h3><span className="badge">{evidence.latest.model}</span></div>
    {evidence.latest.model === 'HRRR' ? <>
      <div className="desk-image-controls"><label>Simulated radar <select value={index} onChange={(event) => {
        setIndex(Number(event.target.value)); setImage(null); setError(null)
      }}>{evidence.latest.hours.map((item, i) => <option key={item.validTime} value={i}>{new Date(item.validTime).toLocaleString()}</option>)}</select></label>
      <button type="button" onClick={() => { setError(null); setRequested(value => value + 1) }} disabled={requested > 0 && !image && !error}>Load image</button></div>
      <div className="desk-image-frame"><StormDeskMap image={image} coordinates={coordinates} />
        {!image ? <span className="desk-image-status" role="status">{error ?? (requested ? 'Loading forecast image...' : 'No forecast image loaded')}</span> : null}
      </div>
      <p className="source-note">Simulated reflectivity · {new Date(hour.validTime).toLocaleString()}</p>
    </> : <p className="source-note">GFS map products are available in NOAA's chart viewer.</p>}
    <div className="desk-chart-links">
      <button type="button" onClick={() => openChart('noaa')}>NOAA model charts</button>
      <button type="button" onClick={() => openChart('ecmwf')}>Euro / ECMWF charts</button>
    </div>
    {linkError ? <p className="error-text" role="alert">{linkError}</p> : null}
    <p className="source-note">External charts have their own model, run and forecast-time selections.</p>
  </section>
}
