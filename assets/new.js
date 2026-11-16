const $ = id => document.getElementById(id);
const controls = {
  status: $("state"), genre: $("genre"), theme: $("theme"), days: $("days"),
  sort: $("sort"), q: $("search"), quiet: $("quiet"), small: $("small")
};
const tbody = $("apps");
const status = $("status");
const pulse = $("pulse");

let apps = [];
let updatedAt = "";
let genreNames = {};
let defaults = {};
let lastRows = [];
let devApps = {};  // developer id -> number of apps in the store (data/developers.json)

const devCount = a => (devApps[a.artist_id] || {}).apps ?? null;

const CHART_SHORT = { topfree: "Free", toppaid: "Paid", topgrossing: "Grossing" };

// Best position per chart. A genre rank counts 60% of an overall rank,
// so #2 in Games beats #80 overall, but #10 overall beats #10 in Games.
function chartBadges(a) {
  const out = [];
  for (const [chart, byGenre] of Object.entries(a.ranks || {})) {
    let best = null;
    for (const [g, rank] of Object.entries(byGenre)) {
      const points = (101 - rank) * (g === "all" ? 1 : 0.6);
      if (!best || points > best.points) {
        best = { chart, rank, points, overall: g === "all", label: g === "all" ? "Overall" : (genreNames[g] || g) };
      }
    }
    out.push(best);
  }
  return out.sort((x, y) => y.points - x.points);
}

const chartPoints = a => Math.max(0, ...chartBadges(a).map(b => b.points));

const sorters = {
  score: (a, b) => b.score - a.score,
  growth: (a, b) => b.rating_per_day - a.rating_per_day,
  chart: (a, b) => chartPoints(b) - chartPoints(a),
  reviews: (a, b) => b.rating_count - a.rating_count,
  newest: (a, b) => b.release_date.localeCompare(a.release_date),
  soonest: (a, b) => (b.upcoming - a.upcoming) || a.release_date.localeCompare(b.release_date)
};

function ageCell(a) {
  if (a.upcoming) {
    const days = Math.max(1, Math.ceil((new Date(a.release_date) - Date.now()) / 864e5));
    return `<span class="badge soon" title="Expected ${esc(fmtDate(a.release_date, true))}">in ${days}d</span>`;
  }
  return `<span title="Released ${esc(fmtDate(a.release_date, true))}">${a.days_since_release}d</span>`;
}

function growthCell(a) {
  if (a.upcoming) return `<span class="muted">-</span>`;
  if (a.rating_delta == null) {
    // No previous day to compare yet: show the average since release instead
    return a.rating_per_day > 0
      ? `<span class="muted" title="Average per day since release">~${fmtNumber(a.rating_per_day)}/day</span>`
      : `<span class="muted">-</span>`;
  }
  const cls = a.rating_delta > 0 ? "up" : a.rating_delta < 0 ? "down" : "muted";
  const sign = a.rating_delta > 0 ? "+" : "";
  const gap = a.rating_delta_days > 1 ? ` <small>in ${a.rating_delta_days} days</small>` : "";
  const week = a.rating_delta_7d != null
    ? ` title="Last 7 days: ${a.rating_delta_7d >= 0 ? "+" : ""}${fmtNumber(a.rating_delta_7d)}"` : "";
  return `<span class="${cls}"${week}>${sign}${fmtNumber(a.rating_delta)}</span>${gap}`;
}

function reviewsCell(a) {
  const dates = Object.keys(a.history || {}).sort();
  const spark = dates.length > 1
    ? sparkline(dates.map(d => a.history[d]), { title: `Reviews over ${dates.length} days` })
    : "";
  const rating = a.rating_count > 0 ? `<small>★ ${a.rating.toFixed(1)}</small>` : "";
  return `<div class="stack">${fmtNumber(a.rating_count)}${rating}${spark}</div>`;
}

function chartsCell(a) {
  const badges = chartBadges(a);
  if (!badges.length) return `<span class="muted">-</span>`;
  return badges.map(b =>
    `<span class="badge${b.overall ? " hot" : ""}">${CHART_SHORT[b.chart] || b.chart} #${b.rank} ${esc(b.label)}</span>`
  ).join(" ");
}

function detailsRow(a) {
  const shots = (a.screenshots || []).map(src =>
    `<a href="${safeUrl(src)}" target="_blank" rel="noopener"><img src="${safeUrl(src)}" alt="" loading="lazy"></a>`
  ).join("");
  const facts = [
    a.upcoming ? `Expected ${fmtDate(a.release_date, true)}` : `Released ${fmtDate(a.release_date, true)}`,
    `Price: ${a.price || "-"}`,
    `First tracked ${fmtDate(a.first_seen, true)}`,
    a.in_new_feed ? "In Apple's new apps list" : null,
    a.chart_days ? `${a.chart_days} day${a.chart_days === 1 ? "" : "s"} on a chart` : null,
    devCount(a) != null ? `Developer has ${devCount(a)} app${devCount(a) === 1 ? "" : "s"}` : null
  ].filter(Boolean).map(esc).join(" · ");
  return `
    <tr class="details" hidden>
      <td colspan="8">
        <p class="desc">${esc(a.description) || '<span class="muted">No description</span>'}</p>
        <p class="muted small">${facts}</p>
        ${shots ? `<div class="shots">${shots}</div>` : ""}
      </td>
    </tr>`;
}

// Everything except the category filter (the pulse chips use this to count per category)
function baseFilter() {
  const state = controls.status.value;
  const maxDays = Number(controls.days.value);
  const q = controls.q.value.trim().toLowerCase();
  const showQuiet = controls.quiet.checked;
  const theme = controls.theme.value;
  const smallOnly = controls.small.checked;
  return apps.filter(a => {
    if (theme !== "all" && !(a.themes || []).includes(theme)) return false;
    // Developers we have not counted yet are left out, so the filter never shows a big studio by mistake
    if (smallOnly && !(devCount(a) != null && devCount(a) <= 5)) return false;
    if (state === "released" && a.upcoming) return false;
    if (state === "upcoming" && !a.upcoming) return false;
    if (!a.upcoming && a.days_since_release > maxDays) return false;
    if (!a.upcoming && !showQuiet && a.rating_count === 0 && !chartBadges(a).length) return false;
    if (q && !`${a.name} ${a.developer} ${a.description}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderPulse(base) {
  const counts = {};
  for (const a of base) {
    if (a.upcoming || chartBadges(a).length) counts[a.genre] = (counts[a.genre] || 0) + 1;
  }
  const top = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 10);
  const current = controls.genre.value;
  pulse.innerHTML = top.length
    ? `<span class="muted small">Hot categories:</span> ` + top.map(([g, n]) =>
        `<button type="button" class="chip${g === current ? " active" : ""}" data-genre="${esc(g)}">${esc(g)} <b>${n}</b></button>`
      ).join("")
    : "";
}

function render() {
  const base = baseFilter();
  renderPulse(base);
  const genre = controls.genre.value;
  const rows = base
    .filter(a => genre === "all" || a.genre === genre)
    .sort((a, b) => sorters[controls.sort.value](a, b) || b.score - a.score);
  lastRows = rows;

  const maxScore = Math.max(1, ...apps.map(a => a.score));
  tbody.innerHTML = rows.map((a, i) => `
    <tr class="${a.upcoming ? "is-upcoming" : ""}">
      <td class="num muted cell-rank">${i + 1}</td>
      <td class="cell-app">${appCell(a, { details: true })}</td>
      <td data-label="Category">${esc(a.genre)}<div>${themeBadges(a.themes)}</div></td>
      <td class="num" data-label="Age">${ageCell(a)}</td>
      <td class="num" data-label="Reviews">${reviewsCell(a)}</td>
      <td class="num" data-label="Growth">${growthCell(a)}</td>
      <td class="cell-charts" data-label="Charts">${chartsCell(a)}</td>
      <td class="num" data-label="Score">
        ${a.upcoming ? `<span class="muted">-</span>` : `
        <div class="score">
          ${a.score.toFixed(0)}
          <div class="score-bar"><span style="width:${Math.round(a.score / maxScore * 100)}%"></span></div>
        </div>`}
      </td>
    </tr>${detailsRow(a)}`).join("")
    || `<tr><td colspan="8" class="empty">No apps match these filters</td></tr>`;

  const upcoming = rows.filter(a => a.upcoming).length;
  setStatus(status, updatedAt, `Showing ${rows.length} of ${apps.length} apps (${upcoming} upcoming)`);
  writeParams(controls, defaults);
}

const csvColumns = [
  { label: "Name", value: a => a.name },
  { label: "Developer", value: a => a.developer },
  { label: "Category", value: a => a.genre },
  { label: "Themes", value: a => (a.themes || []).join("; ") },
  { label: "Developer apps", value: a => devCount(a) },
  { label: "Status", value: a => a.upcoming ? "upcoming" : "released" },
  { label: "Release date", value: a => a.release_date.slice(0, 10) },
  { label: "Price", value: a => a.price },
  { label: "Rating", value: a => a.rating },
  { label: "Reviews", value: a => a.rating_count },
  { label: "Review growth", value: a => a.rating_delta },
  { label: "Charts", value: a => chartBadges(a).map(b => `${CHART_SHORT[b.chart]} #${b.rank} ${b.label}`).join("; ") },
  { label: "Score", value: a => a.score },
  { label: "Description", value: a => a.description },
  { label: "URL", value: a => a.url }
];

Promise.all([loadJson("data/new_apps.json"), loadJson("data/developers.json").catch(() => ({}))])
  .then(([data, devs]) => {
    apps = data.apps;
    devApps = devs.developers || {};
    fillSelect(controls.theme, [...new Set(apps.flatMap(a => a.themes || []))].sort());
    updatedAt = data.updated_at;
    for (const g of data.genres || []) genreNames[g.key] = g.name;

    for (const g of [...new Set(apps.map(a => a.genre))].sort()) {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      controls.genre.appendChild(opt);
    }

    defaults = currentValues(controls);
    readParams(controls);

    controls.status.addEventListener("change", () => {
      // Upcoming apps have no score yet, so sort them by release date instead
      if (controls.status.value === "upcoming" && controls.sort.value === "score") controls.sort.value = "soonest";
      if (controls.status.value !== "upcoming" && controls.sort.value === "soonest") controls.sort.value = "score";
      render();
    });
    for (const el of [controls.genre, controls.theme, controls.days, controls.sort, controls.quiet, controls.small]) {
      el.addEventListener("change", render);
    }
    controls.q.addEventListener("input", render);
    pulse.addEventListener("click", e => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      controls.genre.value = controls.genre.value === chip.dataset.genre ? "all" : chip.dataset.genre;
      render();
    });
    $("csv").addEventListener("click", () =>
      downloadCsv(`new-apps-${updatedAt.slice(0, 10)}.csv`, csvColumns, lastRows));
    enableDetails(tbody);
    render();
  })
  .catch(err => showError(status, err));
