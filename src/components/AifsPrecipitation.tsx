import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { StormDeskMap } from './StormDeskMap'

const corners: [[number, number], [number, number], [number, number], [number, number]] =
  [[-135, 55], [-60, 55], [-60, 20], [-135, 20]]
const ranges = [
  { label: 'Days 1-3', start: 6, end: 72 },
  { label: 'Days 4-7', start: 78, end: 168 },
  { label: 'Days 8-15', start: 174, end: 360 },
]
const precipitationLegend = [
  ['#4cc097', '0.01-0.10'], ['#218ed1', '0.10-0.25'], ['#fbd14a', '0.25-0.50'],
  ['#f7823e', '0.50-1.00'], ['#c33a66', '1.00+'],
]
const layers = {
  precipitation: { label: 'Precipitation (in)', legend: precipitationLegend },
  temperature: { label: '2 m temperature (°F)', legend: [
    ['#7141a2', '<0'], ['#4c72c1', '0–20'], ['#45b0d3', '20–32'], ['#7cca9f', '32–50'],
    ['#ead457', '50–70'], ['#f2913d', '70–90'], ['#d24154', '90+'],
  ] },
  wind: { label: '10 m sustained wind (mph)', legend: [
    ['#5dbaac', '5–10'], ['#3990c5', '10–20'], ['#e8c953', '20–30'],
    ['#f2803e', '30–45'], ['#bc427a', '45+'],
  ] },
}
type Layer = keyof typeof layers
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short',
})
const valid = (run: string, hour: number) => dateFormat.format(Date.parse(run) + hour * 3600000)

type AifsProps = { coordinates: [number, number]; active: boolean }

export function AifsPrecipitation({ coordinates, active }: AifsProps) {
  const [run, setRun] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function loadRun() {
    setBusy(true)
    setError('')
    try { setRun(await invoke<string>('latest_aifs_run')) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="aifs-maps">
    <div className="panel-heading">
      <h3>ECMWF AIFS Single</h3>
      <button type="button" onClick={loadRun} disabled={busy}>{busy ? 'Checking runs...' : run ? 'Check for new run' : 'Load latest run'}</button>
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {run ? <AifsPlayback key={run} run={run} coordinates={coordinates} active={active} /> :
      <div className="desk-image-frame"><StormDeskMap image={null} coordinates={coordinates} corners={corners} /></div>}
    <p className="source-note">Source: ECMWF Open Data, CC BY 4.0. North America display. Precipitation includes rain and the liquid equivalent of frozen precipitation, not radar reflectivity.</p>
  </section>
}

function AifsPlayback({ run, coordinates, active }: AifsProps & { run: string }) {
  const [range, setRange] = useState(0)
  const [period, setPeriod] = useState(6)
  const [layer, setLayer] = useState<Layer>('precipitation')
  return <>
    <div className="aifs-controls">
      <label>Forecast range <select value={range} onChange={event => setRange(Number(event.target.value))}>
        {ranges.map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
      </select></label>
      <label>Map layer <select value={layer} onChange={event => setLayer(event.target.value as Layer)}>
        <option value="precipitation">Precipitation</option>
        <option value="temperature">Temperature</option>
        <option value="wind">Wind speed</option>
      </select></label>
      {layer === 'precipitation' && <label>Accumulation <select value={period} onChange={event => setPeriod(Number(event.target.value))}>
        <option value={6}>6 hours</option><option value={24}>24 hours</option>
      </select></label>}
      <span className="source-note">Run: {valid(run, 0)}</span>
    </div>
    <AifsFrames key={`${range}-${period}`} run={run} period={period} layer={layer} range={ranges[range]} coordinates={coordinates} active={active} />
    {range === 2 && <p className="source-note">Long-range guidance: broad patterns matter more than local timing or amounts.</p>}
  </>
}

function AifsFrames({ run, period, layer, range, coordinates, active }: AifsProps & {
  run: string; period: number; layer: Layer; range: typeof ranges[number]
}) {
  const start = Math.max(range.start, period)
  const [hour, setHour] = useState(start)
  const [frame, setFrame] = useState<{ hour: number; layer: Layer; url: string } | null>(null)
  const shown = frame?.layer === layer ? frame : null
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const cache = useRef(new Map<string, string>())
  const pending = useRef(new Map<string, Promise<ArrayBuffer>>())

  useEffect(() => {
    const frames = cache.current
    return () => { frames.forEach(url => URL.revokeObjectURL(url)); frames.clear() }
  }, [])

  useEffect(() => {
    let active = true
    const key = `${layer}-${hour}`
    setError('')
    const cached = cache.current.get(key)
    if (cached) {
      setFrame({ hour, layer, url: cached })
      return
    }
    const requests = pending.current
    let request = requests.get(key)
    if (!request) {
      request = invoke<ArrayBuffer>('render_aifs_map', { run, hour, period, layer })
        .finally(() => requests.delete(key))
      requests.set(key, request)
    }
    request.then(async bytes => {
      if (!active) return
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        if (!active) return URL.revokeObjectURL(url)
        cache.current.set(key, url)
        setFrame({ hour, layer, url })
      } catch (cause) {
        URL.revokeObjectURL(url)
        throw cause
      }
    }).catch(cause => {
      if (!active) return
      setError(String(cause))
      setPlaying(false)
    })
    return () => { active = false }
  }, [hour, period, layer, retry, run])

  useEffect(() => {
    if (!active || !playing || shown?.hour !== hour || error) return
    const timer = window.setTimeout(() => setHour(hour >= range.end ? start : hour + 6), 650)
    return () => window.clearTimeout(timer)
  }, [active, playing, shown, hour, error, start, range.end])

  return <>
    <div className="desk-image-frame">
      <StormDeskMap image={shown?.url ?? null} coordinates={coordinates} corners={corners} />
      {!error && shown?.hour !== hour && <span className="desk-image-status" role="status">Loading +{hour}h forecast...</span>}
    </div>
    <div className="aifs-controls">
      <button type="button" aria-pressed={playing} disabled={!!error} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause' : 'Play'}</button>
      <label>Forecast hour <select value={hour} disabled={shown?.hour !== hour && !error} onChange={event => {
        setPlaying(false); setError(''); setHour(Number(event.target.value))
      }}>
        {Array.from({ length: (range.end - start) / 6 + 1 }, (_, i) => start + i * 6).map(step =>
          <option key={step} value={step}>+{step}h ({valid(run, step)})</option>)}
      </select></label>
      {shown && <span className="source-note">Showing +{shown.hour}h: {layer === 'precipitation' && `${valid(run, shown.hour - period)} to `}{valid(run, shown.hour)}</span>}
    </div>
    {error && <p className="error-text" role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry frame</button></p>}
    <ul className="aifs-legend" aria-label={layers[layer].label}>
      <li>{layers[layer].label}</li>
      {layers[layer].legend.map(([color, label]) => <li key={label}><span style={{ background: color }} />{label}</li>)}
    </ul>
  </>
}
