# Horror Sword — O Caçador da Noite

Jogo de ação em mundo aberto com clima gótico (Drácula / Van Helsing), feito em **Three.js** com visual estilo PlayStation 1.

## Rodar

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/
```

O jogo precisa do build: abrir o `index.html` da raiz direto (ou servir a raiz do repositório) não funciona, porque ele aponta para `src/` e importa `three` do `node_modules`.

### Publicar (GitHub Pages)

Cada push na `main` roda [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que faz o build e publica o `dist/` em https://fabianokunst.github.io/horror-sword/. O `vite.config.js` usa `base: './'`, então o build funciona em qualquer subcaminho. Em **Settings → Pages → Build and deployment → Source** precisa estar **GitHub Actions** (com "Deploy from a branch" o Pages serve o código-fonte cru: tela sem CSS e jogo parado).

## Controles

| Tecla | Ação |
|---|---|
| WASD / Mouse | mover / câmera |
| Shift | correr |
| Espaço | pular |
| Clique esquerdo | espada (combo de 3 golpes, mira assistida) |
| Clique direito / Ctrl / C | esquiva com invencibilidade |
| Q / F / botão do meio | besta de prata (6 virotes, recarregam sozinhos) |
| Tab / I | inventário (no celular: botão ITENS) |
| E | pegar item brilhando no chão |
| M | liga/desliga o som (também há o botão SOM no menu) |
| Esc | pausa |

### Celular e tablet

Funciona de celulares pequenos (iPhone SE) a monitores ultrawide, em paisagem ou retrato (paisagem é recomendada). Em tela de toque os controles aparecem sozinhos:

| Toque | Ação |
|---|---|
| Arrastar no lado esquerdo | analógico flutuante para mover |
| Arrastar no lado direito | câmera (dá para mover e girar ao mesmo tempo) |
| Botão da espada | golpe; segure para o combo completo |
| ESQUIVA / BESTA / PULO | como no teclado (o número na besta é a munição) |
| CORRER | liga a corrida; desliga ao soltar o analógico |
| ITENS / ❚❚ | inventário / pausa |
| Toque no aviso do item | pegar item |

Ao tocar em CAÇAR o jogo entra em tela cheia (no Android também trava em paisagem). Se o app for para segundo plano, o jogo pausa. Usar mouse/teclado ou toque no meio da partida troca o esquema de controle automaticamente.

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

**Save:** fica no `localStorage` do navegador (`horror-sword:save`, recordes em `horror-sword:records`). O checkpoint é gravado ao começar e ao concluir cada capítulo (posição, hora do dia, nível, dons, inventário). No menu aparece CONTINUAR com o resumo do save, ou "Nova caçada" para escolher outra dificuldade.

## Estrutura

- `src/ps1.js` — pipeline retrô: baixa resolução com pixels inteiros, vertex snapping, texturas afins/reduzidas, paletas com dithering (Bayer 2×2/4×4/8×8 ou ruído) e filtro de monitor CRT; materiais e texturas procedurais.
- `src/settings.js` — painel de configurações (botão no menu/pausa): predefinições e ajuste ao vivo de resolução, cores, texturas, dithering e CRT, salvo no `localStorage`.
- `src/world.js` — vale desenhado à mão e fechado por montanhas: relevo projetado (rio, lago, colinas, monte do castelo), terreno pintado, estradas, florestas, minimapa pré-renderizado, colisão em grade, ponte caminhável (`groundAt`), caixões/portão/arena e pool de luzes pontuais.
- `src/structures.js` — construções únicas: Vilarejo de Borgo (casas enxaimel, igreja, poço, feira), Cemitério dos Esquecidos (mausoléu, anjo), Moinho Queimado (pás girando), Abadia de São Miguel (rosácea), Colina da Forca, Ponte do Rio Argeș, santuários e o Castelo Drácula.
- `src/characters.js` — personagens com malha contínua e esqueleto (`SkinnedMesh`): tubos e elipsoides suaves fundidos numa malha só, pesos de skinning calculados por distância aos ossos; acessórios rígidos (espada, chapéu, coroa, besta) presos aos ossos.
- `src/models.js` — primitivas (caixa, cilindro, frontão) e `bake()` para construções e acessórios.
- `src/player.js` — movimento, combo, esquiva, besta; atributos vindos dos dons (`applyStats`) e cor do título (`setRank`).
- `src/enemies.js` — IA (teleporte em névoa, salto do lobisomem, rasante das noivas), spawns definidos pelo capítulo, escala de dificuldade, elites e guardiões nomeados, almas, virotes.
- `src/campaign.js` — capítulos e objetivos, escala por capítulo/ciclo, XP e level-up, checkpoints, morte por dificuldade e novo jogo+.
- `src/progress.js` — dificuldades, dons, títulos, curva de XP e leitura/gravação do save no `localStorage`.
- `src/menu.js`, `src/campaign.css` — painel do menu (continuar / nova caçada / dificuldade) e estilos de XP, toast e cartas de dom.
- `src/inventory.js`, `src/items.js` — inventário à moda antiga da Capcom: 8 espaços, usar/combinar/examinar/descartar, eletrocardiograma de condição, item girando em 3D; ervas (verde, vermelha e misturas) e água benta brilhando pelo vale ou caídas dos inimigos.
- `src/touch.js` — controles de toque (analógico, câmera, botões); viram teclas virtuais no `Input`, então o loop do jogo não distingue toque de teclado.
- `src/audio.js` — todo o som é sintetizado em tempo real (veja abaixo).
- `src/effects.js`, `src/hud.js`, `src/input.js`, `src/main.js` — partículas, HUD/minimapa, entrada e loop/ciclo dia-noite.

## Som

Não há nenhum arquivo de áudio: efeitos, ambiente e trilha são gerados pela Web Audio API em `src/audio.js`.

- **Espaço:** reverb de catedral gerado por código. Os sons das criaturas vêm do lado (esquerda/direita) e da distância em que estão, e soam mais abafados e com mais eco quando estão longe.
- **Criaturas:** cada uma tem voz própria (vozes por formantes): gemido do carniçal, sibilo e grito do vampiro, guincho do morcego, lamento e cantarola da noiva, rosnado e uivo do lobisomem, risada do Conde. Cada uma tem três sons: **aviso antes do ataque** (dá tempo de esquivar), morte, e sons ocasionais quando está perto.
- **Caçador:** golpes com brilho de lâmina rúnica (o 3º do combo é mais pesado), impacto, passos (terra/água), pulo, aterrissagem, esquiva, besta (disparo, virote cravando, recarga, clique vazio), coração batendo com pouca vida.
- **Mundo:** sino de igreja (3 badaladas ao anoitecer), vento, grilos à noite (ficam quietos quando há monstros perto), coruja, corvos ao entardecer, pássaros de dia, trovão e dissonância na Lua de Sangue.
- **Trilha:** generativa em Ré menor: pad, caixinha de música e, quando o perigo aumenta, tambores taiko e cordas. No duelo final entra um coro. A entrada do Conde toca, num órgão sintetizado, a abertura da *Tocata e Fuga em Ré menor* de Bach (domínio público).
- No modo dev, `__hs.sfx.<nome>()` no console toca qualquer efeito.

## Licenças

Tudo o que o jogo usa é livre e redistribuível: three.js e simplex-noise (MIT) e as fontes Pirata One e VT323 (SIL OFL 1.1). As fontes são embutidas no build via `@fontsource` e não carregadas do Google Fonts, então o jogo não envia o IP do jogador a terceiros (exigência da LGPD/GDPR). O texto completo das licenças fica em [`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt), é copiado para `dist/` e tem link no menu. Ao adicionar uma dependência, fonte ou asset, use apenas licenças abertas e acrescente o aviso nesse arquivo.
