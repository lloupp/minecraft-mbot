# Changelog — minecraft-mbot

## v1.0.0 (2026-09-26)

### Features
- feat: add event log, death recovery, replanning engine, route memory, verification framework and status server (PR #36)
- feat: add experimental statemachine exploration backend (PR #35)
- feat: add memory with clarification and origin tracking (PR #27, open)
- feat: build from blueprints (.schem/.litematic/.nbt) (PR #28, open — uses `bot._placeBlockWithOptions`, needs adapter before merge)
- feat: combat with shield, critical hits and custom-pvp (PR #26, open)
- feat: server pz-server with Forge 1.20.1 zombie survival (PR #20, open)
- feat: add non-lethal animal production (PR #33)
- feat: add optional runtime plugins and resilient autonomy (PR #23)
- feat: add persistent waypoints, patrol and directed exploration (PR #11)
- feat: add animal pens and bounded population management (PR #14)
- feat: add persistent automatic herd targets (PR #18)
- feat: lure animals into species pens (PR #17)
- feat: add animal husbandry and farmer tasks (PR #12)
- feat: add colony project system (PR #6)
- feat: fabricate, cook and combat; protocol 26.3 fixes (PR #3)
- feat: add companion survival autonomy and native 1.20.1 profile (PR #9)
- feat: persist colony and add physical farm/mine smoke test (PR #7)

### Bug Fixes
- fix: orquestrador reads chest without follow changing pathfinder goal (PR #22)
- fix: bugs da colônia — broken pen, duplicate farmers, young animals, gate, capture, burial (PR #21)
- fix: workers skip unreachable blocks, defend and don't block the chest (PR #10)
- fix: isolate Mineflayer options for colony workers (PR #29)
- fix: find reachable ground for night shelter (PR #30)
- fix: port live Minecraft 1.20.1 regressions (PR #16)
- fix: harden runtime from Minecraft 1.20.1 tests (merged in #22)

### Documentation
- docs: add statemachine and builder adoption roadmap (PR #32)
- docs: evaluate Minecraft 1.20.1 plugin options (PR #15)

### Spikes
- spike: validate mineflayer-statemachine compatibility (PR #34)

### Merged (not released separately)
- PRs #1, #2, #4, #5, #8, #13, #19, #20, #24, #25, #31
