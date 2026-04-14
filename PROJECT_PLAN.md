# StormVector App Plan

## Goal

Build a clean desktop weather application for the United States that combines:

- Live radar
- Recent radar playback
- GOES satellite imagery
- NWS forecasts for a selected location
- Severe weather outlooks
- Winter weather outlooks and impacts
- Watches, warnings, and advisories

The app should be simple enough for a casual user to understand quickly, while still exposing richer weather layers for power users.

## Recommendation

Build version 1 as a desktop shell around a modern web map:

- Desktop shell: Tauri
- Frontend: React + TypeScript + Vite
- Map engine: MapLibre GL JS
- Local service layer: Rust in Tauri backend, or a small TypeScript service if we want to move faster first
- Local storage: SQLite

This gives us:

- A native-feeling desktop app with low overhead
- Excellent map and overlay support
- Easier playback controls and animation
- A fast path to a polished UI

## Difficulty

Overall difficulty: moderate for an MVP, hard for a polished national-scale product.

Rough estimate for one experienced developer:

- Proof of concept: 1 to 2 weeks
- MVP: 4 to 8 weeks
- Strong v1 release: 3 to 6 months

Primary complexity drivers:

- Radar source normalization
- Smooth historical playback
- Layer management without overwhelming the UI
- Reliable caching and update timing

## Data Sources

Use official NOAA/NWS sources first wherever possible.

### 1. General NWS Forecasts

Use the NWS API for:

- Forecast periods
- Hourly forecast
- Gridpoint metadata
- Forecast office metadata
- Alerts

Recommended use:

- Search or geolocate a point
- Resolve point to `gridpoints` and forecast office
- Pull standard forecast and hourly forecast
- Pull active alerts for the same area

Notes:

- The NWS API is strong for point forecasts and alerts
- Some specialized forecast elements are easier to represent through derived summaries than by showing raw grid data directly

### 2. Radar

Use official rendered or service-based radar products first.

Recommended starting approach:

- National radar mosaic as a base radar view
- Station radar view when the user clicks or selects a radar site
- Recent frame playback using available service timestamps or cached images

Two v1 modes:

- National mosaic mode
- Local radar site mode

Avoid in v1:

- Raw Level II decoding
- Running a custom radar ingest pipeline
- Supporting every radar product variant

### 3. Severe Outlooks

Use SPC official outlook layers:

- Day 1 convective outlook
- Day 2 convective outlook
- Day 3 convective outlook
- Day 4 to 8 probabilistic outlooks

Recommended presentation:

- `Storm Risk` layer with a day selector
- Default to the categorical view for Days 1 to 3
- Default to probabilistic polygons for Days 4 to 5
- Leave room to expose Days 6 to 8 in an advanced panel

### 4. Winter Products

Winter should be supported explicitly, not just through standard forecast text.

Recommended winter layers for v1:

- Winter Storm Severity Index (WSSI)
- Probabilistic Winter Precipitation Forecasts (PWPF), if the source format is practical
- Active winter watches, warnings, and advisories

Recommended presentation:

- `Winter` layer group
- Impact-focused language first
- Optional advanced toggle for probabilities and accumulation guidance

### 5. Other Weather Types

We should support more than just thunderstorms and winter.

Recommended v1 categories:

- Standard forecast
- Storms / severe weather
- Winter weather
- Rain / flooding indicators
- Heat and cold hazards through alerts and summary messaging

This can be modeled in the UI as a unified `Forecast` panel with tabs:

- Overview
- Hourly
- Hazards
- Storm
- Winter

### 6. Satellite

GOES support is worth adding.

Recommended v1 scope:

- GOES East GeoColor
- GOES East infrared
- Optional water vapor layer later

Recommended presentation:

- Satellite is a top-level layer toggle beside radar
- Reuse the same playback timeline when possible

Why this is worth it:

- Useful at night when GeoColor or IR gives better situational awareness
- Valuable where radar coverage is limited or when viewing large-scale systems

## Product Scope

### MVP

The smallest version that still feels real:

1. Map with U.S. basemap
2. Live radar layer
3. Recent radar playback for available frames
4. Location search and favorites
5. NWS forecast panel for selected location
6. Active alerts overlay and details panel
7. SPC storm outlook layer with day selector
8. Winter layer with WSSI or equivalent impact product
9. Basic GOES satellite layer

### v1

Once the MVP is solid:

1. National mosaic and local radar station modes
2. Better playback controls for radar and satellite
3. Hourly chart cards for temperature, wind, precip chance
4. More hazard-specific summaries
5. Cleaner legends and layer explanation text
6. Offline caching of recent frames and saved locations
7. Side-by-side compare mode for radar vs satellite

### Later

Nice extensions after the core is stable:

1. Lightning data
2. Local storm reports
3. Custom alert thresholds
4. Multi-panel storm chase view
5. Cross-platform mobile companion

## UI Recommendation

The app should stay map-first and avoid looking like a GIS workstation.

### Layout

- Left: main map
- Right: context panel
- Bottom: playback timeline
- Top: search, location, primary layer toggles

### Primary controls

Keep only a few top-level modes:

- Radar
- Satellite
- Forecast
- Hazards

Contextual subcontrols appear only when relevant.

Examples:

- In `Radar`, show product and timeline controls
- In `Satellite`, show channel and timeline controls
- In `Forecast`, show current conditions, hourly, and daily
- In `Hazards`, show alerts, storm outlook, winter outlook

### UX principles

- Use plain language labels
- Default to the most useful layer, not the most technical one
- Put legends next to the active layer, not buried in settings
- Show a clear timestamp on every weather image layer
- Always let the user understand what day and time they are viewing

## Architecture

### Frontend responsibilities

- Render the map
- Manage visible layers
- Drive timeline playback
- Show forecast panels and legends
- Keep the UI state simple and predictable

### Backend responsibilities

- Fetch and normalize NOAA/NWS data
- Cache imagery frames and API responses
- Resolve locations to forecast points and radar sites
- Expose a stable app-specific API to the frontend

### Storage

Use SQLite for:

- Saved locations
- Favorite radar sites
- Cached timeline metadata
- Cached forecast responses
- User preferences

### App services

Suggested internal modules:

- `forecast-service`
- `alerts-service`
- `radar-service`
- `satellite-service`
- `outlook-service`
- `location-service`
- `cache-service`

## Recommended Technical Strategy

### Radar strategy

For v1, prefer image tile or map service based radar layers over raw radar decoding.

That means:

- Faster implementation
- Lower CPU usage
- Easier time playback
- Easier station-to-national transitions

We can later add richer radar products if the first release proves the UX.

### Satellite strategy

Treat GOES as another time-enabled imagery layer with its own source adapter.

The frontend should not care whether frames come from:

- Radar
- Satellite
- Outlook polygons

Instead, the frontend should receive a normalized timeline model:

- layer id
- timestamp
- display label
- frame URL or tile source
- optional legend metadata

### Forecast strategy

Build a normalized forecast domain model so the UI can show all major weather types consistently.

Example categories:

- `general`
- `storm`
- `winter`
- `flood`
- `alerts`

Each category can be derived from:

- NWS point forecast
- Hourly forecast
- Alerts
- SPC outlooks
- WPC winter products

This avoids tying the UI to one specific NOAA endpoint shape.

## Biggest Risks

1. Historical radar availability is inconsistent by product and source
2. Time synchronization between radar and satellite layers can get messy
3. NOAA services can differ in format and update cadence
4. A feature-rich weather app can become cluttered very quickly

Mitigation:

- Start with one clean timeline model
- Use source adapters per product family
- Cache aggressively
- Keep advanced controls hidden by default

## Build Order

### Phase 0: Proof of concept

1. Tauri shell
2. React app
3. MapLibre map
4. Search a location
5. Show NWS forecast panel
6. Overlay one live radar source

### Phase 1: Core weather app

1. Timeline control
2. Radar playback
3. Alerts overlay
4. SPC Day 1 to 5 overlay
5. Favorites and saved locations

### Phase 2: Broaden weather types

1. Winter layer integration
2. GOES satellite layer
3. Hazard summaries
4. Better legends and help text

### Phase 3: Polish

1. Better caching
2. Performance tuning
3. Animation smoothing
4. Usability improvements
5. Packaging and installer

## What I Recommend We Build First

If we want the smartest path:

Build a polished MVP around:

- Search
- Forecast
- Alerts
- Radar playback
- SPC storm outlooks
- GOES satellite

Then add winter guidance once the layer system and timeline are stable.

That order gives us:

- The best visible progress early
- The highest-value user experience quickly
- A reusable architecture for every later product type

## Suggested v1 Success Criteria

The app is successful when a user can:

1. Search any U.S. location
2. See current radar and recent playback
3. Switch to satellite imagery
4. Read the next several days of forecast clearly
5. See whether severe or winter risk exists
6. Understand active alerts without needing meteorology expertise

## Immediate Next Step

Create the actual project skeleton with:

- Tauri
- React
- TypeScript
- MapLibre
- A first forecast service
- A first radar layer implementation

Then wire one end-to-end path:

`search location -> resolve point -> load forecast -> show radar overlay`
