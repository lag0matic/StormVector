import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type KeyStatus = { saved: boolean; environment: boolean }

export function AiPreferences() {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    let active = true
    invoke<KeyStatus>('storm_desk_ai_key_status').then((result) => {
      if (active) setStatus(result)
    }).catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [])

  async function update(remove = false) {
    setBusy(true)
    setError(null)
    try {
      if (remove) await invoke('remove_storm_desk_ai_key')
      else await invoke('configure_storm_desk_ai', { key })
      setKey('')
      setConfirmRemove(false)
      setStatus(await invoke<KeyStatus>('storm_desk_ai_key_status'))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="popover-section ai-preferences">
    <div className="settings-row"><p className="card-label">Forecast Briefing</p>
      <span className="badge">{status?.saved ? 'Key saved' : status?.environment ? 'Environment key' : status ? 'Not configured' : 'Checking...'}</span>
    </div>
    <label htmlFor="openai-key">OpenAI API key</label>
    <input id="openai-key" type="password" autoComplete="off" spellCheck={false}
      placeholder={status?.saved ? 'Enter a replacement key' : 'Enter API key'}
      value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} />
    <div className="chip-group">
      <button type="button" className="chip" disabled={busy || !key.trim()} onClick={() => update()}>{busy ? 'Working...' : 'Save key'}</button>
      {status?.saved ? <button type="button" className="chip" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove key</button> : null}
    </div>
    {confirmRemove ? <div>
      <p className="compact-copy">Remove the saved OpenAI key?</p>
      <div className="chip-group"><button className="chip" type="button" disabled={busy} onClick={() => update(true)}>Remove</button>
      <button className="chip" type="button" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button></div>
    </div> : null}
    <p className="source-note">Stored in your system keyring. Generated briefings use your OpenAI account.</p>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
  </section>
}
