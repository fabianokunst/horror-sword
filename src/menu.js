// Title-screen hunt panel: continue the saved hunt, or start a new one on a chosen difficulty.
import { DIFFICULTIES, loadSave, loadRecords, loadPrefs, savePrefs, newSave, rankOf } from './progress.js';
import { CHAPTERS, roman } from './campaign.js';
import './campaign.css';
import { L } from './i18n.js';

const fmtTime = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}min`);

export class HuntMenu {
  constructor(playBtn) {
    this.play = playBtn;
    this.el = document.createElement('div');
    this.el.id = 'hunt';
    playBtn.before(this.el);
    this.save = loadSave();
    this.diff = this.save?.difficulty ?? loadPrefs().difficulty;
    if (!DIFFICULTIES[this.diff]) this.diff = 'normal';
    this.fresh = !this.save;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.diff) {
        this.diff = b.dataset.diff;
        savePrefs({ difficulty: this.diff });
      } else if (b.dataset.act === 'new') this.fresh = true;
      else if (b.dataset.act === 'back') this.fresh = false;
      this.render();
    });
    this.render();
  }

  // The save the play button should start: the stored one, or a new hunt.
  choice() { return this.fresh ? newSave(this.diff) : this.save; }

  close() { this.el.classList.add('hidden'); }

  render() {
    const s = this.save, rec = loadRecords();
    let html = '';
    if (s && !this.fresh) {
      const ch = CHAPTERS[s.chapter];
      const cycle = s.cycle ? `${L('Ciclo', 'Cycle')} ${roman(s.cycle + 1)} · ` : '';
      html += `<div class="slot"><b>${cycle}${L('Capítulo', 'Chapter')} ${roman(s.chapter + 1)} — ${ch.title}</b>` +
        `<span>${L('Nível', 'Level')} ${s.level} · ${rankOf(s.level).name} · ${DIFFICULTIES[s.difficulty].name} · ${fmtTime(s.stats.time)}</span></div>` +
        `<button type="button" class="link" data-act="new">${L('Nova caçada', 'New hunt')}</button>`;
      this.play.textContent = L('CONTINUAR', 'CONTINUE');
    } else {
      html += `<div class="diffs" role="radiogroup" aria-label="${L('Dificuldade', 'Difficulty')}">` +
        Object.entries(DIFFICULTIES).map(([k, d]) =>
          `<button type="button" role="radio" data-diff="${k}" aria-checked="${k === this.diff}">${d.name}</button>`).join('') +
        `</div><p class="diff-desc">${DIFFICULTIES[this.diff].desc}</p>`;
      if (s) html += L(`<p class="warn">Isso substitui o save atual (Capítulo ${roman(s.chapter + 1)}, nível ${s.level}).</p>`, `<p class="warn">This replaces the current save (Chapter ${roman(s.chapter + 1)}, level ${s.level}).</p>`) +
        `<button type="button" class="link" data-act="back">${L('Voltar ao save', 'Back to the save')}</button>`;
      this.play.textContent = L('CAÇAR', 'HUNT');
    }
    if (rec.chapter > 0) {
      const c = Math.floor(rec.chapter / CHAPTERS.length), n = rec.chapter % CHAPTERS.length;
      html += `<p class="record">${L('Recorde', 'Record')}: ${c ? `${L('Ciclo', 'Cycle')} ${roman(c + 1)} · ` : ''}${L('Capítulo', 'Chapter')} ${roman(n + 1)} · ${L('Nível', 'Level')} ${rec.level}</p>`;
    }
    this.el.innerHTML = html;
  }
}
