// SessionStart hook: brings this checkout up to date with GitHub (origin) before any work starts.
// The project is edited from several computers, so each session first pulls what the others pushed.
// Safe by design: fast-forward only, never touches uncommitted work; anything it can't do is reported, not forced.
import { execFileSync } from 'node:child_process';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git = (...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim();
const errText = (e) => String(e.stderr || e.message || e).trim().split('\n')[0];

const notes = [];
let problem = false;

function report() {
  const tail = problem ? '\nResolva isso (ou avise o usuário) antes de editar o projeto.' : '';
  process.stdout.write(JSON.stringify({
    systemMessage: `GitHub: ${notes.join(' · ')}`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[sincronização com o GitHub no início da sessão]\n${notes.join('\n')}${tail}`,
    },
  }));
  process.exit(0);
}

try {
  git('rev-parse', '--git-dir');
} catch {
  notes.push('esta pasta não é um repositório git: rode `git clone https://github.com/fabianokunst/horror-sword.git`');
  problem = true;
  report();
}

let upstream;
try {
  upstream = git('rev-parse', '--abbrev-ref', '@{u}');
} catch {
  notes.push('a branch atual não acompanha nenhuma branch do GitHub (esperado: origin/main)');
  problem = true;
  report();
}

let fetched = true;
try {
  git('fetch', '--quiet', 'origin');
} catch (e) {
  fetched = false;
  problem = true;
  notes.push(`não consegui falar com o GitHub (${errText(e)}): a pasta pode estar desatualizada`);
}

const [ahead, behind] = git('rev-list', '--left-right', '--count', `HEAD...${upstream}`).split(/\s+/).map(Number);

if (behind > 0) {
  try {
    git('merge', '--ff-only', '--quiet', upstream);
    notes.push(`atualizado: baixei ${behind} commit(s) novo(s) de ${upstream}`);
  } catch (e) {
    problem = true;
    notes.push(ahead > 0
      ? `${upstream} tem ${behind} commit(s) novo(s) e esta pasta tem ${ahead} próprio(s): histórico divergiu, rode \`git pull --rebase\``
      : `${upstream} tem ${behind} commit(s) novo(s), mas não atualizei: mudanças locais nos mesmos arquivos (${errText(e)})`);
  }
} else if (fetched) {
  notes.push(`em dia com ${upstream}`);
}

if (ahead > 0 && behind === 0) notes.push(`${ahead} commit(s) local(is) ainda não enviado(s): faça \`git push\``);

const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
if (dirty > 0) notes.push(`${dirty} arquivo(s) com mudanças não commitadas (podem ser de outra sessão em andamento)`);

report();
