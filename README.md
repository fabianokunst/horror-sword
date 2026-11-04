# Horror Sword — O Caçador da Noite

Jogo de ação em mundo aberto com clima gótico (Drácula / Van Helsing), feito em **Three.js** com visual estilo PlayStation 1.

## Rodar

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/
```

O jogo precisa do build: abrir o `index.html` da raiz direto (ou servir a raiz do repositório) não funciona, porque ele aponta para `src/` e importa `three` do `node_modules`.

### Teste automático

```bash
npm test         # ~30 s: monta uma cópia de desenvolvimento, joga no Chrome sem janela e confere o básico
```

[`tests/smoke.mjs`](tests/smoke.mjs) gera um build de desenvolvimento numa pasta temporária (mantém o gancho `window.__hs`), serve numa porta livre e joga no Chrome instalado (variável `CHROME_PATH` para escolher outro). Falha se houver qualquer erro na página ou se quebrar: início da caçada, vez de atacar, aviso de golpe, esquiva perfeita e contra-ataque, trava de alvo, colisão da câmera, criaturas contornando uma casa e o layout dos botões de toque. Como usa pasta e porta próprias, várias sessões podem rodar ao mesmo tempo.

### Publicar (GitHub Pages)

Cada push na `main` roda [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que faz o build, roda o `npm test` e só então publica o `dist/` em https://fabianokunst.github.io/horror-sword/. Se o teste falhar, o site continua na versão anterior. Pull requests rodam build e teste, sem publicar. O `vite.config.js` usa `base: './'`, então o build funciona em qualquer subcaminho. Em **Settings → Pages → Build and deployment → Source** precisa estar **GitHub Actions** (com "Deploy from a branch" o Pages serve o código-fonte cru: tela sem CSS e jogo parado).

## Controles

| Tecla | Ação |
|---|---|
| WASD / Mouse | mover / câmera |
| Shift | correr |
| Espaço | pular |
| Clique esquerdo | espada (combo de 3 golpes, mira assistida) |
| Clique direito / Ctrl / C | esquiva com invencibilidade |
| Q / F / botão do meio | besta de prata (6 virotes, recarregam sozinhos) |
| R | travar alvo (câmera, espada e besta miram a criatura; um movimento rápido do mouse para o lado troca de alvo) |
| Tab / I | inventário (no celular: botão ITENS) |
| E | pegar item brilhando no chão · rezar no santuário · falar com o mercador |
| M | liga/desliga o som (também há o botão SOM no menu) |
| Esc | pausa |

### Controle (Xbox, PlayStation e similares)

| Botão | Ação |
|---|---|
| Analógico esquerdo / direito | mover / câmera |
| A (✕) | pular · nos menus: confirmar / CAÇAR / CONTINUAR |
| B (◯) | esquiva · nos menus: voltar |
| X (▢) / RB | espada (segure para o combo) |
| Y (△) / RT | besta |
| LB / R3 | travar alvo |
| LT / L3 | correr (segurando) |
| Direcional ↑ | pegar item · no inventário e nas cartas de dom: mover o cursor |
| Back / Select | inventário |
| Start | pausa / continuar |

O controle vibra ao levar golpe e na esquiva perfeita (onde o navegador permite). Em **Configurações → Controles** dá para mudar a sensibilidade da câmera (mouse, toque e controle), inverter o eixo vertical e desligar a vibração; em **Som**, os volumes de música, efeitos e ambiente.

### Celular e tablet

Funciona de celulares pequenos (iPhone SE) a monitores ultrawide, em paisagem ou retrato (paisagem é recomendada). Em tela de toque os controles aparecem sozinhos:

| Toque | Ação |
|---|---|
| Arrastar no lado esquerdo | analógico flutuante para mover |
| Arrastar no lado direito | câmera (dá para mover e girar ao mesmo tempo) |
| Botão da espada | golpe; segure para o combo completo |
| ESQUIVA / BESTA / PULO | como no teclado (o número na besta é a munição) |
| ALVO | trava/solta o alvo (aceso enquanto travado); deslizar rápido no lado direito troca de alvo |
| CORRER | liga a corrida; desliga ao soltar o analógico |
| ITENS / ❚❚ | inventário / pausa |
| Toque no aviso do item | pegar item |

Ao tocar em CAÇAR o jogo entra em tela cheia (no Android também trava em paisagem). Se o app for para segundo plano, o jogo pausa. Usar mouse/teclado ou toque no meio da partida troca o esquema de controle automaticamente.

**Instalar como app e jogar offline:** o site é um PWA. No Android/Chrome, use "Instalar app" (ou "Adicionar à tela inicial"); no iPhone, Compartilhar → "Adicionar à Tela de Início"; no computador, o ícone de instalar na barra de endereço. Depois da primeira visita o jogo abre sem internet. Os ícones são desenhados por código em [`scripts/make-icons.mjs`](scripts/make-icons.mjs) (`npm run icons` regrava `public/*.png`) e o `dist/sw.js` é gerado no build pelo plugin em [`vite.config.js`](vite.config.js), com a lista exata de arquivos e um nome de cache que muda a cada versão (páginas: rede primeiro; arquivos: cache primeiro).

## Combate

- **Aviso de golpe:** quando uma criatura começa um ataque, o corpo pisca em vermelho e um brilho vermelho acende nos olhos até o golpe cair (além do som de aviso). O lobisomem se agacha antes do salto e pula para onde você estava no fim do agachamento.
- **Vez de atacar:** só algumas criaturas atacam ao mesmo tempo; as outras rondam em volta esperando a vez. Peregrino 2, Caçador 3, Van Helsing 3, Pesadelo 4, e +1 por ciclo de novo jogo+ (até +2). Chefes não esperam.
- **Esquiva perfeita:** esquivar no último instante antes do golpe (até 0,25 s antes) deixa as criaturas em câmera lenta por ~1 s (a imagem esfria), devolve stamina e abre uma janela de contra-ataque em que a espada causa 1,75× de dano.
- **Golpes especiais:** o **vampiro** dá uma investida rápida em linha reta a meia distância (se encolhe e os olhos brilham antes); a **noiva** grita quando você está perto — sem esquiva, o caçador fica atordoado por um instante; a **bruxa** (nova, a partir do capítulo III) fica a 8–13 m, lança fogo-fátuo verde que persegue um pouco e foge quando você se aproxima — a besta é a melhor resposta. Todos dão para interromper com um golpe e contam na vez de atacar.
- **O Conde em três fases** (marcadas na barra de vida): **I** golpes e teleporte em névoa com morcegos; **II** (abaixo de 66%) ele vira névoa por um instante (intocável), chama morcegos e passa a lançar leques de 3 orbes de sangue quando você se afasta — com o mesmo brilho nos olhos antes, e também dá para fazer esquiva perfeita neles; **III** (abaixo de 33%) fúria: aura vermelha, mais rápido, golpe duplo, teleporta mais e lança 5 orbes. Um golpe enorme não pula fases.
- **Caminhos:** criaturas a pé que não enxergam o caçador (uma casa, um muro, a cerca do cemitério no caminho) dão a volta pelo obstáculo em vez de empacar nele. O lobisomem só salta com o caminho livre, e o vampiro reaparece em chão aberto atrás de você ou, com uma parede às suas costas, pelos lados. Morcegos e noivas voam por cima de tudo.
- **Travar alvo:** R (ALVO no toque) trava a criatura para onde a câmera aponta ou a mais próxima. A câmera acompanha, o caçador fica de frente para ela ao andar (correr quebra) e espada e besta miram nela. Quando ela morre, a trava passa para a criatura mais próxima; longe demais (34 m), solta.

## Campanha

A caçada é dividida em capítulos; cada um tem um objetivo (linha no topo da tela, alvo ◆ no minimapa):

| Cap. | Nome | Objetivo |
|---|---|---|
| I | A Primeira Noite | sobreviver até o amanhecer |
| II | O Cemitério | destruir o caixão (guardado por vampiros e carniçais) |
| III | Uivos no Moinho | destruir o caixão (guardado pelo Lobo Alfa e a matilha) |
| IV | As Noivas da Abadia | destruir o caixão (guardado pelas três noivas, que não queimam ao sol) |
| V | Lua de Sangue | abater 30 criaturas sob a lua de sangue; abre o portão do castelo |
| VI | O Conde Drácula | invadir o pátio e derrotar o Conde |

Só o caixão do capítulo atual pode ser quebrado. A cada capítulo as criaturas ganham vida/dano e a chance de virem como **elite** (maiores, com brilho vermelho, 3× almas). Ao derrotar o Conde começa o **Ciclo II** (novo jogo+): tudo volta ao lugar, mais forte, com todas as criaturas soltas desde o capítulo I; o ciclo se repete sem limite.

**Dificuldade** (escolhida ao começar uma caçada nova):

| | Criaturas | Ao cair |
|---|---|---|
| Peregrino | 70% vida, 60% dano | volta ao início do capítulo mantendo a experiência |
| Caçador | normal | volta ao início do capítulo, no nível do checkpoint |
| Van Helsing | +40% vida, +35% dano, mais criaturas e elites, +25% XP | igual ao Caçador |
| Pesadelo | +80% vida, +70% dano, +50% XP | o save é apagado (fica só o recorde) |

**Evolução:** almas dão experiência; cada nível dá +4 de vida, +2% de dano e a escolha de 1 entre 3 **dons** (vigor, couraça, fôlego, lâmina rúnica, alcance, golpe de misericórdia, sede de sangue, colheita de almas, aljava, prata benta, mãos ágeis, virote perfurante, passo fantasma, pés ligeiros; cada um com vários níveis). Concluir um capítulo dá meio nível de bônus. Os títulos mudam a cor da lâmina, da lanterna e dos golpes: Aprendiz (ciano) → Juramentado (nv 5, ouro) → Matador de Vampiros (10, carmesim) → Inquisidor (15, violeta) → Lenda da Noite (22, prata). No level-up o jogo pausa: toque/clique na carta, teclas 1-2-3 ou mova o mouse e clique.

**Santuários e mercador:** os 8 santuários de beira de estrada (✝ dourado no minimapa) são pontos de descanso: **E** (toque no aviso, ou ↑ no controle) para rezar — vida, stamina e virotes cheios e o progresso é salvo ali, então ao cair você volta ao último santuário. Cada santuário atende uma vez por noite (a luz fica fraca depois). As almas (✦ no HUD) são também moeda: o **mercador** na praça de Borgo (¤ no minimapa) vende Erva Verde (8), Erva Vermelha (10), Água Benta (18) e Ervas Mistas V+R (30). O jogo pausa enquanto a loja está aberta (1-4 / ← → Enter / toque / controle).

**Save:** fica no `localStorage` do navegador (`horror-sword:save`, recordes em `horror-sword:records`). O checkpoint é gravado ao começar e ao concluir cada capítulo (posição, hora do dia, nível, dons, inventário). No menu aparece CONTINUAR com o resumo do save, ou "Nova caçada" para escolher outra dificuldade.

## Estrutura

- `src/ps1.js` — pipeline retrô: baixa resolução com pixels inteiros, vertex snapping, texturas afins/reduzidas, paletas com dithering (Bayer 2×2/4×4/8×8 ou ruído) e filtro de monitor CRT; materiais e texturas procedurais.
- `src/settings.js` — painel de configurações (botão no menu/pausa): predefinições e ajuste ao vivo de resolução, cores, texturas, dithering e CRT, mais sensibilidade da câmera, eixo invertido, vibração e volumes de música/efeitos/ambiente, salvo no `localStorage`.
- `src/world.js` — vale desenhado à mão e fechado por montanhas: relevo projetado (rio, lago, colinas, monte do castelo), terreno pintado, estradas, florestas, minimapa pré-renderizado, colisão em grade, ponte caminhável (`groundAt`), caixões/portão/arena e pool de luzes pontuais.
- `src/structures.js` — construções únicas: Vilarejo de Borgo (casas enxaimel, igreja, poço, feira), Cemitério dos Esquecidos (mausoléu, anjo), Moinho Queimado (pás girando), Abadia de São Miguel (rosácea), Colina da Forca, Ponte do Rio Argeș, santuários e o Castelo Drácula.
- `src/characters.js` — personagens com malha contínua e esqueleto (`SkinnedMesh`): tubos e elipsoides suaves fundidos numa malha só, pesos de skinning calculados por distância aos ossos; acessórios rígidos (espada, chapéu, coroa, besta) presos aos ossos.
- `src/models.js` — primitivas (caixa, cilindro, frontão) e `bake()` para construções e acessórios.
- `src/player.js` — movimento, combo, esquiva, besta; atributos vindos dos dons (`applyStats`) e cor do título (`setRank`).
- `src/enemies.js` — IA (teleporte em névoa, salto do lobisomem, rasante das noivas), aviso visual dos golpes, vez de atacar, detecção da esquiva perfeita e câmera lenta das criaturas, spawns definidos pelo capítulo, escala de dificuldade, elites e guardiões nomeados, almas, virotes.
- `src/interact.js`, `src/interact.css` — santuários (rezar: cura, recarga e checkpoint, uma vez por noite) e o mercador de Borgo (loja com almas, aviso na tela tocável).
- `src/nav.js` — navegação das criaturas a pé: grade de 1 m numa janela de 112 m em volta do caçador, desenhada a partir dos círculos de colisão do mundo (refeita a cada 2 m andados ou 1 s), teste de linha de visão e campo de fluxo (Dijkstra em 8 direções) calculado só quando alguma criatura perde o caçador de vista.
- `src/lockon.js` — trava de alvo: escolha e troca de alvo, marcador sobre a criatura, ângulo da câmera.
- `src/camcollide.js` — colisão da câmera: um raio por quadro da cabeça do caçador até a câmera, contra as construções (malhas grandes como o castelo são divididas em pedaços de 6 m para o raio testar só os triângulos próximos) e o relevo. Paredes e telhados puxam a câmera na hora; ela volta suave quando o caminho abre; colada demais, o caçador some para não tapar a tela. Árvores ficam de fora de propósito (a câmera ficaria entrando e saindo nas florestas).
- `src/campaign.js` — capítulos e objetivos, escala por capítulo/ciclo, XP e level-up, checkpoints, morte por dificuldade e novo jogo+.
- `src/progress.js` — dificuldades, dons, títulos, curva de XP e leitura/gravação do save no `localStorage`.
- `src/menu.js`, `src/campaign.css` — painel do menu (continuar / nova caçada / dificuldade) e estilos de XP, toast e cartas de dom.
- `src/inventory.js`, `src/items.js` — inventário à moda antiga da Capcom: 8 espaços, usar/combinar/examinar/descartar, eletrocardiograma de condição, item girando em 3D; ervas (verde, vermelha e misturas) e água benta brilhando pelo vale ou caídas dos inimigos.
- `src/gamepad.js` — controles de videogame (mapeamento padrão): botões viram as mesmas teclas virtuais do teclado, conforme o contexto (jogo, inventário/dons, menus).
- `src/touch.js` — controles de toque (analógico, câmera, botões); viram teclas virtuais no `Input`, então o loop do jogo não distingue toque de teclado.
- `src/audio.js` — todo o som é sintetizado em tempo real (veja abaixo).
- `src/effects.js`, `src/hud.js`, `src/input.js`, `src/main.js` — partículas, HUD/minimapa, entrada e loop/ciclo dia-noite (a ondulação da água roda no shader de vértice). O build separa o three.js (`assets/three-*.js`) do código do jogo, então uma atualização só baixa de novo a parte que mudou.

## Som

Não há nenhum arquivo de áudio: efeitos, ambiente e trilha são gerados pela Web Audio API em `src/audio.js`.

- **Espaço:** reverb de catedral gerado por código. Os sons das criaturas vêm do lado (esquerda/direita) e da distância em que estão, e soam mais abafados e com mais eco quando estão longe.
- **Criaturas:** cada uma tem voz própria (vozes por formantes): gemido do carniçal, sibilo e grito do vampiro, guincho do morcego, lamento e cantarola da noiva, rosnado e uivo do lobisomem, risada do Conde. Cada uma tem três sons: **aviso antes do ataque** (dá tempo de esquivar), morte, e sons ocasionais quando está perto.
- **Caçador:** golpes com brilho de lâmina rúnica (o 3º do combo é mais pesado), impacto, passos (terra/água), pulo, aterrissagem, esquiva, esquiva perfeita, trava de alvo, besta (disparo, virote cravando, recarga, clique vazio), coração batendo com pouca vida.
- **Mundo:** sino de igreja (3 badaladas ao anoitecer), vento, grilos à noite (ficam quietos quando há monstros perto), coruja, corvos ao entardecer, pássaros de dia, trovão e dissonância na Lua de Sangue.
- **Trilha:** generativa em Ré menor: pad, caixinha de música e, quando o perigo aumenta, tambores taiko e cordas. No duelo final entra um coro. A entrada do Conde toca, num órgão sintetizado, a abertura da *Tocata e Fuga em Ré menor* de Bach (domínio público).
- No modo dev, `__hs.sfx.<nome>()` no console toca qualquer efeito.

## Licenças

Tudo o que o jogo usa é livre e redistribuível: three.js e simplex-noise (MIT) e as fontes Pirata One e VT323 (SIL OFL 1.1). As fontes são embutidas no build via `@fontsource` e não carregadas do Google Fonts, então o jogo não envia o IP do jogador a terceiros (exigência da LGPD/GDPR). O texto completo das licenças fica em [`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt), é copiado para `dist/` e tem link no menu. Ao adicionar uma dependência, fonte ou asset, use apenas licenças abertas e acrescente o aviso nesse arquivo. Ferramentas só de desenvolvimento (Vite, MIT; puppeteer-core, Apache-2.0, usado pelo `npm test`) não vão para o build publicado.
