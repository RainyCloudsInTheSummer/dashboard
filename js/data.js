// Camada de dados: lê a planilha ao vivo, cai para o snapshot se falhar,
// gera o histórico fictício e calcula scores, classificações e rankings.

import { SHEET_ID, RANGES, MONTHS } from './config.js';
import { SNAPSHOT } from '../data/snapshot.js';

// ---------- Leitura da planilha (gviz JSON) ----------

async function fetchRange({ sheet, range }) {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=0` +
    `&sheet=${encodeURIComponent(sheet)}&range=${range}&_=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao ler ${sheet}!${range}`);
  const text = await res.text();
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (json.status !== 'ok') throw new Error(`Planilha respondeu "${json.status}" em ${sheet}!${range}`);
  return json.table.rows.map((r) => (r.c ?? []).map((cell) => (cell ? cell.v : null)));
}

async function fetchLive() {
  const [rows, [names], [weights], thr] = await Promise.all([
    fetchRange(RANGES.avaliacoes),
    fetchRange(RANGES.criteriosNomes),
    fetchRange(RANGES.criteriosPesos),
    fetchRange(RANGES.limiares),
  ]);

  if (!names || !weights) throw new Error('Critérios não encontrados na planilha');
  const criteria = names.map((name, i) => ({ name: String(name), weight: Number(weights[i]) || 0 }));

  const thrMap = Object.fromEntries(thr.map(([label, v]) => [String(label).split(' ')[0], Number(v)]));

  const people = rows
    .filter((r) => r[0] && String(r[0]).trim())
    .map((r) => ({
      name: String(r[0]).trim(),
      area: String(r[1] ?? '').trim(),
      role: String(r[2] ?? '').trim(),
      scores: r.slice(3, 3 + criteria.length).map((v) => Number(v) || 0),
      note: String(r[15] ?? '').trim(),
    }));

  if (!people.length) throw new Error('Nenhum colaborador encontrado na planilha');
  return {
    criteria,
    thresholds: { acima: thrMap.ACIMA ?? 0.9, dentro: thrMap.DENTRO ?? 0.7 },
    rows: people,
  };
}

// ---------- Regras de negócio (espelham as fórmulas da planilha) ----------

export function weightedScore(scores, criteria) {
  return scores.reduce((sum, v, i) => sum + v * (criteria[i]?.weight ?? 0), 0);
}

export function classify(score, thresholds) {
  if (score >= thresholds.acima) return 'ACIMA';
  if (score >= thresholds.dentro) return 'DENTRO';
  return 'ABAIXO';
}

// ---------- Histórico fictício ----------
// Determinístico: o mesmo colaborador gera sempre a mesma trajetória.

function hashString(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function rng(seed) {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

// Para cada colaborador, recua a partir do mês ao vivo: uma tendência individual
// (alguns vêm melhorando, outros caindo) mais ruído por critério.
function buildHistory(person, monthsBack) {
  const rand = rng(hashString(person.name));
  const trend = (rand() - 0.45) * 0.07; // ≈ -3,2 .. +3,9 p.p. por mês (positivo = melhorou até hoje)
  const history = [];
  for (let k = monthsBack; k >= 1; k--) {
    const monthShock = (rand() - 0.5) * 0.07; // mês bom/ruim para a pessoa toda
    history.push(
      person.scores.map((v) => round2(clamp(v - trend * k + monthShock + (rand() - 0.5) * 0.06, 0.35, 0.99)))
    );
  }
  return history; // ordem cronológica, sem o mês ao vivo
}

// ---------- Montagem do modelo ----------

function buildModel(base, source, error) {
  const { criteria, thresholds, rows } = base;
  const employees = rows.map((r) => ({ name: r.name, area: r.area, role: r.role, note: r.note }));

  const months = MONTHS.map((m) => ({ ...m, records: new Map() }));
  const live = months.length - 1;

  for (const person of rows) {
    const past = buildHistory(person, live);
    months.forEach((m, i) => {
      const scores = i === live ? person.scores : past[i];
      const score = weightedScore(scores, criteria);
      m.records.set(person.name, { scores, score, cls: classify(score, thresholds) });
    });
  }

  return { source, error, fetchedAt: new Date(), criteria, thresholds, employees, months };
}

export async function loadData() {
  try {
    return buildModel(await fetchLive(), 'live', null);
  } catch (err) {
    console.warn('Leitura ao vivo falhou, usando snapshot:', err);
    return buildModel(SNAPSHOT, 'snapshot', err.message);
  }
}

// ---------- Consultas ----------

// Ranking de um mês para um conjunto de colaboradores (já filtrado por perfil/área).
export function ranking(model, monthIndex, employees) {
  const rankOf = (idx) => {
    const m = model.months[idx];
    if (!m) return null;
    const sorted = employees
      .map((e) => ({ e, r: m.records.get(e.name) }))
      .filter((x) => x.r)
      .sort((a, b) => b.r.score - a.r.score);
    return new Map(sorted.map((x, i) => [x.e.name, i + 1]));
  };

  const current = rankOf(monthIndex);
  const previous = rankOf(monthIndex - 1);
  const prevMonth = model.months[monthIndex - 1];

  return employees
    .map((e) => {
      const r = model.months[monthIndex].records.get(e.name);
      const prevScore = prevMonth?.records.get(e.name)?.score ?? null;
      const prevPos = previous?.get(e.name) ?? null;
      const pos = current.get(e.name);
      return {
        ...e,
        ...r,
        pos,
        posDelta: prevPos == null ? null : prevPos - pos, // positivo = subiu
        scoreDelta: prevScore == null ? null : r.score - prevScore,
      };
    })
    .sort((a, b) => a.pos - b.pos);
}

export function teamStats(model, monthIndex, employees) {
  const m = model.months[monthIndex];
  const recs = employees.map((e) => m.records.get(e.name)).filter(Boolean);
  const n = recs.length;
  const avg = n ? recs.reduce((s, r) => s + r.score, 0) / n : 0;
  const counts = { ACIMA: 0, DENTRO: 0, ABAIXO: 0 };
  recs.forEach((r) => counts[r.cls]++);
  const critAvg = model.criteria.map((_, i) => (n ? recs.reduce((s, r) => s + r.scores[i], 0) / n : 0));
  return { n, avg, counts, critAvg };
}

export function areaStats(model, monthIndex, employees) {
  const groups = new Map();
  for (const e of employees) {
    const r = model.months[monthIndex].records.get(e.name);
    if (!r) continue;
    if (!groups.has(e.area)) groups.set(e.area, []);
    groups.get(e.area).push(r.score);
  }
  return [...groups]
    .map(([area, s]) => ({ area, n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length }))
    .sort((a, b) => b.avg - a.avg);
}
