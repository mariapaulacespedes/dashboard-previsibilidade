/* Dashboard de Previsibilidade — toda a lógica roda no navegador, sem servidor.
   Seções deste arquivo:
   1) Utilidades (datas, percentil, textos)
   2) Leitura dos dados (CSV)
   3) Cálculo das métricas
   4) Monte Carlo
   5) Desenho dos gráficos
   6) Controles (filtro, idioma, campos) */
(function () {
  'use strict';

  // =====================================================================
  // 1) UTILIDADES
  // =====================================================================
  const DAY = 86400000;
  // Datas são tratadas como "número do dia" (sem horas/fuso) para evitar erros de 1 dia.
  const toDay = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
  const toISO = (d) => new Date(d * DAY).toISOString().slice(0, 10);
  const mondayOf = (d) => d - ((new Date(d * DAY).getUTCDay() + 6) % 7);

  const state = { lang: 'pt', team: 'all', hist: 12, x: 100, y: null };
  try { if (localStorage.getItem('lang') === 'en') state.lang = 'en'; } catch (e) { /* sem armazenamento: segue em PT */ }

  function t(key, vars) {
    let s = (window.I18N[state.lang] || {})[key];
    if (s === undefined) s = window.I18N.pt[key] !== undefined ? window.I18N.pt[key] : key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  function fmtDate(d, short) {
    const dt = new Date(d * DAY);
    if (state.lang === 'en') {
      const o = short ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
      return dt.toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o));
    }
    const iso = toISO(d);
    return iso.slice(8, 10) + '/' + iso.slice(5, 7) + (short ? '' : '/' + iso.slice(0, 4));
  }
  const fmtNum = (n, dec) => n.toLocaleString(state.lang === 'en' ? 'en-US' : 'pt-BR',
    { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  const plural = (n, base) => t('unit.' + base + (n === 1 ? '' : 's'));

  /* Percentil pelo método "posição mais próxima":
     ordena os valores e pega o que está na posição p% da fila.
     Ex.: P85 de 100 itens = o 85º menor valor → 85% dos itens levaram até esse tempo. */
  function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
    return sortedAsc[idx];
  }
  const sortNum = (arr) => arr.slice().sort((a, b) => a - b);

  // =====================================================================
  // 2) DADOS
  // =====================================================================
  const TYPES = ['História', 'Bug', 'Débito Técnico'];
  const TYPE_COLOR = { 'História': '#2a78d6', 'Bug': '#eb6834', 'Débito Técnico': '#1baf7a' };
  const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#7a7872', GRID = '#e9e8e2', AXIS = '#c3c2b7';
  const CRITICAL = '#d03b3b', NEUTRAL_BAR = '#a9b4c4';

  function parseCSV(text) {
    const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
    const head = lines.shift().split(',');
    return lines.map((line) => {
      const c = line.split(','), o = {};
      head.forEach((h, i) => { o[h] = (c[i] || '').trim(); });
      return {
        id: o.id, team: o.time, type: o.tipo, status: o.status,
        start: toDay(o.data_inicio),
        end: o.data_fim ? toDay(o.data_fim) : null
      };
    });
  }

  const ALL = parseCSV(window.DADOS_CSV || '');
  const ORDER = ['App Mobile', 'Produtos', 'Jornada do Cliente'];
  const TEAMS = Array.from(new Set(ALL.map((i) => i.team)))
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  // "Hoje" do dashboard = data da foto dos dados (fixa), para o exemplo não envelhecer.
  const REF = window.DADOS_REF ? toDay(window.DADOS_REF)
    : Math.max.apply(null, ALL.map((i) => i.end || i.start));
  const FIRST_WEEK = mondayOf(Math.min.apply(null, ALL.filter((i) => i.end !== null).map((i) => i.end)));
  const N_WEEKS = Math.floor((mondayOf(REF) - FIRST_WEEK) / 7) + 1;
  const WEEKS = Array.from({ length: N_WEEKS }, (_, i) => FIRST_WEEK + i * 7);
  state.y = toISO(REF + 42);

  // =====================================================================
  // 3) MÉTRICAS
  // =====================================================================
  function compute() {
    const items = state.team === 'all' ? ALL : ALL.filter((i) => i.team === state.team);
    const done = items.filter((i) => i.end !== null);
    const wip = items.filter((i) => i.end === null);

    // Throughput: quantos itens foram concluídos em cada semana (segunda a domingo)
    const throughput = WEEKS.map(() => 0);
    done.forEach((i) => {
      const w = Math.floor((mondayOf(i.end) - FIRST_WEEK) / 7);
      if (w >= 0 && w < N_WEEKS) throughput[w]++;
    });
    // Média móvel: média da semana com as 3 anteriores
    const movingAvg = throughput.map((_, i) =>
      i < 3 ? null : (throughput[i] + throughput[i - 1] + throughput[i - 2] + throughput[i - 3]) / 4);

    // Cycle time: dias corridos do início ao fim, contando os dois dias
    done.forEach((i) => { i.cycle = i.end - i.start + 1; });
    const cycles = sortNum(done.map((i) => i.cycle));
    const p50 = percentile(cycles, 50), p85 = percentile(cycles, 85), p95 = percentile(cycles, 95);

    // Aging: há quantos dias cada item em andamento está aberto
    wip.forEach((i) => { i.age = REF - i.start + 1; });
    const aging = wip.slice().sort((a, b) => b.age - a.age);
    const aged = aging.filter((i) => i.age > p85).length;

    // Tipos
    const types = TYPES.map((type) => {
      const all = items.filter((i) => i.type === type);
      const ct = sortNum(all.filter((i) => i.end !== null).map((i) => i.cycle));
      return { type, count: all.length, share: items.length ? all.length / items.length : 0,
        p50: percentile(ct, 50), p85: percentile(ct, 85) };
    });

    return { items, done, wip, throughput, movingAvg, p50, p85, p95, aging, aged, types };
  }

  // =====================================================================
  // 4) MONTE CARLO
  // =====================================================================
  const RUNS = 10000;
  const MAX_WEEKS = 520; // trava de segurança (10 anos)

  // Sorteio com semente fixa: as mesmas entradas dão sempre a mesma resposta.
  function makeRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Pergunta 1 — "Quando terminamos X itens?"
     Cada simulação: sorteia uma semana do histórico, soma o que foi entregue nela,
     e repete até a soma chegar em X. Anota quantos dias precisou.
     Na última semana usa regra de três: se faltavam 5 itens e a semana sorteada
     entregou 10, considera meia semana (4 dias, arredondando para cima). */
  function simulateDaysToFinish(samples, x) {
    const rand = makeRandom(12345), out = new Array(RUNS);
    for (let r = 0; r < RUNS; r++) {
      let sum = 0, days = 0;
      for (let w = 0; w < MAX_WEEKS; w++) {
        const delivered = samples[Math.floor(rand() * samples.length)];
        if (sum + delivered >= x) { days += Math.ceil((7 * (x - sum)) / delivered); break; }
        sum += delivered;
        days += 7;
      }
      out[r] = days;
    }
    return sortNum(out);
  }

  /* Pergunta 2 — "Quantos itens até a data Y?"
     Cada simulação: sorteia uma semana do histórico para cada semana que falta
     até a data e soma as entregas. */
  function simulateItemsInWeeks(samples, nWeeks) {
    const rand = makeRandom(67890), out = new Array(RUNS);
    for (let r = 0; r < RUNS; r++) {
      let sum = 0;
      for (let w = 0; w < nWeeks; w++) sum += samples[Math.floor(rand() * samples.length)];
      out[r] = sum;
    }
    return sortNum(out);
  }

  // Para "quantos itens", confiança alta = número MENOR (o que quase sempre conseguimos superar).
  // 85% de confiança = valor que 85% das simulações igualaram ou superaram.
  const atLeast = (sortedAsc, conf) => sortedAsc[Math.floor((1 - conf / 100) * sortedAsc.length)];

  // =====================================================================
  // 5) GRÁFICOS
  // =====================================================================
  const charts = {};
  const hasChart = typeof window.Chart !== 'undefined';

  // Pequeno complemento do Chart.js: desenha linhas de referência (percentis) com rótulo.
  const refLines = {
    id: 'refLines',
    afterDatasetsDraw(chart, _args, opts) {
      const lines = (opts && opts.lines) || [];
      const ctx = chart.ctx, a = chart.chartArea;
      lines.forEach((l, i) => {
        const px = chart.scales[l.axis].getPixelForValue(l.value);
        if (!isFinite(px)) return;
        ctx.save();
        ctx.strokeStyle = l.color || INK;
        ctx.lineWidth = l.width || 1.5;
        ctx.setLineDash(l.dash || []);
        ctx.beginPath();
        if (l.axis === 'y') { ctx.moveTo(a.left, px); ctx.lineTo(a.right, px); }
        else { ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); }
        ctx.stroke();
        if (l.label) {
          ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
          const w = ctx.measureText(l.label).width;
          let tx, ty;
          if (l.axis === 'y') { tx = a.right - w - 6; ty = px - 9; }
          else {
            const row = l.row !== undefined ? l.row : i;
            tx = px + 6; if (tx + w > a.right) tx = px - w - 6;
            if (tx < a.left) tx = a.left + 2;
            ty = a.top + 9 + row * 16;
          }
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(tx - 3, ty - 8, w + 6, 16);
          ctx.fillStyle = l.textColor || INK;
          ctx.textBaseline = 'middle';
          ctx.fillText(l.label, tx, ty);
        }
        ctx.restore();
      });
    }
  };

  if (hasChart) {
    Chart.register(refLines);
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = INK2;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = false;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = '#1a1a19';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
  }

  function draw(id, config) {
    if (!hasChart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }
  const axis = (title, extra) => Object.assign({
    title: { display: !!title, text: title, color: MUTED, font: { size: 12 } },
    grid: { color: GRID }, border: { color: AXIS }, ticks: { color: MUTED }
  }, extra || {});
  const noGrid = { display: false };

  function drawThroughput(m) {
    draw('ch-throughput', {
      data: {
        labels: WEEKS.map((w) => fmtDate(w, true)),
        datasets: [
          { type: 'line', label: t('tp.avg'), data: m.movingAvg, borderColor: INK, backgroundColor: INK,
            borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, order: 0 },
          { type: 'bar', label: t('tp.bars'), data: m.throughput, backgroundColor: '#2a78d6',
            hoverBackgroundColor: '#184f95', borderRadius: 4, maxBarThickness: 28, order: 1 }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: axis('', { grid: noGrid, ticks: { color: MUTED, maxRotation: 0, autoSkipPadding: 12 } }),
          y: axis(t('tp.axis'), { beginAtZero: true, ticks: { color: MUTED, precision: 0 } })
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: {
            title: (it) => t('tp.tip.week', { date: fmtDate(WEEKS[it[0].dataIndex]) }),
            label: (c) => c.dataset.label + ': ' + fmtNum(c.parsed.y, c.dataset.type === 'line' ? 1 : 0)
          } }
        }
      }
    });
  }

  function drawCycle(m) {
    const datasets = TYPES.map((type) => ({
      label: t('type.' + type),
      data: m.done.filter((i) => i.type === type).map((i) => ({ x: i.end, y: i.cycle, item: i })),
      backgroundColor: TYPE_COLOR[type] + 'b3', borderColor: '#ffffff', borderWidth: 1,
      pointRadius: 4.5, pointHoverRadius: 7
    }));
    const line = (p, v, dash, width) => ({ axis: 'y', value: v, dash, width, color: INK,
      label: t('ct.line', { p, d: v }) });
    draw('ch-cycle', {
      type: 'scatter',
      data: { datasets },
      options: {
        scales: {
          x: axis(t('ct.axis.x'), { min: FIRST_WEEK, max: REF + 1, grid: noGrid,
            ticks: { color: MUTED, maxRotation: 0, stepSize: 14, autoSkipPadding: 14, callback: (v) => fmtDate(v, true) } }),
          y: axis(t('ct.axis.y'), { beginAtZero: true, ticks: { color: MUTED, precision: 0 } })
        },
        plugins: {
          legend: { position: 'bottom' },
          refLines: { lines: m.done.length ? [
            line(50, m.p50, [2, 4], 1.5), line(85, m.p85, [7, 4], 2), line(95, m.p95, [], 1.5)
          ] : [] },
          tooltip: { callbacks: {
            title: () => '',
            label: (c) => { const i = c.raw.item; return t('ct.tip', { id: i.id, type: t('type.' + i.type), d: i.cycle, date: fmtDate(i.end) }); }
          } }
        }
      }
    });
  }

  function drawAging(m) {
    const wrap = document.getElementById('ag-wrap');
    document.getElementById('ag-resumo').textContent = m.aging.length
      ? t('ag.summary', { n: m.aging.length, a: m.aged, d: m.p85 }) : t('ag.none');
    wrap.style.height = Math.max(180, m.aging.length * 24 + 70) + 'px';
    draw('ch-aging', {
      type: 'bar',
      data: {
        labels: m.aging.map((i) => (i.age > m.p85 ? '⚠ ' : '') + i.id),
        datasets: [{ data: m.aging.map((i) => i.age),
          backgroundColor: m.aging.map((i) => (i.age > m.p85 ? CRITICAL : NEUTRAL_BAR)),
          borderRadius: 4, barThickness: 14 }]
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: axis(t('ag.axis'), { beginAtZero: true, ticks: { color: MUTED, precision: 0 },
            suggestedMax: Math.max(m.p85 * 1.25, m.aging.length ? m.aging[0].age : 0) }),
          y: axis('', { grid: noGrid, ticks: { color: INK2, autoSkip: false, font: { size: 11 } } })
        },
        plugins: {
          legend: { display: false },
          refLines: { lines: m.aging.length ? [
            { axis: 'x', value: m.p50, dash: [2, 4], color: INK, label: 'P50 · ' + m.p50, row: 0 },
            { axis: 'x', value: m.p85, dash: [7, 4], width: 2, color: INK, label: 'P85 · ' + m.p85, row: 1 }
          ] : [] },
          tooltip: { callbacks: {
            title: (it) => m.aging[it[0].dataIndex].id,
            label: (c) => { const i = m.aging[c.dataIndex]; return t('ag.tip', { type: t('type.' + i.type), d: i.age, date: fmtDate(i.start) }); },
            afterLabel: (c) => (m.aging[c.dataIndex].age > m.p85 ? '⚠ ' + t('ag.tip.over') : '')
          } }
        }
      }
    });
  }

  function drawTypes(m) {
    draw('ch-types', {
      type: 'doughnut',
      data: {
        labels: m.types.map((x) => t('type.' + x.type)),
        datasets: [{ data: m.types.map((x) => x.count), backgroundColor: m.types.map((x) => TYPE_COLOR[x.type]),
          borderColor: '#ffffff', borderWidth: 2, hoverOffset: 4 }]
      },
      options: {
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (c) => ' ' + c.label + ': ' + c.parsed + ' (' + fmtNum(m.types[c.dataIndex].share * 100) + '%)' } }
        }
      }
    });
    const d = ' ' + t('unit.days');
    document.getElementById('ty-tabela').innerHTML =
      '<thead><tr><th>' + t('ty.col.type') + '</th><th>' + t('ty.col.items') + '</th><th>%</th><th>' +
      t('ty.col.p50') + '</th><th>' + t('ty.col.p85') + '</th></tr></thead><tbody>' +
      m.types.map((x) => '<tr><td><span class="bolinha" style="background:' + TYPE_COLOR[x.type] + '"></span>' +
        t('type.' + x.type) + '</td><td>' + x.count + '</td><td>' + fmtNum(x.share * 100) + '%</td><td>' +
        (x.p50 ? x.p50 + d : '–') + '</td><td>' + (x.p85 ? x.p85 + d : '–') + '</td></tr>').join('') + '</tbody>';
  }

  function histogramChart(id, labels, values, highlight, lines, xTitle) {
    draw(id, {
      type: 'bar',
      data: { labels, datasets: [{ data: values,
        backgroundColor: values.map((_, i) => (highlight(i) ? '#2a78d6' : '#b7d3f6')),
        borderRadius: 3, categoryPercentage: 0.94, barPercentage: 0.94 }] },
      options: {
        scales: {
          x: axis(xTitle, { grid: noGrid, ticks: { color: MUTED, maxRotation: 0, autoSkipPadding: 10 } }),
          y: axis(t('mc.pct'), { beginAtZero: true, grace: '30%', ticks: { color: MUTED, callback: (v) => v + '%' } })
        },
        plugins: {
          legend: { display: false },
          refLines: { lines },
          tooltip: { callbacks: { label: (c) => t('mc.tip', { v: fmtNum(c.parsed.y, 1) }) } }
        }
      }
    });
  }

  function resultTile(label, value, note, highlight) {
    return '<div class="res' + (highlight ? ' destaque' : '') + '"><p class="res-rotulo">' + label +
      '</p><p class="res-valor">' + value + '</p><p class="res-nota">' + note + '</p></div>';
  }

  function drawMonteCarlo(m) {
    const samples = m.throughput.slice(-state.hist);
    const teamName = state.team === 'all' ? t('filter.all') : t('team.' + state.team);
    document.getElementById('mc-amostra').textContent = t('mc.sample', { team: teamName, list: samples.join(', ') });
    const res1 = document.getElementById('mc1-res'), res2 = document.getElementById('mc2-res');
    const usable = samples.some((v) => v > 0);
    if (!usable) {
      res1.innerHTML = res2.innerHTML = '<p class="res-aviso">' + t('mc.nodata') + '</p>';
      ['ch-mc1', 'ch-mc2'].forEach((id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
      return;
    }

    // ---------- Pergunta 1 ----------
    const days = simulateDaysToFinish(samples, state.x);
    const d50 = percentile(days, 50), d85 = percentile(days, 85), d95 = percentile(days, 95);
    const tile1 = (p, d) => resultTile(t('mc.conf', { p }), t('mc1.until', { date: fmtDate(REF + d) }),
      t('mc1.in', { d, unit: plural(d, 'day') }), p === 85);
    res1.innerHTML = tile1(50, d50) + tile1(85, d85) + tile1(95, d95) +
      '<p class="res-frase">' + t('mc1.phrase', { x: state.x, date: fmtDate(REF + d85) }) + '</p>';

    // Histograma: agrupa os dias em faixas para caber na tela
    const lo1 = days[0], hi1 = Math.max(d95, percentile(days, 99.5));
    const binW1 = Math.max(1, Math.ceil((hi1 - lo1 + 1) / 35));
    const nBins1 = Math.ceil((hi1 - lo1 + 1) / binW1);
    const bin1 = (d) => Math.floor((d - lo1) / binW1);
    const labels1 = [], values1 = new Array(nBins1).fill(0);
    for (let k = 0; k < nBins1; k++) labels1.push(fmtDate(REF + lo1 + k * binW1, true));
    days.forEach((d) => { if (d <= hi1) values1[bin1(d)] += 100 / RUNS; });
    // Se dois níveis de confiança caem na mesma barra, junta os rótulos
    const groups = {};
    [[50, d50], [85, d85], [95, d95]].forEach(([p, d]) => { (groups[bin1(d)] = groups[bin1(d)] || []).push(p + '%'); });
    const lines1 = Object.keys(groups).map((k, i) => ({ axis: 'x', value: Number(k), color: INK,
      dash: [5, 4], label: groups[k].join(' · '), row: i }));
    histogramChart('ch-mc1', labels1, values1, (i) => i <= bin1(d85), lines1, t('mc1.axis'));

    // ---------- Pergunta 2 ----------
    const target = toDay(state.y);
    const nWeeks = Math.floor((target - REF) / 7); // só semanas completas (conservador)
    if (!(nWeeks >= 1)) {
      res2.innerHTML = '<p class="res-aviso">' + t('mc2.short', { date: fmtDate(REF) }) + '</p>';
      if (charts['ch-mc2']) { charts['ch-mc2'].destroy(); delete charts['ch-mc2']; }
      return;
    }
    const totals = simulateItemsInWeeks(samples, Math.min(nWeeks, MAX_WEEKS));
    const n50 = atLeast(totals, 50), n85 = atLeast(totals, 85), n95 = atLeast(totals, 95);
    const tile2 = (p, n) => resultTile(t('mc.conf', { p }), t('mc2.atleast', { n: fmtNum(n) }), '', p === 85);
    res2.innerHTML = tile2(50, n50) + tile2(85, n85) + tile2(95, n95) +
      '<p class="res-frase">' + t('mc2.phrase', { n: fmtNum(n85), date: fmtDate(target), w: nWeeks }) + '</p>';

    const lo2 = totals[0], hi2 = totals[totals.length - 1];
    const binW = Math.max(1, Math.ceil((hi2 - lo2 + 1) / 28));
    const nBins = Math.ceil((hi2 - lo2 + 1) / binW);
    const labels2 = [], values2 = new Array(nBins).fill(0);
    for (let b = 0; b < nBins; b++) {
      const from = lo2 + b * binW;
      labels2.push(binW === 1 ? String(from) : from + '–' + (from + binW - 1));
    }
    const binOf = (v) => Math.floor((v - lo2) / binW);
    totals.forEach((v) => { values2[binOf(v)] += 100 / RUNS; });
    histogramChart('ch-mc2', labels2, values2, (i) => i >= binOf(n85),
      [{ axis: 'x', value: binOf(n85), color: INK, dash: [5, 4], label: '85% · ≥ ' + fmtNum(n85), row: 0 }],
      t('mc2.axis'));
  }

  function drawKpis(m) {
    const avg = m.throughput.reduce((a, b) => a + b, 0) / N_WEEKS;
    const tile = (label, value, note, alert) => '<div class="kpi' + (alert ? ' alerta' : '') + '"><p class="kpi-rotulo">' +
      label + '</p><p class="kpi-valor">' + value + '</p><p class="kpi-nota">' + note + '</p></div>';
    document.getElementById('kpis').innerHTML =
      tile(t('kpi.tp'), fmtNum(avg, 1) + ' <small>' + t('kpi.tp.unit') + '</small>', t('kpi.tp.note', { n: N_WEEKS })) +
      tile(t('kpi.ct'), m.p85 + ' <small>' + t('unit.days') + '</small>', t('kpi.ct.note')) +
      tile(t('kpi.wip'), m.wip.length + ' <small>' + plural(m.wip.length, 'item') + '</small>', t('kpi.wip.note')) +
      tile(t('kpi.aged'), (m.aged ? '⚠ ' : '') + m.aged + ' <small>' + plural(m.aged, 'item') + '</small>', t('kpi.aged.note'), m.aged > 0);
  }

  // =====================================================================
  // 6) CONTROLES
  // =====================================================================
  function renderStaticTexts() {
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'pt-BR';
    document.title = t('title') + ' — ' + t('kicker');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    document.getElementById('btn-lang').textContent = t('lang.btn');
    document.getElementById('nota-dados').textContent = t('data.note', { date: fmtDate(REF) });
    document.querySelectorAll('#mc-hist option').forEach((o) => {
      const n = Math.min(Number(o.value), N_WEEKS);
      o.textContent = Number(o.value) >= N_WEEKS ? t('mc.hist.all', { n }) : t('mc.hist.opt', { n });
    });
    const seg = document.getElementById('filtro-time');
    seg.innerHTML = '';
    [['all', t('filter.all')]].concat(TEAMS.map((n) => [n, t('team.' + n)])).forEach(([value, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.setAttribute('aria-pressed', String(state.team === value));
      b.addEventListener('click', () => { state.team = value; render(); });
      seg.appendChild(b);
    });
  }

  function render() {
    renderStaticTexts();
    const m = compute();
    document.getElementById('ct-decide').textContent = t('ct.decide', { d: m.p85 });
    drawKpis(m);
    drawThroughput(m);
    drawCycle(m);
    drawAging(m);
    drawTypes(m);
    drawMonteCarlo(m);
  }

  document.getElementById('btn-lang').addEventListener('click', () => {
    state.lang = state.lang === 'pt' ? 'en' : 'pt';
    try { localStorage.setItem('lang', state.lang); } catch (e) { /* ok */ }
    render();
  });
  const inputX = document.getElementById('mc-x');
  inputX.addEventListener('input', () => {
    const v = Math.round(Number(inputX.value));
    if (v >= 1 && v <= 2000) { state.x = v; render(); }
  });
  const inputY = document.getElementById('mc-y');
  inputY.value = state.y;
  inputY.min = toISO(REF + 7);
  inputY.addEventListener('change', () => { if (inputY.value) { state.y = inputY.value; render(); } });
  document.getElementById('mc-hist').addEventListener('change', (e) => { state.hist = Number(e.target.value); render(); });

  render();

  // Exposto só para conferência/testes no console do navegador.
  window.__dash = { compute, simulateDaysToFinish, simulateItemsInWeeks, percentile, atLeast, state, REF, WEEKS };
})();
