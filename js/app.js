import { MONTHS, CLASSES, SHEET_URL } from './config.js';
import { login, logout, currentSession, canSee, scopeEmployees, ROLES } from './auth.js';
import { loadData, ranking, teamStats, areaStats } from './data.js';
import { lineChart, stackedColumns, hBars, sparkline, pct, hideTip } from './charts.js';

const app = document.getElementById('app');

const state = {
  session: currentSession(),
  model: null,
  loading: false,
  monthIdx: MONTHS.length - 1,
  area: 'all',
  search: '',
};

// ---------- utilidades ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const signedPct = (v) => {
  if (v == null) return '—';
  const p = (v * 100).toFixed(1).replace('.', ',');
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${p.replace('-', '')} p.p.`;
};

const deltaClass = (v) => (v == null || Math.abs(v) < 0.0005 ? 'delta--flat' : v > 0 ? 'delta--up' : 'delta--down');

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const slug = (name) => encodeURIComponent(name);

function badge(cls) {
  const c = CLASSES[cls];
  return `<span class="badge badge--${cls.toLowerCase()}"><span aria-hidden="true">${c.icon}</span>${c.label}</span>`;
}

function posDelta(d) {
  if (d == null) return '<span class="pos-delta pos-delta--flat">—</span>';
  if (d === 0) return '<span class="pos-delta pos-delta--flat" title="Mesma posição">=</span>';
  return d > 0
    ? `<span class="pos-delta pos-delta--up" title="Subiu ${d}">▲ ${d}</span>`
    : `<span class="pos-delta pos-delta--down" title="Caiu ${-d}">▼ ${-d}</span>`;
}

function statusColors() {
  return { ACIMA: css('--status-good'), DENTRO: css('--status-warning'), ABAIXO: css('--status-critical') };
}

// Colaboradores visíveis para o perfil + filtro de área.
function visibleEmployees() {
  const scoped = scopeEmployees(state.session, state.model.employees);
  return state.area === 'all' ? scoped : scoped.filter((e) => e.area === state.area);
}

function route() {
  const [, view = 'overview', param] = location.hash.split('/');
  return { view, param: param ? decodeURIComponent(param) : null };
}

// ---------- login ----------

function renderLogin(error = '') {
  app.className = 'login-page';
  app.innerHTML = `
    <section class="login-brand">
      <div class="brand"><span class="brand__mark" aria-hidden="true"></span>Aurora Digital</div>
      <div>
        <h1>Painel de performance</h1>
        <p>Avaliações mensais, ranking e evolução de cada colaborador, conectados diretamente à planilha de avaliação.</p>
      </div>
      <ul class="role-list" aria-label="Perfis de acesso">
        <li><strong>CEO</strong><span>Visão completa, senha mestre</span><em class="tag tag--on">Ativo</em></li>
        <li><strong>RH</strong><span>Todos os colaboradores</span><em class="tag">Em breve</em></li>
        <li><strong>Gestores</strong><span>Somente a própria área</span><em class="tag">Em breve</em></li>
        <li><strong>Colaboradores</strong><span>Somente os próprios dados</span><em class="tag">Em breve</em></li>
      </ul>
    </section>
    <section class="login-form-wrap">
      <form class="login-form" novalidate>
        <h2>Entrar</h2>
        <p class="muted">Use suas credenciais de acesso.</p>
        <label>Usuário<input name="user" autocomplete="username" required autofocus /></label>
        <label>Senha
          <span class="pw">
            <input name="pass" type="password" autocomplete="current-password" required />
            <button type="button" class="pw__toggle" aria-label="Mostrar senha">Mostrar</button>
          </span>
        </label>
        <p class="form-error" role="alert">${esc(error)}</p>
        <button class="btn btn--primary" type="submit">Entrar</button>
        <button type="button" class="demo-hint">
          <span>Acesso de demonstração (CEO)</span>
          <code>ceo · Aurora@CEO2026</code>
          <small>Clique para preencher</small>
        </button>
      </form>
      <p class="fine">Ambiente de demonstração · dados fictícios</p>
    </section>`;

  const form = app.querySelector('form');
  const pass = form.elements.pass;
  form.querySelector('.pw__toggle').addEventListener('click', (e) => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
    e.currentTarget.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });
  app.querySelector('.demo-hint').addEventListener('click', () => {
    form.elements.user.value = 'ceo';
    pass.value = 'Aurora@CEO2026';
    form.querySelector('[type=submit]').focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    const session = await login(form.elements.user.value, pass.value);
    if (!session) {
      renderLogin('Usuário ou senha incorretos.');
      return;
    }
    state.session = session;
    location.hash = '#/overview';
    start();
  });
}

// ---------- shell ----------

const NAV = [
  { view: 'overview', label: 'Visão geral', icon: '◧' },
  { view: 'ranking', label: 'Ranking mensal', icon: '≡' },
  { view: 'people', label: 'Colaboradores', icon: '◉' },
  { view: 'criteria', label: 'Critérios', icon: '⚖' },
];

function renderShell() {
  const { view } = route();
  const m = state.model;
  const areas = [...new Set(scopeEmployees(state.session, m.employees).map((e) => e.area))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const sourceLabel =
    m.source === 'live'
      ? `<span class="source source--live" title="Lido às ${m.fetchedAt.toLocaleTimeString('pt-BR')}">Ao vivo · Google Sheets</span>`
      : `<span class="source source--offline" title="${esc(m.error)}">Offline · cópia local</span>`;

  app.className = 'shell';
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand"><span class="brand__mark" aria-hidden="true"></span>Aurora Digital</div>
      <nav aria-label="Seções">
        ${NAV.filter((n) => canSee(state.session, n.view))
          .map(
            (n) =>
              `<a href="#/${n.view}" class="nav-link${view === n.view ? ' is-active' : ''}"${view === n.view ? ' aria-current="page"' : ''}><span aria-hidden="true">${n.icon}</span>${n.label}</a>`
          )
          .join('')}
      </nav>
      <a class="sheet-link" href="${SHEET_URL}" target="_blank" rel="noopener">Abrir planilha ↗</a>
      <div class="user">
        <span class="avatar" aria-hidden="true">${esc(initials(state.session.name))}</span>
        <div><strong>${esc(state.session.name)}</strong><span>${ROLES[state.session.role].label} · acesso total</span></div>
      </div>
      <div class="sidebar__actions">
        <button class="btn btn--ghost" data-action="theme" type="button">Tema</button>
        <button class="btn btn--ghost" data-action="logout" type="button">Sair</button>
      </div>
    </aside>
    <main class="main">
      <header class="toolbar">
        <div class="filters">
          <label class="field">Mês
            <select data-filter="month">
              ${MONTHS.map((mo, i) => `<option value="${i}"${i === state.monthIdx ? ' selected' : ''}>${mo.long}${mo.live ? ' (atual)' : ''}</option>`).join('')}
            </select>
          </label>
          <label class="field">Área
            <select data-filter="area">
              <option value="all">Todas as áreas</option>
              ${areas.map((a) => `<option value="${esc(a)}"${a === state.area ? ' selected' : ''}>${esc(a)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="toolbar__right">
          ${sourceLabel}
          <button class="btn btn--ghost" data-action="refresh" type="button"${state.loading ? ' disabled' : ''}>${state.loading ? 'Atualizando…' : 'Atualizar dados'}</button>
        </div>
      </header>
      ${MONTHS[state.monthIdx].live ? '' : `<p class="notice">Mês histórico com <strong>dados simulados</strong> para demonstração. A planilha contém apenas ${esc(MONTHS[MONTHS.length - 1].long)}.</p>`}
      <div class="view${state.loading ? ' is-loading' : ''}" id="view"></div>
    </main>`;

  app.querySelector('[data-filter=month]').addEventListener('change', (e) => {
    state.monthIdx = Number(e.target.value);
    render();
  });
  app.querySelector('[data-filter=area]').addEventListener('change', (e) => {
    state.area = e.target.value;
    render();
  });
  app.querySelector('[data-action=logout]').addEventListener('click', () => {
    logout();
    state.session = null;
    state.model = null;
    location.hash = '';
    renderLogin();
  });
  app.querySelector('[data-action=refresh]').addEventListener('click', refresh);
  app.querySelector('[data-action=theme]').addEventListener('click', toggleTheme);
}

// ---------- visão geral ----------

function renderOverview(root) {
  const m = state.model;
  const emps = visibleEmployees();
  const stats = teamStats(m, state.monthIdx, emps);
  const prev = state.monthIdx > 0 ? teamStats(m, state.monthIdx - 1, emps) : null;
  const rank = ranking(m, state.monthIdx, emps);
  const avgDelta = prev ? stats.avg - prev.avg : null;
  const colors = statusColors();
  const month = MONTHS[state.monthIdx];
  const climbers = rank.filter((r) => r.posDelta > 0).sort((a, b) => b.posDelta - a.posDelta || b.scoreDelta - a.scoreDelta).slice(0, 3);

  root.innerHTML = `
    <div class="page-head">
      <h1>Visão geral</h1>
      <p class="muted">${esc(month.long)} · ${state.area === 'all' ? 'todas as áreas' : esc(state.area)} · ${stats.n} colaboradores</p>
    </div>

    <section class="kpis">
      <article class="card kpi kpi--hero">
        <span class="kpi__label">Score médio da equipe</span>
        <span class="kpi__value">${pct(stats.avg)}</span>
        <span class="delta ${deltaClass(avgDelta)}">${prev ? `${signedPct(avgDelta)} vs ${MONTHS[state.monthIdx - 1].label}` : 'Primeiro mês da série'}</span>
      </article>
      ${['ACIMA', 'DENTRO', 'ABAIXO']
        .map((k) => {
          const d = prev ? stats.counts[k] - prev.counts[k] : null;
          return `<article class="card kpi">
            <span class="kpi__label"><span class="dot dot--${k.toLowerCase()}" aria-hidden="true"></span>${CLASSES[k].label}</span>
            <span class="kpi__value">${stats.counts[k]}</span>
            <span class="muted small">${stats.n ? Math.round((stats.counts[k] / stats.n) * 100) : 0}% da equipe${d ? ` · ${d > 0 ? '+' : '−'}${Math.abs(d)} vs ${MONTHS[state.monthIdx - 1].label}` : ''}</span>
          </article>`;
        })
        .join('')}
    </section>

    <section class="grid grid--2-1">
      <article class="card">
        <header class="card__head"><h2>Evolução do score médio</h2><span class="muted small">Últimos ${MONTHS.length} meses · linhas de corte da classificação</span></header>
        <div class="chart-box" id="ch-trend"></div>
      </article>
      <article class="card">
        <header class="card__head"><h2>Média por área</h2><span class="muted small">${esc(month.long)}</span></header>
        <div class="chart-box" id="ch-areas"></div>
      </article>
    </section>

    <section class="grid grid--1-2">
      <article class="card">
        <header class="card__head"><h2>Classificação por mês</h2><span class="muted small">Pessoas em cada faixa</span></header>
        <div class="chart-box" id="ch-dist"></div>
        <ul class="legend">
          ${['ACIMA', 'DENTRO', 'ABAIXO'].map((k) => `<li><span class="legend__box" style="background:${colors[k]}"></span>${CLASSES[k].short}</li>`).join('')}
        </ul>
      </article>
      <article class="card">
        <header class="card__head"><h2>Destaques do mês</h2><a class="link" href="#/ranking">Ver ranking completo →</a></header>
        <div class="highlights highlights--cols">
          <div>
            <h3>Melhores scores</h3>
            <ol class="mini-list">${rank.slice(0, 3).map((r) => miniRow(r, `${r.pos}º`)).join('')}</ol>
          </div>
          <div>
            <h3>Precisam de atenção</h3>
            <ol class="mini-list">${rank.filter((r) => r.cls === 'ABAIXO').slice(-3).reverse().map((r) => miniRow(r, `${r.pos}º`)).join('') || '<li class="muted small">Ninguém abaixo do esperado neste mês.</li>'}</ol>
          </div>
          <div>
            <h3>Maiores subidas no ranking</h3>
            <ol class="mini-list">${climbers.map((r) => miniRow(r, posDelta(r.posDelta), true)).join('') || '<li class="muted small">Sem mês anterior para comparar.</li>'}</ol>
          </div>
        </div>
      </article>
    </section>`;

  const series = MONTHS.map((_, i) => teamStats(m, i, emps).avg);
  const accent = css('--accent');
  lineChart(root.querySelector('#ch-trend'), {
    labels: MONTHS.map((x) => x.label),
    tipTitles: MONTHS.map((x) => x.long),
    series: [{ name: 'Média da equipe', color: accent, values: series, area: true }],
    domain: [0.5, 1],
    refs: [
      { value: m.thresholds.acima, label: `Acima ${pct(m.thresholds.acima, 0)}` },
      { value: m.thresholds.dentro, label: `Dentro ${pct(m.thresholds.dentro, 0)}` },
    ],
    ariaLabel: `Score médio da equipe por mês: ${series.map((v, i) => `${MONTHS[i].label} ${pct(v)}`).join(', ')}`,
  });

  const dist = MONTHS.map((_, i) => teamStats(m, i, emps).counts);
  stackedColumns(root.querySelector('#ch-dist'), {
    labels: MONTHS.map((x) => x.label),
    tipTitles: MONTHS.map((x) => x.long),
    stacks: ['ABAIXO', 'DENTRO', 'ACIMA'].map((k) => ({ key: k, label: CLASSES[k].label, color: colors[k], values: dist.map((d) => d[k]) })),
    ariaLabel: 'Quantidade de pessoas por classificação em cada mês',
  });

  const areas = areaStats(m, state.monthIdx, emps);
  hBars(root.querySelector('#ch-areas'), {
    items: areas.map((a) => ({ label: a.area, sub: `${a.n} ${a.n === 1 ? 'pessoa' : 'pessoas'}`, value: a.avg })),
    barColor: accent,
    domain: [0, 1],
    refs: [{ value: m.thresholds.acima }, { value: m.thresholds.dentro }],
    valueLabel: 'Score médio',
    ariaLabel: `Score médio por área: ${areas.map((a) => `${a.area} ${pct(a.avg)}`).join(', ')}`,
  });
}

function miniRow(r, lead, showScoreDelta = false) {
  return `<li><a href="#/people/${slug(r.name)}">
    <span class="mini-list__lead">${lead}</span>
    <span class="avatar avatar--sm" aria-hidden="true">${esc(initials(r.name))}</span>
    <span class="mini-list__name"><strong>${esc(r.name)}</strong><span>${esc(r.area)}</span></span>
    <span class="mini-list__value">${pct(r.score)}${showScoreDelta ? `<small class="delta ${deltaClass(r.scoreDelta)}">${signedPct(r.scoreDelta)}</small>` : ''}</span>
  </a></li>`;
}

// ---------- ranking ----------

function renderRanking(root) {
  const m = state.model;
  const emps = visibleEmployees();
  const rank = ranking(m, state.monthIdx, emps);
  const month = MONTHS[state.monthIdx];
  const prevLabel = state.monthIdx > 0 ? MONTHS[state.monthIdx - 1].label : null;
  const [first, second, third] = rank;
  const podium = [second, first, third].filter(Boolean);

  root.innerHTML = `
    <div class="page-head">
      <h1>Ranking mensal</h1>
      <p class="muted">${esc(month.long)} · ${state.area === 'all' ? 'todas as áreas' : esc(state.area)} · ordenado pelo score ponderado</p>
    </div>

    <section class="podium" aria-label="Três primeiros colocados">
      ${podium
        .map(
          (r) => `<a class="card podium__item podium__item--${r.pos}" href="#/people/${slug(r.name)}">
            <span class="podium__pos">${r.pos}º</span>
            <span class="avatar avatar--lg" aria-hidden="true">${esc(initials(r.name))}</span>
            <strong>${esc(r.name)}</strong>
            <span class="muted small">${esc(r.role)} · ${esc(r.area)}</span>
            <span class="podium__score">${pct(r.score)}</span>
            ${posDelta(r.posDelta)}
          </a>`
        )
        .join('')}
    </section>

    <article class="card card--flush">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col" class="num">Pos.</th>
              <th scope="col">${prevLabel ? `vs ${prevLabel}` : 'Variação'}</th>
              <th scope="col">Colaborador</th>
              <th scope="col">Área</th>
              <th scope="col" class="col-score">Score</th>
              <th scope="col" class="num">Δ score</th>
              <th scope="col">Classificação</th>
              <th scope="col">Tendência</th>
            </tr>
          </thead>
          <tbody>
            ${rank
              .map(
                (r) => `<tr data-person="${esc(r.name)}" tabindex="0">
                  <td class="num pos">${r.pos}º</td>
                  <td>${posDelta(r.posDelta)}</td>
                  <td><span class="person-cell"><span class="avatar avatar--sm" aria-hidden="true">${esc(initials(r.name))}</span><span><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.role)}</span></span></span></td>
                  <td>${esc(r.area)}</td>
                  <td class="col-score"><span class="score-cell"><span class="meter"><span class="meter__fill meter__fill--${r.cls.toLowerCase()}" style="width:${(r.score * 100).toFixed(1)}%"></span></span><span class="num">${pct(r.score)}</span></span></td>
                  <td class="num"><span class="delta ${deltaClass(r.scoreDelta)}">${signedPct(r.scoreDelta)}</span></td>
                  <td>${badge(r.cls)}</td>
                  <td class="spark-cell" data-spark="${esc(r.name)}"></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </article>`;

  const accent = css('--accent');
  root.querySelectorAll('[data-spark]').forEach((td) => {
    const name = td.dataset.spark;
    const values = m.months.slice(0, state.monthIdx + 1).map((mo) => mo.records.get(name).score);
    if (values.length > 1) td.appendChild(sparkline(values, { color: accent, domain: [0.4, 1] }));
    else td.textContent = '—';
  });
  root.querySelectorAll('tr[data-person]').forEach((tr) => {
    const go = () => (location.hash = `#/people/${slug(tr.dataset.person)}`);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  });
}

// ---------- colaboradores ----------

function renderPeople(root) {
  const m = state.model;
  const emps = visibleEmployees();
  const rank = ranking(m, state.monthIdx, emps);
  const q = state.search.trim().toLowerCase();
  const list = rank.filter((r) => !q || `${r.name} ${r.role} ${r.area}`.toLowerCase().includes(q));

  root.innerHTML = `
    <div class="page-head page-head--row">
      <div>
        <h1>Colaboradores</h1>
        <p class="muted">${esc(MONTHS[state.monthIdx].long)} · ${list.length} de ${rank.length}</p>
      </div>
      <label class="field field--search">Buscar<input type="search" placeholder="Nome, cargo ou área" value="${esc(state.search)}" /></label>
    </div>
    <section class="people-grid">
      ${
        list
          .map(
            (r) => `<a class="card person-card" href="#/people/${slug(r.name)}">
              <span class="avatar" aria-hidden="true">${esc(initials(r.name))}</span>
              <span class="person-card__body">
                <strong>${esc(r.name)}</strong>
                <span class="muted small">${esc(r.role)} · ${esc(r.area)}</span>
                ${badge(r.cls)}
              </span>
              <span class="person-card__score"><strong>${pct(r.score)}</strong><span class="muted small">${r.pos}º lugar</span></span>
            </a>`
          )
          .join('') || '<p class="muted">Nenhum colaborador encontrado.</p>'
      }
    </section>`;

  const input = root.querySelector('input[type=search]');
  input.addEventListener('input', (e) => {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    renderPeople(root);
    const again = root.querySelector('input[type=search]');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}

function renderPerson(root, name) {
  const m = state.model;
  const scoped = scopeEmployees(state.session, m.employees);
  const person = scoped.find((e) => e.name === name);
  if (!person) {
    root.innerHTML = `<div class="empty"><h1>Colaborador não encontrado</h1><p class="muted">Pode ter sido removido da planilha.</p><a class="btn btn--primary" href="#/people">Voltar</a></div>`;
    return;
  }

  // Comparações usam a equipe toda visível ao perfil (ignora o filtro de área)
  const rankAll = ranking(m, state.monthIdx, scoped);
  const me = rankAll.find((r) => r.name === name);
  const areaPeers = scoped.filter((e) => e.area === person.area);
  const areaRank = ranking(m, state.monthIdx, areaPeers).find((r) => r.name === name);
  const team = teamStats(m, state.monthIdx, scoped);
  const month = MONTHS[state.monthIdx];
  const accent = css('--accent');
  const history = m.months.map((mo, i) => ({ mo, rec: mo.records.get(name), pos: ranking(m, i, scoped).find((r) => r.name === name).pos }));

  root.innerHTML = `
    <a class="back" href="#/people">← Colaboradores</a>
    <div class="person-head">
      <span class="avatar avatar--xl" aria-hidden="true">${esc(initials(person.name))}</span>
      <div>
        <h1>${esc(person.name)}</h1>
        <p class="muted">${esc(person.role)} · ${esc(person.area)}</p>
      </div>
      ${badge(me.cls)}
    </div>

    <section class="kpis">
      <article class="card kpi kpi--hero">
        <span class="kpi__label">Score ponderado · ${esc(month.long)}</span>
        <span class="kpi__value">${pct(me.score)}</span>
        <span class="delta ${deltaClass(me.scoreDelta)}">${me.scoreDelta == null ? 'Primeiro mês da série' : `${signedPct(me.scoreDelta)} vs ${MONTHS[state.monthIdx - 1].label}`}</span>
      </article>
      <article class="card kpi">
        <span class="kpi__label">Posição geral</span>
        <span class="kpi__value">${me.pos}º <small>de ${rankAll.length}</small></span>
        ${posDelta(me.posDelta)}
      </article>
      <article class="card kpi">
        <span class="kpi__label">Posição na área</span>
        <span class="kpi__value">${areaRank.pos}º <small>de ${areaPeers.length}</small></span>
        <span class="muted small">${esc(person.area)}</span>
      </article>
      <article class="card kpi">
        <span class="kpi__label">Vs média da equipe</span>
        <span class="kpi__value">${signedPct(me.score - team.avg)}</span>
        <span class="muted small">Média: ${pct(team.avg)}</span>
      </article>
    </section>

    <section class="grid grid--1-1">
      <article class="card">
        <header class="card__head"><h2>Evolução mensal</h2><span class="muted small">Score ponderado vs média da equipe</span></header>
        <div class="chart-box" id="ch-person"></div>
        <ul class="legend">
          <li><span class="legend__line" style="background:${accent}"></span>${esc(person.name.split(' ')[0])}</li>
          <li><span class="legend__line legend__line--muted"></span>Média da equipe</li>
        </ul>
      </article>
      <article class="card">
        <header class="card__head"><h2>Notas por critério</h2><span class="muted small">${esc(month.long)} · traço = média da equipe</span></header>
        <div class="chart-box" id="ch-criteria"></div>
      </article>
    </section>

    <section class="grid grid--1-1">
      <article class="card">
        <header class="card__head"><h2>Observação do gestor</h2></header>
        ${
          month.live && person.note
            ? `<blockquote class="note">${esc(person.note)}</blockquote><p class="muted small">Fonte: coluna "Observações" da planilha.</p>`
            : `<p class="muted">Sem observação registrada para ${esc(month.long)}.</p>`
        }
      </article>
      <article class="card card--flush">
        <header class="card__head card__head--pad"><h2>Histórico</h2></header>
        <table class="table table--compact">
          <thead><tr><th scope="col">Mês</th><th scope="col" class="num">Score</th><th scope="col" class="num">Posição</th><th scope="col">Classificação</th></tr></thead>
          <tbody>
            ${history
              .slice()
              .reverse()
              .map((h) => `<tr${h.mo.key === month.key ? ' class="is-current"' : ''}><td>${esc(h.mo.long)}</td><td class="num">${pct(h.rec.score)}</td><td class="num">${h.pos}º</td><td>${badge(h.rec.cls)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      </article>
    </section>`;

  lineChart(root.querySelector('#ch-person'), {
    labels: MONTHS.map((x) => x.label),
    tipTitles: MONTHS.map((x) => x.long),
    series: [
      { name: person.name.split(' ')[0], color: accent, values: history.map((h) => h.rec.score) },
      { name: 'Equipe', color: css('--ink-muted'), values: MONTHS.map((_, i) => teamStats(m, i, scoped).avg) },
    ],
    domain: [0.4, 1],
    refs: [
      { value: m.thresholds.acima, label: `Acima ${pct(m.thresholds.acima, 0)}` },
      { value: m.thresholds.dentro, label: `Dentro ${pct(m.thresholds.dentro, 0)}` },
    ],
    ariaLabel: `Evolução do score de ${person.name}`,
  });

  hBars(root.querySelector('#ch-criteria'), {
    items: m.criteria.map((c, i) => ({
      label: c.name,
      sub: `peso ${pct(c.weight, 0)}`,
      value: me.scores[i],
      marker: team.critAvg[i],
    })),
    barColor: accent,
    domain: [0, 1],
    rowHeight: 32,
    labelWidth: 120,
    valueLabel: person.name.split(' ')[0],
    markerLabel: 'Média da equipe',
    ariaLabel: `Notas de ${person.name} por critério`,
  });
}

// ---------- critérios ----------

function renderCriteria(root) {
  const m = state.model;
  const emps = visibleEmployees();
  const stats = teamStats(m, state.monthIdx, emps);
  const accent = css('--accent');
  const sum = m.criteria.reduce((s, c) => s + c.weight, 0);
  const colors = statusColors();

  root.innerHTML = `
    <div class="page-head">
      <h1>Critérios de avaliação</h1>
      <p class="muted">Pesos e limiares lidos da aba "Critérios" da planilha. Alterações na planilha mudam todos os scores.</p>
    </div>
    <section class="grid grid--1-1">
      <article class="card">
        <header class="card__head"><h2>Peso de cada critério</h2><span class="muted small">Soma: ${pct(sum, 0)}${Math.abs(sum - 1) > 0.001 ? ' ⚠ deveria somar 100%' : ''}</span></header>
        <div class="chart-box" id="ch-weights"></div>
      </article>
      <article class="card">
        <header class="card__head"><h2>Média da equipe por critério</h2><span class="muted small">${esc(MONTHS[state.monthIdx].long)}</span></header>
        <div class="chart-box" id="ch-crit-avg"></div>
      </article>
    </section>
    <section class="grid grid--1-1">
      <article class="card">
        <header class="card__head"><h2>Como o score é calculado</h2></header>
        <p>Cada critério recebe uma nota de 0% a 100%. O <strong>score ponderado</strong> é a soma de cada nota multiplicada pelo peso do critério.</p>
        <p class="formula">score = Σ (nota<sub>i</sub> × peso<sub>i</sub>)</p>
      </article>
      <article class="card">
        <header class="card__head"><h2>Faixas de classificação</h2></header>
        <ul class="thresholds">
          <li><span class="legend__box" style="background:${colors.ACIMA}"></span>${badge('ACIMA')}<span>score ≥ ${pct(m.thresholds.acima, 0)}</span></li>
          <li><span class="legend__box" style="background:${colors.DENTRO}"></span>${badge('DENTRO')}<span>${pct(m.thresholds.dentro, 0)} a ${pct(m.thresholds.acima, 0)}</span></li>
          <li><span class="legend__box" style="background:${colors.ABAIXO}"></span>${badge('ABAIXO')}<span>score &lt; ${pct(m.thresholds.dentro, 0)}</span></li>
        </ul>
      </article>
    </section>`;

  const maxW = Math.max(...m.criteria.map((c) => c.weight));
  hBars(root.querySelector('#ch-weights'), {
    items: m.criteria.map((c) => ({ label: c.name, value: c.weight })),
    barColor: css('--navy-mark'),
    domain: [0, Math.ceil((maxW * 1.2) / 0.05) * 0.05],
    valueFormat: (v) => pct(v, 0),
    valueLabel: 'Peso',
    rowHeight: 30,
    labelWidth: 120,
    ariaLabel: `Pesos: ${m.criteria.map((c) => `${c.name} ${pct(c.weight, 0)}`).join(', ')}`,
  });
  hBars(root.querySelector('#ch-crit-avg'), {
    items: m.criteria.map((c, i) => ({ label: c.name, value: stats.critAvg[i] })),
    barColor: accent,
    domain: [0, 1],
    valueLabel: 'Média',
    rowHeight: 30,
    labelWidth: 120,
    ariaLabel: 'Média da equipe por critério',
  });
}

// ---------- orquestração ----------

const VIEWS = { overview: renderOverview, ranking: renderRanking, people: renderPeople, criteria: renderCriteria };

function render() {
  hideTip();
  if (!state.session) return renderLogin();
  if (!state.model) return renderLoading();
  let { view, param } = route();
  if (!VIEWS[view] || !canSee(state.session, view)) {
    view = ROLES[state.session.role].views[0];
    history.replaceState(null, '', `#/${view}`);
  }
  renderShell();
  const root = document.getElementById('view');
  if (view === 'people' && param) renderPerson(root, param);
  else VIEWS[view](root);
  root.focus?.({ preventScroll: true });
}

function renderLoading() {
  app.className = 'loading-page';
  app.innerHTML = `<div class="loader" role="status"><span class="spinner" aria-hidden="true"></span>Carregando dados da planilha…</div>`;
}

async function refresh() {
  state.loading = true;
  render();
  state.model = await loadData();
  state.loading = false;
  render();
}

async function start() {
  renderLoading();
  state.model = await loadData();
  render();
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  localStorage.setItem('aurora.theme', root.dataset.theme);
  render();
}

const savedTheme = localStorage.getItem('aurora.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

window.addEventListener('hashchange', () => {
  if (state.model) {
    render();
    window.scrollTo(0, 0);
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.model && render(), 150);
});

if (state.session) start();
else renderLogin();
