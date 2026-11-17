import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const url = process.argv[2]
const nbm = url?.startsWith('https://noaa-nbm-grib2-pds.s3.amazonaws.com/')
if (!nbm && !url?.startsWith('https://noaa-gfs-bdp-pds.s3.amazonaws.com/')) throw Error('Supply a NOAA GFS or NBM source URL')
const response = await fetch(`${url}.idx`)
if (!response.ok) throw Error(`Index ${response.status}`)
const lines = (await response.text()).trim().split('\n')
const daily = process.argv.includes('--daily')
const patterns = nbm ? [':prob >0.254:', ':10% level', ':50% level', ':90% level'] : daily ? [':TMAX:2 m above ground:', ':TMIN:2 m above ground:', ':APCP:surface:'] : [':TMP:2 m above ground:', ':DPT:2 m above ground:', ':UGRD:10 m above ground:', ':VGRD:10 m above ground:', ':GUST:surface:', ':CAPE:surface:', ':TCDC:entire atmosphere:']
const forecast = Number(url.match(/\.f(\d{3})|f(\d{3})/)?.slice(1).find(Boolean))
function interval(line) {
  const match = line.split(':')[5]?.match(/^(\d+)-(\d+) (hour|day)/)
  return match ? [Number(match[1]), Number(match[2])].map((n) => n * (match[3] === 'day' ? 24 : 1)) : []
}
const parts = []
for (const pattern of patterns) {
  const i = lines.findIndex((line) => line.includes(pattern) && (!nbm || line.includes(':APCP:surface:')) &&
    (!(nbm || daily) || (interval(line)[0] === forecast - (nbm ? 24 : 6) && interval(line)[1] === forecast)))
  if (i < 0) throw Error(`Missing ${pattern}`)
  const start = Number(lines[i].split(':')[1])
  const end = Number(lines[i + 1].split(':')[1]) - 1
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (r.status !== 206) throw Error(`Range ${r.status}`)
  parts.push(Buffer.from(await r.arrayBuffer()))
}
const dir = await mkdtemp(join(tmpdir(), 'stormvector-gfs-check-'))
try {
  const path = join(dir, 'fields.grib2')
  await writeFile(path, Buffer.concat(parts))
  console.log(execFileSync(resolve('src-tauri/resources/wgrib2/windows-x64/wgrib2.exe'), [path, '-s', '-lon', '273.84', '39.77'], { env: { ...process.env, OMP_NUM_THREADS: '2' }, windowsHide: true }).toString())
} finally { await rm(dir, { recursive: true }) }
