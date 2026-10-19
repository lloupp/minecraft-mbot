# Evidência — integridade e segurança, 2026-10-10

Código base: `49ea01e2971cbc957edec989115931d2d96261f4` da PR #88. As evidências históricas não foram alteradas.

## Resultado final

- `npm ci`: instalação completa pelo lockfile. A primeira instalação com scripts/optional omitidos não suportava o visualizador (canvas); a suíte inicial foi interrompida, não considerada aprovada. A instalação completa resolveu a dependência e a suíte final terminou normalmente.
- `npm run check`: exit 0.
- `npm test`: **676/676**, zero falhas/cancelamentos/skips; `node-final.txt`.
- Testes dirigidos de abrigo, memória, integração de worker e servidores HTTP: **85/85**; `targeted-final.txt`.
- `python3 -m unittest discover -s test -p 'test_*sidecar.py'`: **13/13**; `python-final.txt`.
- `python3 -m py_compile scripts/laya-decision-server.py scripts/nanoandy-decision-server.py scripts/julia-decision-server.py`: exit 0.
- `MBOT_JULIA_AUTHORITY=0 node scripts/player-loop-gauntlet-v2.js`: **60 cenários determinísticos**, sucesso 100%, zero escolhas inválidas, loops e violações de segurança; `gauntlet-summary.json`. Endpoints de modelos ausentes: modelos não executados, nenhuma comparação nova de qualidade.
- Novos testes de abrigo: **5/5 falham no código base** (`night-baseline.txt`). Novos testes de memória reproduzem perda de refresh, perda de retry e regressão de snapshot (`memory-baseline.txt`). Arquivos de implementação foram restaurados após a reprodução, antes da suíte final.

## Minecraft real, dirigido

Servidor Mojang Java **1.20.1**, JAR SHA1 `84194a2f286ef7c14ed7ce0090dba59902951553`, 47.791.053 bytes. Java 17, cliente Mineflayer e pathfinder reais; versão explícita 1.20.1. Servidor e cliente executados no mesmo processo de teste (child process) por isolamento de rede entre sessões do ambiente.

Servidor descartável, somente `127.0.0.1:25575`, offline, survival, peaceful, flat, dia fixo. Bot `safety_smoke` sem OP. Console prepara plataforma de terra em y=66..70 e espaço livre acima, e introduz lava depois da chegada. Não há execução de Julia, Laya ou outro modelo.

1. Cliente confirma `safeToDig` na plataforma.
2. Navegação real chega ao alvo. Harness pausa o retorno de `goto` até receber atualização de lava lateral em `(1,69,0)` enviada pelo console.
3. `digShelter` revalida e recusa a ação; **zero chamadas de dig**, superfície em `(0,70,0)` permanece terra.
4. Console restaura terreno. Executor cava **três blocos**, recolhe material, coloca a tampa; leitura do bloco no cliente confirma terra.
5. `leaveShelter` remove tampa e sobe; posição final `(1.5,71.02442408821369,0.5000000000000087)`.
6. Cliente desconecta; servidor recebe `stop` e salva o mundo.

Saída bruta final: `live-smoke.log`. Fonte exata do harness executado: `live-smoke.cjs`. Para repetir, disponibilize um **diretório de servidor descartável** em `/tmp/mbot-mc1201`, com server.jar, EULA aceita e configuração acima (spawn `(4,71,0)`, raio zero). Execute `MBOT_REPO="$PWD" MBOT_JULIA_AUTHORITY=0 node docs/evidence/shelter-memory-integrity-20261010/live-smoke.cjs`. Não use esse harness com um mundo existente: ele prepara terreno por console.

**Limites:** teste físico dirigido do abrigo; não é soak natural, não testa monstros, fome, reconexão ou dois workers. Persistência e API foram verificadas por arquivos/HTTP reais com fixtures para mundo/executor; a Tool API ainda não está conectada ao aplicativo. Nenhum resultado deste ciclo comprova autonomia completa.
