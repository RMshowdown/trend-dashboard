const $ = id => document.getElementById(id);
const controls = { chart: $("chart"), cat: $("cat"), show: $("show"), sort: $("sort"), q: $("search") };
const tbody = $("apps");
const status = $("status");

let data = null;
let defaults = {};
let lastRows = [];
const historyCache = {};

function loadHistory(chart, cat) {
  const key = `${chart}-${cat}`;
  if (!historyCache[key]) {
    historyCache[key] = loadJson(`data/play_history/${key}.json`).catch(() => ({ days: {} }));
  }
  return historyCache[key];
}

function changeOf(row, compared) {
  if (!compared) return null;
  if (row.prev_rank == null) return "new";
  return row.prev_rank - row.rank;
}

function changeCell(change) {
  if (change === null) return `<span class="muted">-</span>`;
  if (change === "new") return `<span class="badge hot">NEW</span>`;
  if (change > 0) return `<span class="up">▲ ${change}</span>`;
  if (change < 0) return `<span class="down">▼ ${-change}</span>`;
  return `<span class="muted">–</span>`;
}

const ageDays = app => app.released ? Math.floor((Date.now() - new Date(app.released)) / 864e5) : null;

function installsCell(app) {
  if (app.installs == null) return `<span class="muted">-</span>`;
  let growth = "";
  if (app.installs_per_day != null) {
    const cls = app.installs_per_day > 0 ? "up" : "muted";
    const week = app.installs_7d != null ? ` title="Last 7 days: +${fmtNumber(app.installs_7d)}"` : "";
    growth = `<small class="${cls}"${week}>+${fmtCompact(app.installs_per_day)}/day</small>`;
  }
  const dates = Object.keys(app.history || {}).sort();
  const spark = dates.length > 2
    ? sparkline(dates.map(d => app.history[d]), { title: `Installs over ${dates.length} days` }) : "";
  return `<div class="stack"><span title="${fmtNumber(app.installs)} installs">${fmtCompact(app.installs)}</span>${growth}${spark}</div>`;
}

function ratingCell(app) {
  if (app.rating == null) return `<span class="muted">-</span>`;
  const low = app.low_share != null
    ? `<small class="${app.low_share >= 0.25 ? "down" : ""}" title="Share of 1–2 star ratings">${Math.round(app.low_share * 100)}% low</small>` : "";
  return `★ ${app.rating.toFixed(1)}${low}`;
}

function releasedCell(app) {
  const age = ageDays(app);
  if (age == null) return `<span class="muted">-</span>`;
  const text = age <= 90 ? `<span class="badge hot">${age}d old</span>` : esc(fmtDate(app.released, true));
  return `<span title="Released ${esc(fmtDate(app.released, true))}">${text}</span>`;
}

async function render() {
  const chart = controls.chart.value;
  const cat = controls.cat.value;
  const show = controls.show.value;
  const sort = controls.sort.value;
  const q = controls.q.value.trim().toLowerCase();
  const all = ((data.snapshots[chart] || {})[cat] || [])
    .map(row => ({ ...row, app: { id: row.id, ...(data.apps[row.id] || { name: row.id, developer: "" }) } }));
  const compared = ((data.compared || {})[chart] || {})[cat];

  const rows = all
    .map(r => ({ ...r, change: changeOf(r, compared) }))
    .filter(({ app }) => !q || `${app.name} ${app.developer} ${app.summary || ""}`.toLowerCase().includes(q))
    .filter(({ app, change }) => {
      if (show === "new90") return ageDays(app) != null && ageDays(app) <= 90;
      if (show === "noios") return !app.on_ios;
      if (show === "entry") return change === "new";
      if (show === "up") return typeof change === "number" && change > 0;
      if (show === "down") return typeof change === "number" && change < 0;
      return true;
    });

  const by = {
    growth: (a, b) => (b.app.installs_per_day ?? -1) - (a.app.installs_per_day ?? -1),
    installs: (a, b) => (b.app.installs ?? -1) - (a.app.installs ?? -1),
    newest: (a, b) => (b.app.released || "").localeCompare(a.app.released || ""),
    unhappy: (a, b) => (b.app.low_share ?? -1) - (a.app.low_share ?? -1)
  };
  if (by[sort]) rows.sort(by[sort]);
  else if (show === "up") rows.sort((a, b) => b.change - a.change);
  else if (show === "down") rows.sort((a, b) => a.change - b.change);
  lastRows = rows;

  const history = await loadHistory(chart, cat);
  const dates = Object.keys(history.days || {}).sort();
  const positions = dates.map(d => {
    const map = {};
    (history.days[d] || []).forEach((id, i) => { if (id) map[id] = i + 1; });
    return map;
  });
  $("trend-head").textContent = dates.length > 1 ? `Last ${dates.length} days` : "Rank trend";

  tbody.innerHTML = rows.map(({ app, rank, change }) => {
    const series = positions.map(p => p[app.id] ?? null);
    const facts = [
      app.installs_text ? `${app.installs_text} installs` : null,
      app.ratings != null ? `${fmtNumber(app.ratings)} ratings` : null,
      app.updated ? `Updated ${fmtDate(app.updated, true)}` : null,
      app.free === false ? `Paid${app.price ? ` (${app.price})` : ""}` : "Free",
      app.iap ? "In-app purchases" : null,
      app.ads ? "Contains ads" : null,
      app.on_ios ? "Also on the App Store charts" : "Not on the App Store charts"
    ].filter(Boolean).map(esc).join(" · ");
    return `
      <tr>
        <td class="num cell-rank"><b>${rank}</b></td>
        <td class="num" data-label="Change">${changeCell(change)}</td>
        <td class="cell-app">${appCell(app, { details: true, store: "play" })}</td>
        <td data-label="Category">${esc(app.genre || "-")}<div>${themeBadges(app.themes)}</div></td>
        <td class="num" data-label="Installs">${installsCell(app)}</td>
        <td class="num" data-label="Rating">${ratingCell(app)}</td>
        <td class="num" data-label="Released">${releasedCell(app)}</td>
        <td class="num" data-label="Trend">${sparkline(series, { invert: true, title: `Rank over ${dates.length} days` })}</td>
      </tr>
      <tr class="details" hidden>
        <td colspan="8">
          <p class="desc">${esc(app.summary) || '<span class="muted">No description</span>'}</p>
          <p class="muted small">${facts}</p>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty">No apps match these filters</td></tr>`;

  const vs = compared ? `vs ${fmtDate(compared)}` : "no earlier day to compare yet";
  setStatus(status, data.updated_at, `Showing ${rows.length} of ${all.length} apps · ${vs}`);
  writeParams(controls, defaults);
}

const csvColumns = [
  { label: "Rank", value: r => r.rank },
  { label: "Name", value: r => r.app.name },
  { label: "Developer", value: r => r.app.developer },
  { label: "Category", value: r => r.app.genre },
  { label: "Themes", value: r => (r.app.themes || []).join("; ") },
  { label: "Installs", value: r => r.app.installs },
  { label: "Installs per day", value: r => r.app.installs_per_day },
  { label: "Rating", value: r => r.app.rating },
  { label: "Low rating share", value: r => r.app.low_share },
  { label: "Released", value: r => r.app.released },
  { label: "On App Store charts", value: r => r.app.on_ios ? "yes" : "no" },
  { label: "Summary", value: r => r.app.summary },
  { label: "URL", value: r => r.app.url }
];

loadJson("data/play.json")
  .then(json => {
    data = json;
    fillSelect(controls.chart, data.charts);
    fillSelect(controls.cat, data.categories);
    defaults = currentValues(controls);
    readParams(controls);
    for (const el of [controls.chart, controls.cat, controls.show, controls.sort]) el.addEventListener("change", render);
    controls.q.addEventListener("input", render);
    $("csv").addEventListener("click", () =>
      downloadCsv(`google-play-${controls.chart.value}-${data.updated_at.slice(0, 10)}.csv`, csvColumns, lastRows));
    enableDetails(tbody);
    return render();
  })
  .catch(err => showError(status, err));
