import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App.tsx'

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
        <div
          style={{
            minHeight: '100vh',
            padding: '24px',
            display: 'grid',
            placeItems: 'center',
            background:
              'linear-gradient(180deg, rgb(11 27 39) 0%, rgb(16 36 50) 100%)',
            color: '#e7f0f6',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              width: 'min(820px, 100%)',
              padding: '20px',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(8, 18, 26, 0.82)',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#8fb8d2',
                marginBottom: '10px',
              }}
            >
              StormVector Runtime Error
            </div>
            <h1 style={{ margin: '0 0 12px', fontSize: '1.25rem' }}>
              The app hit a client-side error while loading.
            </h1>
            <p style={{ margin: '0 0 16px', color: '#c5d8e5' }}>
              Refresh once after copying the message below. If it still appears,
              we now have the exact runtime error to fix.
            </p>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#ffd7d7',
              }}
            >
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
)
