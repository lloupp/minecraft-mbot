# Player Loop V2: Laya × NanoAndy

This experiment compares `rules`, Laya, and `DedeProGames/NanoAndy-350M` on
the same V2 scenarios. Decisions are intentions chosen from the supplied valid
candidates. Safety rules and deterministic execution stay in `lib/player-loop.js`.
NanoAndy runs in a separate CPU-only Python sidecar and has no Mineflayer import,
socket, or game-control API.

## Run the comparison

Install NanoAndy dependencies and start its local selector:

```bash
python -m pip install -r scripts/requirements-nanoandy.txt
python scripts/nanoandy-decision-server.py
```

Start the existing Laya selector in another terminal:

```bash
python -m pip install -r scripts/requirements-laya.txt
USE_TF=0 python scripts/laya-decision-server.py
```

Run five paired repetitions by default. For a larger sample, set
`PLAYER_LOOP_REPEATS`; the same scenario order and state fixtures are used for
each engine. The services must be started before the runner:

```bash
LAYA_PLAYER_LOOP_URL=http://127.0.0.1:8765/choose \
NANOANDY_PLAYER_LOOP_URL=http://127.0.0.1:8766/choose \
PLAYER_LOOP_REPEATS=5 \
MBOT_PLAYER_LOOP_OUT=.data/player-loop-v2-comparison.json \
npm run gauntlet:player-loop
```

The report includes per-scenario success, safety violations, loops, invalid
choices, technical and invalid-choice fallbacks, objective resumptions, model
requests versus confirmed inference calls, p50/p95 latency, median scenario
time, and peak process RSS when exposed by the sidecar.
For reliable CPU/RAM measurements, run the same machine without unrelated
workloads. Rules form a safety and outcome baseline; agreement with rules does
not select the preferred model.

## Adaptive gather scenario

`gather_then_prepare_then_explore` permits early exploration while unarmed. A
zombie is introduced after the first exploration progress, outside the
immediate creeper emergency range. Passing requires surviving the reaction,
handling the threat coherently, and resuming/completing the original objective.

## Safety gate

`shadow_readiness` is computed per model. It requires at least 80% scenario
success, zero safety violations, loops, invalid choices and technical fallbacks,
all critical scenarios passed, and p95 latency at or below 2 seconds. It does
not permit live control.

`lib/parallel-shadow.js` prepares non-blocking, parallel proposal collection for
a later integration. It returns immediately and records model proposals through
a callback; the current deterministic runtime remains the sole executor. It is
not wired into the Minecraft runtime in this experiment.

NanoAndy model card and usage: <https://huggingface.co/DedeProGames/NanoAndy-350M>.
