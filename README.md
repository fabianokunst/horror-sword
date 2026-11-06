# Horror Sword — O Caçador da Noite

Jogo de ação em mundo aberto com clima gótico (Drácula / Van Helsing), feito em **Three.js** com visual estilo PlayStation 1.

**Idiomas:** português e inglês. Na primeira visita o jogo segue o idioma do navegador; o botão IDIOMA / LANGUAGE na tela de título troca (recarrega a página; ele some depois que a caçada começa para não interromper). Os textos ficam lado a lado no código como `L('português', 'English')` ([`src/i18n.js`](src/i18n.js)); os do `index.html` são trocados por `translatePage()`. Ao escrever um texto novo, coloque as duas versões.

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

[`tests/smoke.mjs`](tests/smoke.mjs) gera um build de desenvolvimento numa pasta temporária (mantém o gancho `window.__hs`), serve numa porta livre e joga no Chrome instalado (variável `CHROME_PATH` para escolher outro). Falha se houver qualquer erro na página ou se quebrar: início da caçada, vez de atacar, aviso de golpe, esquiva perfeita e contra-ataque, runas (efeitos dos golpes e Arte), trilha da espada e criaturas mortas caídas no chão, trava de alvo, colisão da câmera, criaturas contornando uma casa, a rota até o objetivo (pelas estradas e pela ponte) com o marcador na tela, o mapa do vale (abrir e fechar no teclado, no controle e no toque, com a caçada pausada) e o layout dos botões de toque. Como usa pasta e porta próprias, várias sessões podem rodar ao mesmo tempo. As páginas do teste ignoram controles de verdade ligados ao computador (o Chrome sem janela também os enxerga e um botão apertado iniciaria a caçada sozinho); o teste do controle usa um controle simulado.

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
| V | **Arte** da lâmina, com a barra de Fúria cheia (veja Runas e Fúria) |
| 1–6 / X / roda do mouse | escolher / trocar a **runa** da espada |
| Tab / I | inventário (no celular: botão ITENS) |
| Mouse nas telas de escolha | no inventário, nas cartas de dom e no mercador aparece um ponteiro em forma de espada: aponte (ele fica dourado sobre o que dá para clicar) e clique; botão direito volta |
| E | pegar item brilhando no chão · rezar no santuário · falar com o mercador |
| M | **mapa do vale** (M de novo ou clique direito fecha; veja Mapa e guia) |
| N | liga/desliga o som (também há o botão SOM no menu) |
| Esc | pausa |

### Controle (Xbox, PlayStation e similares)

| Botão | Ação |
|---|---|
| Analógico esquerdo / direito | mover / câmera |
| A (✕) | pular · nos menus: confirmar / CAÇAR / CONTINUAR |
| B (◯) | esquiva · nos menus: voltar |
| X (▢) / RB | espada (segure para o combo) |
| Y (△) | besta |
| RT | Arte da lâmina (Fúria cheia) |
| Direcional ◀ ▶ | trocar a runa da espada |
| LB / R3 | travar alvo |
| LT / L3 | correr (segurando) |
| Direcional ↑ | pegar item · no inventário e nas cartas de dom: mover o cursor |
| Direcional ↓ | mapa do vale (B ou ↓ fecha) |
| Back / Select | inventário |
| Start | pausa / continuar |

O controle vibra ao levar golpe e na esquiva perfeita (onde o navegador permite). Em **Configurações → Controles** dá para mudar a sensibilidade da câmera (mouse, toque e controle), inverter o eixo vertical e desligar a vibração; em **Mapa**, se o minimapa gira com a câmera e se o marcador do objetivo aparece na tela; em **Som**, os volumes de música, efeitos e ambiente.

### Celular e tablet

Funciona de celulares pequenos (iPhone SE) a monitores ultrawide, em paisagem ou retrato (paisagem é recomendada). Em tela de toque os controles aparecem sozinhos:

| Toque | Ação |
|---|---|
| Arrastar no lado esquerdo | analógico flutuante para mover |
| Arrastar no lado direito | câmera (dá para mover e girar ao mesmo tempo) |
| Botão da espada | golpe; segure para o combo completo |
| ESQUIVA / BESTA / PULO | como no teclado (o número na besta é a munição) |
| ALVO | trava/solta o alvo (aceso enquanto travado); deslizar rápido no lado direito troca de alvo |
| ARTE | Arte da lâmina (o botão acende quando a Fúria enche) |
| RUNA | troca a runa da espada (mostra o símbolo da runa na lâmina) |
| CORRER | liga a corrida; desliga ao soltar o analógico |
| ITENS / ❚❚ | inventário / pausa |
| Toque no aviso do item | pegar item |
| Toque no minimapa | mapa do vale (toque de novo para voltar) |

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
- **Runas e Fúria:** a espada recebe **runas** que mudam a cor da lâmina, o efeito de cada golpe e o golpe especial. Cada capítulo concluído revela uma (a nova já entra na lâmina); troque com 1–6, X ou a roda do mouse (◀ ▶ no controle, RUNA no toque). A linha da runa fica sob as barras de vida e stamina: símbolo, nome e nível, as runas encontradas e a **barra de Fúria**.

  | Runa | Capítulo | Cada golpe | Arte (V / RT / ARTE) | Maestria III |
  |---|---|---|---|---|
  | † Aço | início | — | **Lâmina Giratória**: giro que corta tudo em volta | — |
  | ✹ Brasa | I | incendeia (dano contínuo; feras queimam 50% mais) | **Círculo de Brasas**: onda de fogo em volta | o fogo pula para as vizinhas quando uma cai queimando |
  | ❦ Sangria | II | cura o caçador; cada criatura abatida cura mais | **Lua Crescente**: lâmina de sangue que voa à frente, atravessa a fila e cura a cada criatura | abates curam o dobro |
  | ↯ Tempestade | III | o 3º golpe do combo e o contra-ataque soltam um raio que pula entre as criaturas | **Juízo dos Céus**: raios caem sobre as criaturas em volta e as atordoam | os raios em corrente atordoam |
  | ❄ Geada | IV | gela e deixa lenta; no 3º acerto congela (sem se mexer, +50% de dano recebido; o Conde só por um instante) | **Inverno Eterno**: sopro gelado que congela tudo à frente | congeladas estilhaçam ao cair e gelam as vizinhas |
  | ☼ Aurora | V | marca um selo de luz: a criatura explode ao cair (mortos-vivos sofrem 50% mais) | **Amanhecer**: clarão que cega tudo em volta, sela e queima os mortos-vivos | as explosões selam quem atingem (reação em cadeia) |

  A **Fúria** enche com golpes de espada (até 3 criaturas por golpe; contra-ataques valem mais), abates e esquivas perfeitas. Cheia, a barra pulsa e a Arte da runa na lâmina fica pronta: durante ela o caçador não leva dano, e a Arte também quebra caixões. Os abates feitos com uma runa na lâmina dão **maestria** a ela (II com 25 abates, III com 70; elites contam 3, chefes 10), e cada nível fortalece o efeito e a Arte. O nível máximo é III no primeiro ciclo; cada ciclo de novo jogo+ desperta mais um (IV, depois V, com 140 e 240 abates). O **Incenso de Ira** (mercador, pelo vale ou caído de criaturas) enche a Fúria na hora.

## Campanha

A caçada é dividida em capítulos; cada um tem um objetivo (linha no topo da tela, alvo ◆ no minimapa e na tela; veja Mapa e guia):

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
| Peregrino | 70% vida, 60% dano | volta ao último checkpoint (início do capítulo ou último santuário) mantendo a experiência |
| Caçador | normal | volta ao último checkpoint, no nível dele |
| Van Helsing | +40% vida, +35% dano, mais criaturas e elites, +25% XP | igual ao Caçador |
| Pesadelo | +80% vida, +70% dano, +50% XP | o save é apagado (fica só o recorde) |

**Evolução:** almas dão experiência; cada nível dá +4 de vida, +2% de dano e a escolha de 1 entre 3 **dons** (vigor, couraça, fôlego, lâmina rúnica, alcance, golpe de misericórdia, sede de sangue, colheita de almas, aljava, prata benta, mãos ágeis, virote perfurante, passo fantasma, pés ligeiros, ira santa (Fúria enche mais rápido), ressonância (efeitos das runas mais fortes), mestre de armas (Artes mais fortes); cada um com vários níveis). Concluir um capítulo dá meio nível de bônus. Os títulos mudam a cor da lâmina, da lanterna e dos golpes: Aprendiz (ciano) → Juramentado (nv 5, ouro) → Matador de Vampiros (10, carmesim) → Inquisidor (15, violeta) → Lenda da Noite (22, prata). No level-up o jogo pausa: toque/clique na carta, teclas 1-2-3 ou mova o mouse e clique.

**Mapa e guia:** quando o objetivo é um lugar (os caixões, o pátio do castelo), o jogo mostra o caminho de três jeitos:

- **Na tela:** um ◆ dourado com a distância flutua sobre o objetivo; fora da vista, ele fica preso na borda com uma seta para o lado certo (embaixo quando está às suas costas).
- **Minimapa:** um recorte do mesmo pergaminho do mapa do vale (estradas, florestas, rio, os desenhos dos lugares), com o nome curto de cada lugar (Borgo, Ponte, Moinho...), santuários, mercador, criaturas em pontos vermelhos e o caminho até o objetivo tracejado em vermelho. Gira com a câmera: para cima é para onde você olha, e a ficha escura com **N** na borda aponta o norte. O objetivo aparece como ◆ vermelho; fora do alcance, uma seta vermelha na borda mostra a direção e a distância. Embaixo dele aparecem a tecla do mapa e o nome do lugar onde você está.
- **Mapa do vale** (M, ↓ no controle ou toque no minimapa): o vale inteiro desenhado em pergaminho, com relevo, rio, florestas, estradas e o nome de cada lugar, os santuários (apagados depois de usados na noite), o mercador, os caixões do Conde (riscados quando destruídos), você e, em tinta vermelha, o objetivo e o caminho até ele. A caçada pausa enquanto ele está aberto.

A rota (`src/route.js`) segue as estradas sempre que isso compensa em vez de cortar pelo mato: atravessa o rio pela ponte e só sai da estrada no último trecho. Em **Configurações → Mapa** dá para fixar o norte no minimapa e esconder o marcador da tela.

**Santuários e mercador:** os 8 santuários de beira de estrada (✝ dourado no minimapa) são pontos de descanso: **E** (toque no aviso, ou ↑ no controle) para rezar — vida, stamina e virotes cheios e o progresso é salvo ali, então ao cair você volta ao último santuário. Cada santuário atende uma vez por noite (a luz fica fraca depois). As almas (✦ no HUD) são também moeda: o **mercador** na praça de Borgo (¤ no minimapa) vende Erva Verde (8), Erva Vermelha (10), Água Benta (18), Ervas Mistas V+R (30) e Incenso de Ira (25, enche a Fúria). O jogo pausa enquanto a loja está aberta (1-5 / ← → Enter / toque / controle).

**Save:** fica no `localStorage` do navegador (`horror-sword:save`, recordes em `horror-sword:records`). O checkpoint é gravado ao começar e ao concluir cada capítulo e ao rezar num santuário (posição, hora do dia, nível, dons, inventário, almas, runas e maestria). No menu aparece CONTINUAR com o resumo do save, ou "Nova caçada" para escolher outra dificuldade.

## Estrutura

- `src/ps1.js` — pipeline retrô: baixa resolução com pixels inteiros, vertex snapping, texturas afins/reduzidas, paletas com dithering (Bayer 2×2/4×4/8×8 ou ruído), filtro de monitor CRT e o acabamento liso (sombreamento suave, texturas filtradas, antisserrilhado e sombras suaves, usado pela predefinição "3D limpo"); materiais e texturas procedurais.
- `src/fog.js` — névoa do vale, no lugar da névoa do three.js em todos os materiais: medida pela distância até o olho (girar a câmera não faz nada aparecer ou sumir nas bordas de telas largas), espessa até alguns metros acima do chão do caçador e rala acima disso, então o monte do castelo, as colinas e a serra saem dela juntos (o castelo não fica mais flutuando sobre um morro já sumido); à noite as luzes (janelas, lampiões, olhos) atravessam o escuro bem mais longe. `main.js` ajusta tudo pela hora do dia.
- `src/settings.js` — painel de configurações (botão no menu/pausa): predefinições (TV de tubo, PS1 puro, Monitor arcade, Pixel sombrio, Daguerreótipo, Nítido e 3D limpo) e ajuste ao vivo de resolução, cores, acabamento, texturas, dithering e CRT, mais sensibilidade da câmera, eixo invertido, vibração e volumes de música/efeitos/ambiente, salvo no `localStorage`.
- `src/world.js` — vale desenhado à mão e fechado por montanhas: relevo projetado (rio, lago, colinas, monte do castelo), terreno pintado, estradas, florestas, minimapa pré-renderizado, colisão em grade, ponte caminhável (`groundAt`), caixões/portão/arena e pool de luzes pontuais.
- `src/structures.js` — construções únicas: Vilarejo de Borgo (casas enxaimel, igreja, poço, feira), Cemitério dos Esquecidos (mausoléu, anjo), Moinho Queimado (pás girando), Abadia de São Miguel (rosácea), Colina da Forca, Ponte do Rio Argeș, santuários e o Castelo Drácula.
- `src/characters.js` — personagens com malha contínua e esqueleto (`SkinnedMesh`): tubos e elipsoides suaves fundidos numa malha só, pesos de skinning calculados por distância aos ossos; acessórios rígidos (espada, chapéu, coroa, besta nas costas e na mão) presos aos ossos; a aba do casaco do caçador tem osso próprio para esvoaçar.
- `src/anim.js` — ferramentas de animação procedural: `Poser` (cada quadro a animação escreve a pose inteira; trocar de ação faz uma transição suave a partir da pose na tela, e o corpo pode inclinar em torno de qualquer ponto, como os pés ou o meio do corpo), quadros-chave (`clip`/`sample`, com espelhamento esquerda/direita), molas para movimento secundário e recuos, passada e pés nivelados com o chão.
- `src/hunteranim.js` — animação do caçador: passada que segue a direção real (de lado e de costas com o alvo travado), quadril e ombros torcendo, inclinação na velocidade, na aceleração e nas curvas, espada arrastando baixa na corrida; guarda de esgrima que respira e, parado alguns segundos, gira a espada e a apoia no ombro; combo com preparo, golpe, acompanhamento e um passo à frente em cada golpe; Artes (giro com o braço estendido, salto com cambalhota e golpe no chão), rolamento encolhido no chão, pulo/queda/aterrissagem, saque rápido da besta, recuo ao levar golpe, mãos nos ouvidos no grito da noiva, nado e morte (cambaleia, cai de joelhos e tomba de cara no chão); casaco e cachecol em molas; pontas da lâmina para a trilha do golpe.
- `src/creatureanim.js` — animação das criaturas, cada uma com seu jeito: carniçal mancando, cabeça tombando e com tiques, golpe com os dois braços; vampiro deslizando com as garras prontas, golpe alternando os braços, agachamento antes da investida e voo rasante; lobisomem de quatro (passo que vira galope), rondando baixo enquanto espera, empinando para o golpe duplo, tremendo antes do salto, esticado no ar e amassando ao cair; noiva flutuando com o vestido ondulando e asas batendo de verdade, cabeça jogada para trás para gritar; bruxa curvada no cajado, erguendo a lanterna para lançar; morcego com batida assimétrica, inclinando nas curvas e fechando as asas no mergulho; o Conde ergue os braços para lançar e cruza-os ao mudar de fase. Todas recuam ao levar golpe, e as que andam tombam no chão ao morrer.
- `src/models.js` — primitivas (caixa, cilindro, frontão) e `bake()` para construções e acessórios.
- `src/player.js` — movimento, combo, esquiva, besta, tempo das Artes (`startArt`); atributos vindos dos dons (`applyStats`), cor do título (`setRank`) e da runa (`setRuneColor`).
- `src/runes.js`, `src/runes.css` — runas da espada: catálogo, efeito de cada golpe, barra de Fúria, Artes (anel de fogo, lâmina de sangue, raios, sopro gelado, clarão), maestria por abates (gravada no save) e a linha da runa no HUD.
- `src/enemies.js` — IA (teleporte em névoa, salto do lobisomem, rasante das noivas), aviso visual dos golpes, vez de atacar, detecção da esquiva perfeita e câmera lenta das criaturas, spawns definidos pelo capítulo, escala de dificuldade, elites e guardiões nomeados, almas, virotes; efeitos das runas nas criaturas (fogo, lentidão e congelamento, selo de luz que explode ao cair).
- `src/interact.js`, `src/interact.css` — santuários (rezar: cura, recarga e checkpoint, uma vez por noite) e o mercador de Borgo (loja com almas, aviso na tela tocável).
- `src/nav.js` — navegação das criaturas a pé: grade de 1 m numa janela de 112 m em volta do caçador, desenhada a partir dos círculos de colisão do mundo (refeita a cada 2 m andados ou 1 s), teste de linha de visão e campo de fluxo (Dijkstra em 8 direções) calculado só quando alguma criatura perde o caçador de vista.
- `src/route.js` — rota até o objetivo: as estradas viram um grafo (cruzamentos e bifurcações) e o caminho segue por elas quando sair da estrada (mato, morros, rio) sairia mais caro.
- `src/worldmap.js`, `src/worldmap.css` — mapa do vale (`paintSheet` desenha a folha; o minimapa usa a mesma folha sem os nomes, que ele escreve na vertical por cima): o relevo é pintado uma vez (a partir de `heightAt`, com sombreamento e curvas de nível) quando o jogo está ocioso; árvores, montanhas, estradas, desenhos dos lugares e nomes são feitos no tamanho da tela; por cima, a cada quadro, santuários, caixões, o caçador, o objetivo e a rota.
- `src/lockon.js` — trava de alvo: escolha e troca de alvo, marcador sobre a criatura, ângulo da câmera.
- `src/camcollide.js` — colisão da câmera: um raio por quadro da cabeça do caçador até a câmera, contra as construções (malhas grandes como o castelo são divididas em pedaços de 6 m para o raio testar só os triângulos próximos) e o relevo. Paredes e telhados puxam a câmera na hora; ela volta suave quando o caminho abre; colada demais, o caçador some para não tapar a tela. Árvores ficam de fora de propósito (a câmera ficaria entrando e saindo nas florestas).
- `src/campaign.js` — capítulos e objetivos, escala por capítulo/ciclo, XP e level-up, checkpoints, morte por dificuldade e novo jogo+.
- `src/progress.js` — dificuldades, dons, títulos, curva de XP e leitura/gravação do save no `localStorage`.
- `src/menu.js`, `src/campaign.css` — painel do menu (continuar / nova caçada / dificuldade) e estilos de XP, toast e cartas de dom.
- `src/inventory.js`, `src/items.js` — inventário à moda antiga da Capcom: 8 espaços, usar/combinar/examinar/descartar, eletrocardiograma de condição, item girando em 3D; ervas (verde, vermelha e misturas) e água benta brilhando pelo vale ou caídas dos inimigos.
- `src/gamepad.js` — controles de videogame (mapeamento padrão): botões viram as mesmas teclas virtuais do teclado, conforme o contexto (jogo, inventário/dons, menus).
- `src/touch.js` — controles de toque (analógico, câmera, botões); viram teclas virtuais no `Input`, então o loop do jogo não distingue toque de teclado.
- `src/audio.js` — todo o som é sintetizado em tempo real (veja abaixo).
- `src/effects.js`, `src/hud.js`, `src/input.js`, `src/main.js` — partículas, trilha da lâmina (fita suavizada que acompanha a espada em cada golpe, na cor da runa ou do título), ondas de choque e raios, HUD (minimapa em pergaminho que gira com a câmera, recortado da folha do mapa do vale; marcador do objetivo na tela), entrada e loop/ciclo dia-noite (a ondulação da água roda no shader de vértice). O build separa o three.js (`assets/three-*.js`) do código do jogo, então uma atualização só baixa de novo a parte que mudou.

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
