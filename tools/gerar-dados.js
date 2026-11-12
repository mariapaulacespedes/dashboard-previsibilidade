/*
 * Gerador de dados SINTÉTICOS (fictícios) para o dashboard.
 * Uso:  node tools/gerar-dados.js
 * Saída: data/itens.csv  (para abrir no Excel / inspecionar)
 *        data/itens.js   (mesmo conteúdo, embutido para o site funcionar
 *                         com duplo clique no index.html, sem servidor)
 *
 * O sorteio usa uma "semente" fixa: rodar de novo gera exatamente os mesmos dados.
 */
const fs = require('fs');
const path = require('path');

// ---------- sorteio reproduzível ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260504);
const normal = () => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const poisson = (mean) => {
  const L = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
};

// ---------- datas (contadas em dias, sem fuso horário) ----------
const DAY = 86400000;
const toDay = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
const toISO = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const weekday = (d) => new Date(d * DAY).getUTCDay(); // 0=dom ... 6=sáb

const INICIO = toDay('2026-05-04'); // segunda-feira
const SEMANAS = 26;                 // ~6 meses
const REF = INICIO + SEMANAS * 7 - 1; // domingo 2026-11-01 = "foto" dos dados

// ---------- perfil de cada time ----------
// medianaDias = tempo típico; cauda = quanto os casos demorados se afastam do típico
const TIPOS = {
  'História':       { medianaDias: 5, cauda: 0.55 },
  'Bug':            { medianaDias: 7, cauda: 0.85 }, // bugs demoram mais e variam mais
  'Débito Técnico': { medianaDias: 6, cauda: 0.60 },
};
const FERIADO = 18; // semana de 07/09 (todos os times entregam menos)
const TIMES = [
  { nome: 'App Mobile',         prefixo: 'APP', inicioPorSemana: 7.0, fator: 0.90,
    mix: { 'História': 0.50, 'Bug': 0.35, 'Débito Técnico': 0.15 },
    semanasRuins: [7, 8, 21, FERIADO] },   // congelamento de release na loja
  { nome: 'Produtos',           prefixo: 'PRD', inicioPorSemana: 5.2, fator: 1.25,
    mix: { 'História': 0.65, 'Bug': 0.20, 'Débito Técnico': 0.15 },
    semanasRuins: [5, 14, 15, FERIADO] },  // dependência externa travada
  { nome: 'Jornada do Cliente', prefixo: 'JRN', inicioPorSemana: 6.0, fator: 1.00,
    mix: { 'História': 0.45, 'Bug': 0.25, 'Débito Técnico': 0.30 },
    semanasRuins: [10, 11, 23, FERIADO] }, // incidente em produção
];

const sorteiaTipo = (mix) => {
  let r = rnd();
  for (const [tipo, p] of Object.entries(mix)) { if ((r -= p) <= 0) return tipo; }
  return 'História';
};
const pulaFimDeSemana = (d) => (weekday(d) === 6 ? d + 2 : weekday(d) === 0 ? d + 1 : d);

const itens = [];
for (const t of TIMES) {
  const doTime = [];
  for (let s = -5; s < SEMANAS; s++) { // começa antes para já haver trabalho em andamento
    const ruim = t.semanasRuins.includes(s);
    const n = poisson(t.inicioPorSemana * (ruim ? 0.6 : 1));
    for (let i = 0; i < n; i++) {
      const tipo = sorteiaTipo(t.mix);
      const inicio = INICIO + s * 7 + Math.floor(rnd() * 5); // seg a sex
      const perfil = TIPOS[tipo];
      const duracao = Math.max(1, Math.round(perfil.medianaDias * t.fator * Math.exp(perfil.cauda * normal())));
      let fim = pulaFimDeSemana(inicio + duracao - 1);
      // semana ruim: boa parte do que terminaria nela escorrega para a seguinte
      const semFim = Math.floor((fim - INICIO) / 7);
      if (t.semanasRuins.includes(semFim) && rnd() < 0.65) fim = pulaFimDeSemana(fim + 5 + Math.floor(rnd() * 5));
      if (fim < INICIO) continue;
      doTime.push({ time: t.nome, tipo, inicio, fim: fim <= REF ? fim : null });
    }
  }
  // itens "travados": abertos há muito tempo e ainda não concluídos
  const travados = [[38, 'Bug'], [21, 'História']];
  for (const [dias, tipo] of travados) {
    const inicio = pulaFimDeSemana(REF - dias - Math.floor(rnd() * 6));
    doTime.push({ time: t.nome, tipo, inicio, fim: null });
  }
  doTime.sort((a, b) => a.inicio - b.inicio);
  doTime.forEach((it, i) => itens.push({ id: `${t.prefixo}-${101 + i}`, ...it }));
}
itens.sort((a, b) => a.inicio - b.inicio || a.id.localeCompare(b.id));

const linhas = ['id,time,tipo,data_inicio,data_fim,status'];
for (const it of itens) {
  linhas.push([it.id, it.time, it.tipo, toISO(it.inicio), it.fim ? toISO(it.fim) : '',
    it.fim ? 'Concluído' : 'Em andamento'].join(','));
}
const csv = linhas.join('\n') + '\n';

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'itens.csv'), '﻿' + csv, 'utf8');
fs.writeFileSync(path.join(dir, 'itens.js'),
  '// Gerado por tools/gerar-dados.js — cópia de data/itens.csv. Dados fictícios.\n' +
  'window.DADOS_CSV = ' + JSON.stringify(csv) + ';\n' +
  'window.DADOS_REF = ' + JSON.stringify(toISO(REF)) + ';\n', 'utf8');

// ---------- resumo para conferência ----------
const feitos = itens.filter((i) => i.fim);
console.log(`Itens: ${itens.length} | concluídos: ${feitos.length} | em andamento: ${itens.length - feitos.length}`);
for (const t of TIMES) {
  const f = feitos.filter((i) => i.time === t.nome);
  const porSemana = Array(SEMANAS).fill(0);
  f.forEach((i) => porSemana[Math.floor((i.fim - INICIO) / 7)]++);
  const ct = f.map((i) => i.fim - i.inicio + 1).sort((a, b) => a - b);
  const p = (q) => ct[Math.ceil(q * ct.length) - 1];
  console.log(`${t.nome.padEnd(20)} wip=${itens.filter((i) => i.time === t.nome && !i.fim).length} ` +
    `P50=${p(0.5)} P85=${p(0.85)} P95=${p(0.95)} | semanas: ${porSemana.join(' ')}`);
}
for (const tipo of Object.keys(TIPOS)) {
  const ct = feitos.filter((i) => i.tipo === tipo).map((i) => i.fim - i.inicio + 1).sort((a, b) => a - b);
  console.log(`${tipo.padEnd(15)} n=${ct.length} P50=${ct[Math.ceil(0.5 * ct.length) - 1]} P85=${ct[Math.ceil(0.85 * ct.length) - 1]}`);
}
