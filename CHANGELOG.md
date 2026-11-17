# Release Notes

## 1.5.0

- Added a separate Forecast Briefing window with location-aware model comparisons, saved run history, and on-demand AI interpretation.
- Added GFS daily highs/lows and liquid-equivalent precipitation totals for the first week and days 8-15.
- Added matching NBM precipitation probabilities and accumulation percentiles, plus native six-hour snowfall guidance where available.
- Added a basemap beneath forecast radar imagery and working external NOAA/ECMWF chart and source links.
- Moved the AI key to Preferences with native secure storage on Windows and Linux; environment keys remain supported if the system keyring is unavailable.
- Hardened source-link validation, imagery retry/clearing, and briefing-window shutdown with the main app.

Snowfall conversion, probability selection, interval aggregation, and missing-data behavior are covered by fixtures. Live snowy-weather behavior still needs field testing. Linux packages are built by GitHub Actions; Linux secure storage requires an unlocked Secret Service keyring.
