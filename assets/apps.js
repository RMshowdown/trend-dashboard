const $ = id => document.getElementById(id);
const controls = { chart: $("chart"), genre: $("genre"), move: $("move"), q: $("search") };
const tbody = $("apps");
const status = $("status");

let data = null;
let defaults = {};
const historyCache = {};

// Rank history lives in one small file per chart + category, loaded on demand
function loadHistory(chart, genre) {
  const key = `${chart}-${genre}`;
  if (!historyCache[key]) {
    historyCache[key] = loadJson(`data/rank_history/${key}.json`).catch(() => ({ days: {} }));
  }
  return historyCache[key];
}

function changeOf(app, compared) {
  if (!compared) return null;               // nothing to compare against yet
  if (app.prev_rank == null) return "new";  // was not on the chart last time
  return app.prev_rank - app.rank;          // positive = climbed
}

function changeCell(change) {
  if (change === null) return `<span class="muted">-</span>`;
  if (change === "new") return `<span class="badge hot">NEW</span>`;
  if (change > 0) return `<span class="up">▲ ${change}</span>`;
  if (change < 0) return `<span class="down">▼ ${-change}</span>`;
  return `<span class="muted">–</span>`;
}

async function render() {
  const chart = controls.chart.value;
  const genre = controls.genre.value;
  const q = controls.q.value.trim().toLowerCase();
  const move = controls.move.value;
  const all = (data.snapshots[chart] || {})[genre] || [];
  const compared = ((data.compared || {})[chart] || {})[genre];

  const rows = all
    .map(app => ({ app, change: changeOf(app, compared) }))
    .filter(({ app }) => !q || `${app.name} ${app.developer}`.toLowerCase().includes(q))
    .filter(({ change }) =>
      move === "all" ||
      (move === "new" && change === "new") ||
      (move === "up" && typeof change === "number" && change > 0) ||
      (move === "down" && typeof change === "number" && change < 0));

  if (move === "up") rows.sort((a, b) => b.change - a.change);
  if (move === "down") rows.sort((a, b) => a.change - b.change);

  const history = await loadHistory(chart, genre);
  const dates = Object.keys(history.days || {}).sort();
  const positions = dates.map(d => {
    const map = {};
    (history.days[d] || []).forEach((id, i) => { if (id) map[id] = i + 1; });
    return map;
  });
  $("trend-head").textContent = dates.length > 1 ? `Last ${dates.length} days` : "Rank trend";

  tbody.innerHTML = rows.map(({ app, change }) => {
    const series = positions.map(p => p[app.id] ?? null);
    const spark = sparkline(series, { invert: true, title: `Rank over ${dates.length} days` });
    const stayed = series.filter(v => v != null).length;
    return `
      <tr>
        <td class="num cell-rank"><b>${app.rank}</b></td>
        <td class="num" data-label="Change">${changeCell(change)}</td>
        <td class="cell-app">${appCell(app)}</td>
        <td data-label="Category">${esc(app.genre)}</td>
        <td class="num" data-label="Days on chart">${dates.length ? `${stayed}<small>of ${dates.length}</small>` : "-"}</td>
        <td class="num" data-label="Trend">${spark}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No apps match these filters</td></tr>`;

  const vs = compared ? `vs ${fmtDate(compared)}` : "no earlier day to compare yet";
  setStatus(status, data.updated_at, `Showing ${rows.length} of ${all.length} apps · ${vs}`);
  writeParams(controls, defaults);
}

function fill(select, items) {
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.key;
    opt.textContent = item.name;
    select.appendChild(opt);
  }
}

loadJson("data/apps.json")
  .then(json => {
    data = json;
    fill(controls.chart, data.charts);
    fill(controls.genre, data.genres);
    defaults = currentValues(controls);
    readParams(controls);
    for (const el of [controls.chart, controls.genre, controls.move]) el.addEventListener("change", render);
    controls.q.addEventListener("input", render);
    return render();
  })
  .catch(err => showError(status, err));
