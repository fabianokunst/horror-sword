# Horror Sword: regras de trabalho

O README.md descreve o jogo, como rodar e a estrutura do código. Este arquivo trata só de como manter o projeto sincronizado.

## Repositório único: GitHub

- A fonte da verdade é https://github.com/fabianokunst/horror-sword, branch `main`. O projeto é editado em **mais de um computador**, então o GitHub precisa ter sempre a versão mais nova.
- **Início da sessão:** o gancho `.claude/hooks/git-sync.mjs` (SessionStart, em `.claude/settings.json`) busca o GitHub e atualiza a pasta só por fast-forward, sem nunca mexer em mudanças locais. Leia o que ele reportou. Se avisar de histórico divergente, falta de conexão ou atualização bloqueada, resolva isso (ou avise o usuário) **antes** de editar. Na dúvida, rode `git status` e `git fetch`.
- **Ao concluir uma mudança:** rode `npm test`. Se passar, faça o commit e o `git push` para `main` sem perguntar (o usuário pediu isso de forma permanente). Se o teste falhar, corrija antes; não envie jogo quebrado. Cada push na `main` publica no GitHub Pages (o CI roda build e teste antes).
- **Push rejeitado** (outro computador enviou antes): `git pull --rebase` e depois `git push`. Nunca use `push --force`.

## Várias sessões na mesma pasta

É comum haver mais de uma sessão do Claude aberta neste projeto ao mesmo tempo, cada uma editando arquivos.

- Faça commit **só dos arquivos da sua tarefa**, com `git add <arquivos>`. Nunca use `git add -A` / `git add .`: isso pegaria o trabalho pela metade de outra sessão.
- Se um arquivo seu também tiver mudanças de outra sessão em andamento, espere ela terminar ou fale com o usuário antes de fazer o commit.
- Não rode `git checkout -- .`, `git reset --hard`, `git stash` nem `git clean`: apagariam o trabalho das outras sessões.

## Commits

- Mensagem em inglês, no estilo do histórico: um título curto descrevendo o que mudou para quem joga (ex.: `Shrines as rest points and a merchant in Borgo`), com detalhes no corpo se precisar.
- `node_modules/`, `dist/` e `.claude/settings.local.json` ficam fora do git (`.gitignore`).

## Novo computador

```bash
git clone https://github.com/fabianokunst/horror-sword.git
cd horror-sword
npm install
```

Para fazer commits, o git precisa de nome e e-mail (`git config user.name "Fabiano Kunst"` e `git config user.email "fabianoeu89@yahoo.com.br"`, os mesmos do histórico). O primeiro `git push` pede login no GitHub.
