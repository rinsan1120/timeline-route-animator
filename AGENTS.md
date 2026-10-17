# AGENTS.md

## Current development baseline (2026-10-17)

- Repository: `rinsan1120/timeline-route-animator`. The single source of truth for regular development, documentation, and production GitHub Pages deployment is the latest `main` branch.
- V1.3 was merged from `feature/video-editor-v13` into `main` in PR #28 (merge commit `b91055b`). Use a different branch only when the user explicitly designates it; never infer the target from a default-branch setting.
- Before technical investigations, design decisions, code changes, Codex instructions, or GitHub operations, read the target branch's `AGENTS.md`, `HANDOFF.md`, and `docs/v13-improvements/JourneyMapStudio_Development_Lessons.md`. Apply relevant Lessons to the current task; previous reading does not replace a fresh check.
- Before a GitHub write, confirm the repository, explicit target branch, changed paths, expected impact on other branches and the deployment workflow, and the user's authorization. Never silently substitute `main` for an explicitly designated feature branch.
- The current `.github/workflows/deploy.yml` deploys on `main` pushes, including documentation-only commits. Direct GitHub edits immediately create remote commits; Codex changes normally stop at `git commit` without `git push`, which the user handles.
- Keep unresolved issues in `docs/v13-improvements/ISSUE_TRACKER.md` and GitHub Issues. A merged implementation does not automatically close an issue or establish that its reported problem is resolved; consult live issue state and obtain the user's direction for closing issues.
- Older V1-only descriptions and feature-branch commit references elsewhere in this file and `HANDOFF.md` are historical context, not authority to remove already implemented functionality. Issue #6 tracks broader cleanup of obsolete V1 descriptions.
- Keep changes minimal and preserve existing preview/MP4 perceptual parity, save formats, undo/redo, UI, and mobile behavior. Do not introduce extra test, browser, device, or regression work without the user's request or a concrete high-risk need.

---

## Project

This repository contains **Journey Map Studio** (historically named Timeline Route Animator).

The app has three modes: **移動実績参照モード** (import Google Maps Timeline JSON, choose date/time ranges and edit an animated route), **計画モード** (create and edit a route by placing map points), and **スポット画像モード** (annotate a map and export a PNG image). Timeline and plan projects can be saved and restored as work/plan JSON. The first two modes use a video editing workspace with browser-side 1920×1080 / 30fps MP4 generation. Historical V1 feature limitations do not override currently implemented functionality.

---

## Core Product Rules

- The app must remain fully client-side.
- Do not add a backend unless explicitly requested.
- Do not upload Google Timeline JSON or location data to any external server.
- Do not send coordinates or Timeline contents to analytics.
- Do not automatically persist the original Timeline JSON to localStorage or other persistent browser storage.
- Android Chrome is a primary mobile target; account for Samsung Internet, iPhone Safari/iOS Chrome, narrow and foldable screens where relevant.
- Keep Windows Chrome/Edge and macOS Safari/Chrome usable. Do not guarantee browser/device capabilities without evidence.
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
- The current GSI (国土地理院) vector-map style, related PMTiles land layers and terrain support
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

`semanticSegments[].timelinePath` is the primary editable route source for the Google Timeline import workflow, unless current code or a user-approved change specifies otherwise.

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

Route correction and plan-point placement are intentionally manual.

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
- Reuse the current `src/map/gsiStyle.ts` and `src/map/gsiVectorConfig.ts` definitions and their GSI tiles, attribution, land layers and visual configuration.
- Do not silently replace them with the historical OSM raster/OpenFreeMap style, or introduce unapproved API keys, dependencies or services.
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

移動実績参照モード allows selecting a **start date and an end date**, with From/To times defining the date-time extraction range. Multiple dates can be loaded together. Users can then choose all days or a selected DAY for display/output while retaining the other imported days.

Do not restore the historical one-day V1 restriction. Preserve the current handling of timestamps, timezone, DAY numbering, selected-day output and work-JSON persistence.

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

Current target output:

- 1920x1080
- 30fps
- MP4
- H.264 / AVC
- initial movement duration 10 seconds (intro, stop and ending times are separate settings)

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

For fixed overview-camera segments, reuse the background when possible. Follow-camera and intro-zoom rendering may require camera-dependent map preparation. Preserve the existing shared preview/MP4 composition and its perceptual match.

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

## Contextual Help

- When adding a new user-facing setting, editing tool, operation mode, menu item, map control, or toolbar item anywhere in the UI, evaluate contextual help as part of the implementation even when the user does not explicitly request it.
- Add contextual help in the same change whenever a first-time user may not readily understand the feature's purpose, result, or important constraints.
- Add help copy to the existing shared help definition file; do not embed help bodies directly in `App.tsx` or other UI components.
- Reuse the existing `HelpTip` component by default.
- Do not make help depend on hover. It must open and close by click or tap on both desktop and Android and remain keyboard-accessible.
- Keep help copy concise and in Japanese. Explain what the feature is for, what happens when it is used, and any easily misunderstood constraints in terms a first-time user can understand; do not merely restate the UI label or focus on internal implementation.
- If the user explicitly requests that no help be added, follow that instruction.
- Do not mechanically add help to self-explanatory operations such as delete, Undo, save, or reset unless their behavior becomes complex.

---

## 作業効率の原則

ユーザーから明示的に要求されていない網羅的テスト、広範な回帰検証、無関係なコード調査は行わない。必要な確認は変更内容とリスクに応じて判断し、過剰な検証を避ける。実装完了後は不要な追加作業をせず、結果を簡潔に報告する。

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

For Codex changes, work against latest `main` unless the user explicitly designates another branch. Finish with a descriptive local `git commit` and **do not run `git push`**; the user handles Push. Direct GitHub edits create remote commits and can trigger Pages redeployment even for documentation changes, so confirm the authorized branch and deployment impact before using them.

---

## Regression Prevention

- Protect existing features in all three modes, point editing, Undo/Redo, DAY/bubble/START/GOAL/HUD, animation ranges, camera and Zoom, preview/MP4/PNG output, persisted JSON compatibility and mobile/PC layouts.
- Preview and MP4 must match **perceptually to a human viewer**; imperceptible pixel or sub-millisecond differences are not defects solely for being unequal.
- Review only affected code and closely related callers, and avoid unrelated refactors, attribute/DOM contract changes and unapproved behavioral changes.
- Consider screen transitions, non-active DOM/overlays, editing/cancel/commit, keyboard and touch state where the change affects them. Do not mistake an unconfirmed risk for a reproduced defect.
- **Do not request tests, builds, browser automation, device checks, MP4 visual reviews or wide regression suites by default.** Do not add ritual "minimal test" language to Codex instructions. The user normally verifies behavior following implementation.
- Exception: verification may be requested by the user or justified by a concrete high-risk data loss, security or major compatibility concern; keep its scope narrow.
- Existing tests, CI and documented developer commands remain available and are not removed by this policy.

---

## Documentation

Keep README and project documentation consistent with implementation.

Before technical changes, read the target branch's `AGENTS.md`, `HANDOFF.md`, `docs/v13-improvements/JourneyMapStudio_Development_Lessons.md`, and relevant specifications under `docs/`.

If older documents and current `main` code differ, use the current implementation as the baseline; distinguish historical decisions from current requirements, and respect the user's latest approved specification.

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

## Current Scope and Historical V1 Limits

Historical V1 exclusions are **not** present-day prohibitions. Current implementations include multi-day Timeline ranges, DAY-specific outputs, route-follow camera modes, oblique view, intro zoom, work/plan JSON and three production modes. Do not remove or forbid these features.

Do not introduce unrelated new functionality (for example routing APIs, automatic road snapping, unapproved cloud project storage, 4K or 60fps export) without the user's direction. For GPX/KML and other file formats, verify the latest code and relevant approved requirements instead of relying on an old V1 exclusion list.
