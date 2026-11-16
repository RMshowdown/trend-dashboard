const $ = id => document.getElementById(id);
const controls = {
  chart: $("chart"), show: $("show"), markets: $("markets"),
  age: $("age"), genre: $("genre"), q: $("search")
};
const tbody = $("apps");
const status = $("status");

let data = null;
let defaults = {};
let lastRows = [];

const rankOf = (a, chart, code) => ((a.ranks || {})[chart] || {})[code];

// Countries (outside home) where the app is on the selected chart
function foreignCount(a, chart) {
  return Object.keys((a.ranks || {})[chart] || {}).filter(c => c !== data.home).length;
}

function foreignPoints(a, chart) {
  return Object.entries((a.ranks || {})[chart] || {})
    .filter(([c]) => c !== data.home)
    .reduce((sum, [, r]) => sum + (101 - r), 0);
}

function rankCell(rank) {
  if (rank == null) return `<span class="muted">-</span>`;
  const cls = rank <= 10 ? "rank top" : rank <= 30 ? "rank mid" : "rank";
  return `<span class="${cls}">${rank}</span>`;
}

function renderHead() {
  const cols = data.countries.map(c =>
    `<th class="num${c.code === data.home ? " home" : ""}" title="${esc(c.name)}">${esc(c.code.toUpperCase())}</th>`
  ).join("");
  $("head").innerHTML = `
    <tr>
      <th class="num">#</th>
      <th>App</th>
      <th>Category</th>
      <th class="num">Countries</th>
      ${cols}
      <th>In TH store</th>
    </tr>`;
}

function render() {
  const chart = controls.chart.value;
  const show = controls.show.value;
  const minMarkets = Number(controls.markets.value);
  const maxAge = controls.age.value === "any" ? Infinity : Number(controls.age.value);
  const genre = controls.genre.value;
  const q = controls.q.value.trim().toLowerCase();
  const home = data.home;

  const rows = data.apps.filter(a => {
    const foreign = foreignCount(a, chart);
    const homeRank = rankOf(a, chart, home);
    if (foreign < minMarkets && show !== "all") return false;
    if (show === "gap" && homeRank != null) return false;
    if (show === "missing" && a.available_home) return false;
    if (show === "everywhere" && homeRank == null) return false;
    if (show === "all" && homeRank == null && foreign === 0) return false;
    if (maxAge !== Infinity && (a.days_since_release == null || a.days_since_release > maxAge)) return false;
    if (genre !== "all" && a.genre !== genre) return false;
    if (q && !`${a.name} ${a.developer} ${a.description}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => foreignPoints(b, chart) - foreignPoints(a, chart));
  lastRows = rows;

  const colspan = 5 + data.countries.length;
  tbody.innerHTML = rows.map((a, i) => {
    const cells = data.countries.map(c =>
      `<td class="num${c.code === home ? " home" : ""}" data-label="${esc(c.code.toUpperCase())}">${rankCell(rankOf(a, chart, c.code))}</td>`
    ).join("");
    const avail = a.available_home
      ? `<span class="up">Yes</span>`
      : `<span class="badge warn">Not available</span>`;
    const age = a.days_since_release != null ? `<small>Released ${esc(fmtDate(a.release_date, true))}</small>` : "";
    return `
      <tr>
        <td class="num muted cell-rank">${i + 1}</td>
        <td class="cell-app">${appCell(a, { details: true })}</td>
        <td data-label="Category">${esc(a.genre)}</td>
        <td class="num" data-label="Countries"><b>${foreignCount(a, chart)}</b></td>
        ${cells}
        <td data-label="In TH store">${avail}</td>
      </tr>
      <tr class="details" hidden>
        <td colspan="${colspan}">
          <p class="desc">${esc(a.description) || '<span class="muted">No description</span>'}</p>
          <p class="muted small">${age} ${a.rating_count != null ? `${fmtNumber(a.rating_count)} reviews` : ""}</p>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="${colspan}" class="empty">No apps match these filters</td></tr>`;

  setStatus(status, data.updated_at, `Showing ${rows.length} apps`);
  writeParams(controls, defaults);
}

loadJson("data/global.json")
  .then(json => {
    data = json;
    for (const c of data.charts) {
      const opt = document.createElement("option");
      opt.value = c.key;
      opt.textContent = c.name;
      controls.chart.appendChild(opt);
    }
    for (const g of [...new Set(data.apps.map(a => a.genre))].sort()) {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      controls.genre.appendChild(opt);
    }
    renderHead();
    defaults = currentValues(controls);
    readParams(controls);
    for (const el of [controls.chart, controls.show, controls.markets, controls.age, controls.genre]) {
      el.addEventListener("change", render);
    }
    controls.q.addEventListener("input", render);
    $("csv").addEventListener("click", () => {
      const chart = controls.chart.value;
      const columns = [
        { label: "Name", value: a => a.name },
        { label: "Developer", value: a => a.developer },
        { label: "Category", value: a => a.genre },
        { label: "Countries", value: a => foreignCount(a, chart) },
        ...data.countries.map(c => ({ label: c.code.toUpperCase(), value: a => rankOf(a, chart, c.code) })),
        { label: "Available in TH", value: a => a.available_home ? "yes" : "no" },
        { label: "Release date", value: a => (a.release_date || "").slice(0, 10) },
        { label: "Description", value: a => a.description },
        { label: "URL", value: a => a.url }
      ];
      downloadCsv(`global-${chart}-${data.updated_at.slice(0, 10)}.csv`, columns, lastRows);
    });
    enableDetails(tbody);
    render();
  })
  .catch(err => showError(status, err));
