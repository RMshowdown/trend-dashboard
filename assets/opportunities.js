const $ = id => document.getElementById(id);
const controls = {
  kind: $("kind"), genre: $("genre"), theme: $("theme"), dev: $("dev"),
  q: $("search"), games: $("games"), inst: $("inst")
};
const tbody = $("apps");
const status = $("status");

let data = null;
let defaults = {};
let lastRows = [];

// Maximum points per part of the score (must match scripts/fetch_opportunities.py)
const PARTS = {
  improve: [["pain", "Unhappy users", 35], ["demand", "Demand", 25], ["money", "Earning", 15], ["dev", "Small developer", 15], ["gap", "No Thai listing", 10]],
  import: [["demand", "Demand abroad", 40], ["gap", "Gap in Thailand", 20], ["fresh", "New", 15], ["dev", "Small developer", 15], ["money", "Earning", 10]]
};

function devLabel(a) {
  if (a.dev_apps == null) return null;
  if (a.dev_apps <= 2) return "Solo developer";
  if (a.dev_apps <= 5) return `Small developer (${a.dev_apps} apps)`;
  return null;
}

// Short, readable reasons built from the score parts
function reasons(a) {
  const out = [];
  const p = a.parts || {};
  if (a.kind === "improve") {
    if (p.pain >= 20) out.push(["hot", `Rated ★ ${a.rating.toFixed(1)}`]);
    else if (p.pain > 0) out.push(["", `Rated ★ ${a.rating.toFixed(1)}`]);
    if (a.best_rank) out.push(["", a.best_rank]);
    if (data.tracked_days >= 7 && a.chart_days >= 7) out.push(["", `${a.chart_days} days on chart`]);
    if (p.money > 0) out.push(["money", a.ranks && a.ranks.topgrossing ? "Top Grossing" : "Paid app"]);
    if (p.gap > 0) out.push(["warn", "No Thai store listing"]);
  } else {
    out.push(["hot", `Charting in ${a.markets} countries`]);
    if (!a.available_home) out.push(["warn", "Not in Thai store"]);
    else if (!a.thai) out.push(["warn", "No Thai store listing"]);
    if (p.fresh >= 10) out.push(["", `${a.days_since_release} days old`]);
    if (p.money > 0) out.push(["money", "Earning abroad"]);
  }
  const dev = devLabel(a);
  if (dev) out.push(["", dev]);
  return out;
}

function reviewsBlock(a) {
  const r = a.reviews;
  if (!r) return `<p class="muted small">No low-star reviews collected for this app (only the top-scoring apps are checked, and the app must be findable on Google Play).</p>`;
  const where = r.url
    ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${esc(r.source)}</a>`
    : esc(r.source);
  const pains = (r.pains || []).map(p => `<span class="badge warn">${esc(p.tag)} <b>${p.count}</b></span>`).join(" ");
  const items = (r.items || []).map(i => `
    <li>
      <span class="stars" title="${i.rating} of 5">${"★".repeat(i.rating)}<span class="muted">${"★".repeat(5 - i.rating)}</span></span>
      <span class="muted small nowrap">${esc(i.date)}</span>
      <span>${i.title ? `<b>${esc(i.title)}</b> ` : ""}${esc(i.text)}</span>
    </li>`).join("");
  return `
    <h3>What users complain about</h3>
    <p class="muted small">${r.low} of the ${r.sample} most recent reviews on ${where} (${esc((r.country || "").toUpperCase())}) are 1–3 stars.
      ${pains ? "Topics mentioned:" : ""}</p>
    ${pains ? `<p>${pains}</p>` : ""}
    ${items ? `<ul class="reviews">${items}</ul>` : `<p class="muted small">No written low-star reviews in the sample.</p>`}`;
}

function detailsRow(a) {
  const parts = PARTS[a.kind].map(([key, label, max]) => {
    const v = (a.parts || {})[key] || 0;
    return `<div class="part" title="${esc(label)}: ${v} of ${max}">
      <span>${esc(label)}</span>
      <div class="score-bar"><span style="width:${Math.round(v / max * 100)}%"></span></div>
      <span class="muted">${Math.round(v)}/${max}</span>
    </div>`;
  }).join("");
  const facts = [
    a.release_date ? `Released ${fmtDate(a.release_date, true)}` : null,
    `Price: ${a.price || "-"}`,
    a.dev_apps != null ? `Developer has ${a.dev_apps}${a.dev_apps >= 200 ? "+" : ""} app${a.dev_apps === 1 ? "" : "s"} in the Thai store` : null,
    a.kind === "improve" ? `${a.chart_days} of the last ${data.tracked_days} tracked days on a chart` : null,
    a.countries ? `Charting in ${a.countries.map(c => c.toUpperCase()).join(", ")}` : null
  ].filter(Boolean).map(esc).join(" · ");
  return `
    <tr class="details" hidden>
      <td colspan="7">
        <p class="desc">${esc(a.description) || '<span class="muted">No description</span>'}</p>
        <p class="muted small">${facts}</p>
        <div class="parts">${parts}</div>
        ${reviewsBlock(a)}
      </td>
    </tr>`;
}

function render() {
  const kind = controls.kind.value;
  const genre = controls.genre.value;
  const theme = controls.theme.value;
  const maxDev = controls.dev.value === "any" ? null : Number(controls.dev.value);
  const q = controls.q.value.trim().toLowerCase();

  const rows = data.apps.filter(a => {
    if (kind !== "all" && a.kind !== kind) return false;
    if (genre !== "all" && a.genre !== genre) return false;
    if (theme !== "all" && !(a.themes || []).includes(theme)) return false;
    if (maxDev != null && (a.dev_apps == null || a.dev_apps > maxDev)) return false;
    if (controls.games.checked && a.genre === "Games") return false;
    if (controls.inst.checked && a.institutional) return false;
    if (q && !`${a.name} ${a.developer} ${a.description}`.toLowerCase().includes(q)) return false;
    return true;
  });
  lastRows = rows;

  tbody.innerHTML = rows.map((a, i) => {
    const why = reasons(a).map(([cls, text]) => `<span class="badge ${cls}">${esc(text)}</span>`).join(" ");
    const kindBadge = a.kind === "improve"
      ? `<span class="badge kind">Do it better</span>`
      : `<span class="badge kind soon">Bring to Thailand</span>`;
    const dev = a.dev_apps == null ? `<span class="muted">-</span>` : `${a.dev_apps}${a.dev_apps >= 200 ? "+" : ""} <small>app${a.dev_apps === 1 ? "" : "s"}</small>`;
    const hasReviews = a.reviews && a.reviews.items && a.reviews.items.length;
    return `
      <tr>
        <td class="num muted cell-rank">${i + 1}</td>
        <td class="cell-app">${appCell(a, { details: true })}</td>
        <td data-label="Category">${esc(a.genre)}<div>${themeBadges(a.themes)}</div></td>
        <td class="cell-charts" data-label="Why">${kindBadge} ${why}${hasReviews ? ` <span class="badge" title="Open Details to read them">💬 reviews</span>` : ""}</td>
        <td class="num" data-label="Rating">★ ${a.rating.toFixed(1)}<small>${fmtNumber(a.rating_count)}</small></td>
        <td class="num" data-label="Developer">${dev}</td>
        <td class="num" data-label="Score">
          <div class="score">${a.score.toFixed(0)}
            <div class="score-bar"><span style="width:${Math.round(a.score)}%"></span></div>
          </div>
        </td>
      </tr>${detailsRow(a)}`;
  }).join("") || `<tr><td colspan="7" class="empty">No apps match these filters</td></tr>`;

  const early = data.tracked_days < 7
    ? ` · only ${data.tracked_days} day${data.tracked_days === 1 ? "" : "s"} of chart history so far, "days on chart" becomes meaningful after a week`
    : "";
  setStatus(status, data.updated_at, `Showing ${rows.length} of ${data.apps.length} apps${early}`);
  writeParams(controls, defaults);
}

const csvColumns = [
  { label: "Name", value: a => a.name },
  { label: "Developer", value: a => a.developer },
  { label: "Type", value: a => a.kind === "improve" ? "Do it better" : "Bring to Thailand" },
  { label: "Category", value: a => a.genre },
  { label: "Themes", value: a => (a.themes || []).join("; ") },
  { label: "Score", value: a => a.score },
  { label: "Why", value: a => reasons(a).map(r => r[1]).join("; ") },
  { label: "Rating", value: a => a.rating },
  { label: "Ratings", value: a => a.rating_count },
  { label: "Developer apps", value: a => a.dev_apps },
  { label: "Days on chart", value: a => a.chart_days },
  { label: "Countries", value: a => (a.countries || []).join(" ") },
  { label: "Complaints", value: a => ((a.reviews || {}).pains || []).map(p => `${p.tag} (${p.count})`).join("; ") },
  { label: "Release date", value: a => (a.release_date || "").slice(0, 10) },
  { label: "Description", value: a => a.description },
  { label: "URL", value: a => a.url }
];

loadJson("data/opportunities.json")
  .then(json => {
    data = json;
    fillSelect(controls.genre, [...new Set(data.apps.map(a => a.genre))].sort());
    fillSelect(controls.theme, [...new Set(data.apps.flatMap(a => a.themes || []))].sort());

    $("genres").innerHTML = (data.genres || []).map(g => `
      <tr>
        <td>${esc(g.name)}</td>
        <td class="num">${g.apps}</td>
        <td class="num">★ ${g.avg_rating.toFixed(2)}</td>
        <td class="num">${Math.round(g.low_share * 100)}%</td>
        <td class="num">${Math.round(g.new_share * 100)}%</td>
      </tr>`).join("");

    defaults = currentValues(controls);
    readParams(controls);
    for (const el of [controls.kind, controls.genre, controls.theme, controls.dev, controls.games, controls.inst]) {
      el.addEventListener("change", render);
    }
    controls.q.addEventListener("input", render);
    $("csv").addEventListener("click", () =>
      downloadCsv(`opportunities-${data.updated_at.slice(0, 10)}.csv`, csvColumns, lastRows));
    enableDetails(tbody);
    render();
  })
  .catch(err => showError(status, err));
