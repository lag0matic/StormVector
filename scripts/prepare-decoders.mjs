import { copyFile, cp, mkdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import https from 'node:https'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const resourcesRoot = join(repoRoot, 'src-tauri', 'resources', 'wgrib2')
const windowsResourceDir = join(resourcesRoot, 'windows-x64')
const linuxResourceDir = join(resourcesRoot, 'linux-x64')
const windowsToolDir = join(repoRoot, '.tools', 'wgrib2', 'windows-v3.1.3')
const linuxEnvDir = join(repoRoot, '.tools', 'wgrib2', 'linux-env')
const windowsBaseUrl =
  'https://ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/Windows10/v3.1.3'
const windowsFiles = [
  'wgrib2.exe',
  'cygwin1.dll',
  'cyggcc_s-seh-1.dll',
  'cyggfortran-5.dll',
  'cyggomp-1.dll',
  'cygquadmath-0.dll',
]

await prepareDecoderForCurrentPlatform()

async function prepareDecoderForCurrentPlatform() {
  if (process.platform === 'win32') {
    await prepareWindowsDecoder()
    return
  }

  if (process.platform === 'linux' && process.arch === 'x64') {
    await prepareLinuxDecoder()
    return
  }

  console.log(
    `No bundled wgrib2 decoder is configured for ${process.platform}/${process.arch}; using PATH fallback.`,
  )
}

async function prepareWindowsDecoder() {
  await mkdir(windowsToolDir, { recursive: true })
  await mkdir(windowsResourceDir, { recursive: true })

  for (const fileName of windowsFiles) {
    const toolPath = join(windowsToolDir, fileName)
    const resourcePath = join(windowsResourceDir, fileName)

    if (!(await exists(toolPath))) {
      await downloadFile(`${windowsBaseUrl}/${fileName}`, toolPath)
    }

    await copyFile(toolPath, resourcePath)
  }

  console.log(`Prepared Windows wgrib2 decoder at ${windowsResourceDir}`)
}

async function prepareLinuxDecoder() {
  const resourceBin = join(linuxResourceDir, 'bin', 'wgrib2')
  const resourceLib = join(linuxResourceDir, 'lib')

  if ((await exists(resourceBin)) && (await exists(resourceLib))) {
    console.log(`Prepared Linux wgrib2 decoder at ${linuxResourceDir}`)
    return
  }

  const envBin = join(linuxEnvDir, 'bin', 'wgrib2')
  const envLib = join(linuxEnvDir, 'lib')

  if (!(await exists(envBin))) {
    const micromamba = findCommand('micromamba')

    if (!micromamba) {
      throw new Error(
        'micromamba is required to prepare the bundled Linux wgrib2 runtime.',
      )
    }

    run(micromamba, [
      'create',
      '-y',
      '-p',
      linuxEnvDir,
      '-c',
      'conda-forge',
      'wgrib2',
    ])
  }

  await mkdir(join(linuxResourceDir, 'bin'), { recursive: true })
  await copyFile(envBin, resourceBin)
  await cp(envLib, resourceLib, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  })

  console.log(`Prepared Linux wgrib2 decoder at ${linuxResourceDir}`)
}

async function downloadFile(url, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  await pipeline(await get(url), createWriteStream(outputPath))
}

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          get(response.headers.location).then(resolve, reject)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed ${response.statusCode}: ${url}`))
          response.resume()
          return
        }

        resolve(response)
      })
      .on('error', reject)
  })
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function findCommand(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
  })

  return result.status === 0 ? command : null
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
}
