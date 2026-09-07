# AGENTS.md

## Project

This repository contains **Timeline Route Animator**.

The app loads Google Maps Timeline JSON exported from Android, lets the user select one day and a From/To time range, manually correct the route on a map, preview a moving marker, and export a 1920x1080 / 30fps MP4 for use in touring videos.

---

## Core Product Rules

- The app must remain fully client-side.
- Do not add a backend unless explicitly requested.
- Do not upload Google Timeline JSON or location data to any external server.
- Do not send coordinates or Timeline contents to analytics.
- Do not automatically persist the original Timeline JSON to localStorage or other persistent browser storage.
- Target Android Chrome first.
- Desktop Chrome on macOS/Windows must also remain usable.
- UI text must be Japanese.
- Code identifiers, filenames, interfaces, functions, classes, and variables must be English.
- Preserve GitHub Pages compatibility.

---

## Tech Stack

Use the existing project stack unless explicitly instructed otherwise.

- React
- TypeScript
- Vite
- MapLibre GL JS
- OpenFreeMap
- Web Worker for large Timeline JSON parsing
- WebCodecs for video encoding
- Mediabunny for MP4 muxing

Do not replace major libraries or architecture without first checking whether the change is actually necessary.

---

## Google Timeline Rules

These rules are critical.

### Activity Type Must NOT Control Route Inclusion

Never use:

- `activity.topCandidate.type`
- `MOTORCYCLING`
- `IN_PASSENGER_VEHICLE`
- `WALKING`
- `IN_TRAIN`
- or any other activity classification

to decide whether route data should be included or excluded.

Google's activity classification is unreliable for this use case.

Activity type may be retained or displayed only as reference metadata.

Route extraction must be based on:

- selected date
- selected From/To time range
- actual location data present in that range

### Base Route

`semanticSegments[].timelinePath` is the primary editable route source for V1.

### rawSignals

`rawSignals[].position` is reference measurement data.

Do not automatically merge `rawSignals.position` into the editable route.

It may contain low-accuracy points, especially from sources such as:

- `CELL`
- `WIFI`
- `WIFI_ONLY`

Use fields such as:

- `accuracyMeters`
- `source`
- `timestamp`
- `altitudeMeters`
- `speedMetersPerSecond`

for display and diagnostics only unless a later requirement explicitly changes this behavior.

Do not automatically delete low-accuracy points from the source data.

---

## Manual Editing Rules

V1 route correction is intentionally manual.

Required behavior includes:

- select route point
- move route point
- add route point
- add multiple route points
- delete route point
- undo
- redo
- restore original route

Do not add automatic:

- routing
- road snapping
- route completion
- OSRM
- Valhalla
- Google Directions
- Mapbox Directions
- AI route estimation

unless explicitly requested.

The original Timeline JSON must never be modified.

Maintain a clear distinction between original route data and edited route data.

---

## Map Rules

- Use MapLibre GL JS.
- Use OpenFreeMap.
- Do not require an API key.
- Keep attribution visible where required.
- The generated video must also include required attribution.
- Use `fitBounds` or equivalent behavior so the selected route is initially visible.
- Avoid rendering large numbers of raw points as individual React DOM elements.
- Prefer MapLibre GeoJSON sources and layers.

---

## Large File Handling

Timeline JSON can be tens of megabytes.

Therefore:

- Parse large JSON in a Web Worker where practical.
- Do not store the full parsed Timeline JSON in React state.
- Avoid unnecessary deep copies.
- Avoid blocking the main UI thread.
- Do not duplicate large arrays without a clear reason.
- Extract and retain only the data required by the current workflow where practical.

Unknown JSON fields should normally be ignored rather than causing the whole import to fail.

---

## Time Filtering

The user selects:

- exactly one date
- optional From time
- optional To time

Default time range:

- `00:00`
- `23:59`

Do not process multiple days as one route in V1.

Respect the timestamps and timezone information present in the Timeline data.

---

## Animation Rules

Marker movement must be distance-based, not point-index-based.

Correct approach:

1. calculate geographic distance for each route segment
2. build cumulative distance
3. map animation progress to total route distance
4. find the active segment
5. interpolate within that segment

The marker should move at visually constant speed along the route.

If a directional marker is used, calculate bearing from the route geometry and rotate the marker appropriately.

---

## Video Export Rules

V1 target output:

- 1920x1080
- 30fps
- MP4
- H.264 / AVC
- default duration around 10 seconds

Video export must remain browser-side.

Do not introduce a server-side renderer.

Prefer:

- Canvas / OffscreenCanvas
- WebCodecs
- Mediabunny

Do not make `ffmpeg.wasm` a required dependency unless explicitly requested.

Use feature detection for:

- `VideoEncoder`
- required H.264 configuration

Show a clear Japanese error message when required browser capabilities are unavailable.

Do not render or fetch map tiles again for every video frame if a static background can be reused.

Close `VideoFrame` and similar resources after use.

---

## Mobile UX

Android Chrome is a primary target.

Therefore:

- do not rely on hover
- make primary controls tappable
- keep touch targets reasonably large
- keep the map area as large as practical
- support narrow screens around 360px
- avoid desktop-only drag/drop assumptions
- keep editing actions accessible near the bottom or another touch-friendly area

---

## Privacy

Google Timeline data is highly sensitive.

Never:

- commit real Timeline JSON
- upload it to GitHub
- send it to remote APIs
- include real coordinates in analytics
- include real Timeline content in logs intended for remote collection

The repository should ignore private sample data such as:

- `sample-data/`
- `*.private.json`
- actual Timeline export files

Synthetic or anonymized fixtures may be committed for tests.

---

## Git / Repository Rules

Before making changes:

1. inspect the existing repository
2. understand the current implementation
3. avoid unnecessary rewrites

Do not replace working code wholesale when a focused change is sufficient.

Preserve existing behavior unless the requested change explicitly supersedes it.

Do not commit:

- `node_modules/`
- `dist/`
- `.env`
- real Timeline JSON
- private local sample data

Commit source and reproducibility files such as:

- `package.json`
- `package-lock.json`
- `src/`
- `public/`
- `vite.config.*`
- `tsconfig*.json`
- `.github/workflows/`
- tests
- documentation

Preserve GitHub Pages deployment support.

---

## Regression Prevention

Regression prevention is a high-priority requirement.

When changing existing code:

- Do not break features that were already working.
- Before editing, inspect the affected code path and identify related behavior that could regress.
- Prefer the smallest change that satisfies the request.
- Do not rewrite unrelated components, utilities, state management, types, CSS, or configuration without a concrete need.
- Preserve existing IDs, data attributes, event wiring, interfaces, filenames, public function contracts, and persisted data formats unless the requested change explicitly requires changing them.
- Preserve existing responsive behavior on both desktop and Android/mobile layouts.
- Preserve Japanese UI text and existing interaction behavior unless the requested change explicitly changes them.
- When touching shared utilities or types, check all call sites before modifying their contract.
- When fixing one issue, verify adjacent flows that depend on the same code.
- Add or update regression tests for bugs that have been fixed when practical.
- Run the existing test suite and build after significant changes.
- If the repository has lint, type-check, or E2E commands, run the relevant ones too.
- Do not delete a working fallback or compatibility path unless it is confirmed obsolete.
- Do not silently remove existing features because they complicate a new implementation.
- If a requested change conflicts with existing behavior, change only the behavior explicitly superseded by the request.
- If a refactor is necessary, keep behavior equivalent first, verify it, and then implement the functional change separately where practical.

Before declaring work complete, verify at least:

1. the newly requested behavior works
2. previously working core flows still work
3. desktop layout still works
4. Android/mobile layout still works
5. date/time selection still works
6. route display and editing still work
7. Undo/Redo still works when affected
8. rawSignals display still works when affected
9. animation preview still works when affected
10. video export/build still works when affected

Treat regressions as defects, not acceptable side effects of unrelated changes.

---

## Verification

After significant changes, run the relevant checks.

At minimum, when possible:

```bash
npm test
npm run build
```

Also run lint/type-check commands if the repository defines them.

Do not report a task as complete while known build or test failures remain unexplained.

---

## Required Tests

Maintain or add tests for important behavior, especially:

- Google coordinate string parsing
- date extraction
- From/To filtering
- timelinePath chronological ordering
- activity type does not filter route data
- route distance calculation
- cumulative distance interpolation
- point add
- point move
- point delete
- undo
- redo

A test should explicitly protect against accidentally filtering the route by `MOTORCYCLING` or any other activity type.

---

## Documentation

Keep README and project documentation consistent with implementation.

Before making architectural changes, read any existing specification under `docs/`, especially a file such as:

- `docs/SPEC.md`

If implementation and specification disagree, do not silently guess. Follow the latest explicit user requirement and update documentation accordingly.

---

## Change Discipline

When modifying existing code:

- prefer small, understandable changes
- avoid unrelated refactors
- avoid dependency churn
- avoid changing public types or component contracts without need
- keep behavior deterministic
- add comments only where they improve maintainability
- do not add unnecessary abstractions

When fixing a bug, identify the root cause where practical instead of only masking the symptom.

---

## Current V1 Boundary

V1 does NOT require:

- automatic GPS gap completion
- road snapping
- routing APIs
- GPX input
- KML input
- 4K export
- 60fps export
- camera-follow animation
- automatic zoom animation
- 3D map
- elevation graph
- arbitrary PNG marker upload
- multi-day route editing
- cloud project storage

Do not expand scope into these areas unless explicitly requested.
