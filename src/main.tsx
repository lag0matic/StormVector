import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import './components/weatherVisuals.css'
import App from './App.tsx'
import { WeatherDeskWindow } from './components/WeatherDeskWindow'

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="startup-error" role="alert">
          <p className="eyebrow">StormVector</p>
          <h1>Couldn’t load the workstation</h1>
          <button type="button" className="inline-action" onClick={() => window.location.reload()}>Reload</button>
          <details><summary>Error details</summary><pre>{this.state.error.stack ?? this.state.error.message}</pre></details>
        </main>
      )
    }

    return this.props.children
  }
}

if (new URLSearchParams(window.location.search).has('desk')) {
  document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    {new URLSearchParams(window.location.search).has('desk') ? <WeatherDeskWindow /> : <App />}
  </RootErrorBoundary>,
)
