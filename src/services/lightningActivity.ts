import { invoke } from '@tauri-apps/api/core'
import type { LightningActivityFeature } from '../types/weather'

export type LightningActivityResponse = {
  observedAt: string
  features: LightningActivityFeature[]
}

export async function fetchLightningActivity(): Promise<LightningActivityResponse> {
  return invoke<LightningActivityResponse>('fetch_lightning_activity')
}
