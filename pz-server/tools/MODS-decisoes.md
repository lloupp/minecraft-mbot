## Decisões e substituições

- **Fonte única: Modrinth.** Os 27 mods pedidos, as 8 dependências e o addon de som
  (36 jars no lock) têm build oficial para Forge 1.20.1 no Modrinth, publicada pelos
  próprios autores. A API do CurseForge
  exige chave; usar só o Modrinth dá URLs estáveis e SHA-512 verificável.
- **"Spoilage" → Spoiled (Mrbysco).** Não existe mod "Spoilage" com build Forge 1.20.1 no
  Modrinth; o Spoiled é o mod de deterioração de comida mantido para 1.20.1 Forge
  (versão marcada como *beta* pelo autor, é a única para 1.20.1).
- **McJtyLib não é necessário.** The Lost Cities 7.x e In Control 9.x para 1.20 não dependem
  mais dele (conferido no `mods.toml` de cada jar e na inicialização do servidor).
- **Xaero Lib** vem embutido (JarJar) nos jars do Xaero's Minimap e World Map; não há
  download separado.
- **Dependências que o pedido não citava:** Atlas Lib (The Hordes) e Cloth Config
  (Better Combat).
- **Adicionado: TACZ-Sound Attracts Zombies.** Addon só de servidor (sem canal de rede) que
  faz tiros do TaCZ virarem som para o Zombie Awareness; o silenciador reduz o alcance.
  Atende "zumbis reagem a sons" também para armas de fogo.
- **Só servidor:** The Lost Cities e In Control (o Modrinth marca "client unsupported")
  e o addon de som. O jogador não precisa deles para entrar.
- **Só cliente:** Embeddium e Entity Culling (o Modrinth marca "server unsupported"),
  Xaero's Minimap/World Map, Sound Physics Remastered e JEI (sem função no servidor).
- **Jade e Clumps nos dois lados:** o Jade no servidor envia dados extras para o tooltip;
  o Clumps funciona no servidor e é recomendado também no cliente.
- **Versões não-release:** Serene Seasons 9.1.0.3 (beta), Spoiled 2.2.2 (beta),
  playerAnimator 1.0.2-rc1 (exigido pelo Better Combat), GlitchCore 0.0.1.1 (beta) e
  Sound Physics Remastered 1.5.1 (alpha) são as builds mais novas para Forge 1.20.1
  publicadas pelos autores. Nenhum mod pedido foi removido por causa disso.
- **Forge 47.4.10** é a versão *recommended* do Forge para 1.20.1. O maior requisito entre
  os mods é SecurityCraft (Forge ≥ 47.3.30).
