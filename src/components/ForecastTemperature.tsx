export function TemperatureReading({ text }: { text: string }) {
  const match = /^(-?\d+)°([FC])$/.exec(text)
  return match ? <ForecastTemperature value={Number(match[1])} unit={match[2]} /> : <>{text}</>
}

export function ForecastTemperature({ value, unit = 'F', showUnit = true }: { value: number; unit?: string; showUnit?: boolean }) {
  if (!Number.isFinite(value)) return <>—</>
  const f = Math.round(unit === 'C' ? value * 9 / 5 + 32 : value)
  const band = f < 0 ? 'subzero' : f < 20 ? 'cold' : f < 40 ? 'blue' : f < 60 ? 'teal'
    : f < 70 ? 'green' : f === 70 ? 'neutral' : f < 80 ? 'gold' : f < 90 ? 'orange' : 'hot'
  return <span className="forecast-temperature" data-band={band}>{Math.round(value)}°{showUnit && unit}</span>
}
