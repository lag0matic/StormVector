# StormVector Next Phases

## Goal

Keep the app focused on becoming a practical live-weather workstation, not just a map with extra layers.

The current app already covers:

- Point forecast by click/search
- Regional and local radar
- Radar playback
- GOES satellite playback
- NWS alert polygons
- SPC outlooks
- Winter outlooks
- Saved places
- Basic settings, filters, and themes

The next phases should prioritize operational value.

## Recommended Build Order

### Phase 1: Audible Alerting

Why first:

- Fastest high-value upgrade
- Builds on alert system already in place
- Makes the app useful even when it is not being watched continuously

Scope:

- Audio alert on newly detected nearby warnings
- Optional audio alert on nearby watches
- Alert target mode:
  - Selected point
  - Home location
- Radius setting
- Deduplication so the same alert only sounds once
- Simple settings:
  - Warning alerts on/off
  - Watch alerts on/off
  - Radius
  - Follow selected point vs home

v1 success:

- A new nearby Tornado Warning or Severe Thunderstorm Warning triggers once
- Repeated polling does not replay the same alert unless the alert changes

### Phase 2: Storm Track / Time-To-Arrival Tool

Why second:

- Distinctive feature
- High operational value
- Fits storm monitoring better than more radar layers

v1 interaction:

1. User enters track mode
2. User clicks a storm position
3. User drags a line along the expected path
4. User enters speed in mph
5. App shows estimated arrival times along the line

v1 outputs:

- Distance along line
- ETA markers at sampled points
- Optional nearby town labels if close to the track

Later improvements:

- Motion vector inferred from radar frames
- Editable direction and speed handles
- Cone or corridor instead of a single line

### Phase 3: Lightning Feed

Why third:

- Major situational-awareness gain
- Pairs naturally with radar, satellite, and warnings

Scope:

- Real-time lightning strikes as a toggleable layer
- Recent-strike playback window
- Optional density or clustering
- Optional audio cue for very close strikes later

Important note:

- This depends on choosing a feed source with acceptable coverage, refresh cadence, and licensing

### Phase 4: Cameras and Spotter Reports

Why after lightning:

- Strong value, but more integration-heavy
- Feed quality and geography are inconsistent

Scope:

- Camera markers near selected point
- Open camera viewer
- Spotter/local storm report markers
- Click for report text and time

### Phase 5: Radar Product Expansion

Why later:

- Useful, but less transformative than alerting and analysis tools
- Easy to sprawl into too many products too early

Recommended additions:

- Precipitation estimate
- Storm total precipitation
- Echo tops
- Hail/shear only if official exposure is reliable and the UI remains understandable

Rule:

- Add only products that clearly improve decisions during active weather

## Integration Bucket

These are good candidates after the phases above are stable:

- External feed adapters
- Cameras
- Lightning
- Spotter reports
- Mesoanalysis
- Other local or specialty tools

Before each new integration, answer:

1. Does it improve real-time decisions?
2. Can it be explained clearly in the UI?
3. Does it need its own panel, or can it live as a map layer?
4. Is the feed stable and timely enough to trust?

## Short-Term Implementation Plan

### Immediate next sprint

1. Audible alert engine
2. Alert settings
3. Nearby alert polling and dedupe cache
4. First alert sound

### Sprint after that

1. Manual storm-track tool
2. Speed input and ETA labels
3. Town/intersection labeling
4. Exit/reset track mode

## Things Not To Do Yet

- Don’t add lots of niche radar products before alerting exists
- Don’t overbuild a plugin/integration framework before the next two core features land
- Don’t automate storm motion inference until the manual ETA workflow proves useful

## Current Recommendation

Build next:

1. Audible alerts
2. Storm track / ETA tool

Then reassess lightning and external feeds with a clearer operational foundation.
