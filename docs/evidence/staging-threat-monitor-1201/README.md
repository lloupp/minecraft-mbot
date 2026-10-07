# Monitor de ameaça durante o staging — Minecraft 1.20.1 (HEAD f9f24de)

Cenário (plataforma): planner → `explorar` → preflight recusa → staging (`goTo` ~1,8 s) → zombie real
invocado ~1,1 s depois. Julia desligada (`executionAuthority = none`).

**COMPROVADO** (`threat-during-staging.out`): `staging.start` → `goTo` → zombie → `cancel` →
`defend.start` com `vBefore=9 → vAfter=10` (taskVersion invalidado de forma síncrona) →
`staging.end ok:false` → tarefa `CANCELLED` → **nenhum** gather/craft/ação física do owner antigo →
`defend.end: morto` (defesa real) → o planner re-despachou sozinho (+20 s) → o worker voltou ao local
lembrado → staging → gather → craft/equip → exploração.

**Controle sem ameaça** (`control-no-threat.out`): staging normal (1,8 s) e fluxo completo (~19 s):
o monitor não atrapalha.
