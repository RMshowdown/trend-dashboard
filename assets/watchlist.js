const $ = id => document.getElementById(id);
const tbody = $("apps");
const status = $("status");
const search = $("search");

// What today's data says about each saved app: { id: [badge html, ...] }
const today = {};
let updatedAt = "";

function note(id, html) {
  (today[id] ||= []).push(html);
}

const CHART_SHORT = { topfree: "Free", toppaid: "Paid", topgrossing: "Grossing" };

function bestOverall(snapshots, id) {
  // Best "all categories" position per chart
  const out = [];
  for (const [chart, byCat] of Object.entries(snapshots || {})) {
    const row = (byCat.all || []).find(a => a.id === id);
    if (row) out.push(`${CHART_SHORT[chart] || chart} #${row.rank}`);
  }
  return out;
}

function index(ios, play, fresh, opps) {
  const saved = watchlist.all();
  for (const id of Object.keys(saved)) {
    const store = saved[id].store;
    if (store === "play" && play) {
      for (const label of bestOverall(play.snapshots, id)) note(id, `<span class="badge hot">${esc(label)}</span>`);
      const app = (play.apps || {})[id];
      if (app && app.installs != null) {
        note(id, `<span class="badge">${fmtCompact(app.installs)} installs${app.installs_per_day ? `, +${fmtCompact(app.installs_per_day)}/day` : ""}</span>`);
      }
      if (app && !(today[id] || []).some(h => h.includes("#"))) note(id, `<span class="badge">On a category chart</span>`);
    }
    if (store !== "play") {
      if (ios) for (const label of bestOverall(ios.snapshots, id)) note(id, `<span class="badge hot">${esc(label)}</span>`);
      const n = fresh && fresh.apps.find(a => a.id === id);
      if (n) {
        note(id, n.upcoming
          ? `<span class="badge soon">Upcoming ${esc(fmtDate(n.release_date))}</span>`
          : `<span class="badge">Trending ${n.score.toFixed(0)}</span>`);
        if (n.rating_delta > 0) note(id, `<span class="badge">+${fmtNumber(n.rating_delta)} reviews</span>`);
      }
      const o = opps && opps.apps.find(a => a.id === id);
      if (o) note(id, `<span class="badge kind">Opportunity ${o.score.toFixed(0)}</span>`);
    }
  }
}

function rows() {
  const q = search.value.trim().toLowerCase();
  return Object.values(watchlist.all())
    .filter(a => !q || `${a.name} ${a.developer} ${a.note || ""}`.toLowerCase().includes(q))
    .sort((a, b) => (b.added || "").localeCompare(a.added || "") || a.name.localeCompare(b.name));
}

function render() {
  const list = rows();
  tbody.innerHTML = list.map(a => `
    <tr data-id="${esc(a.id)}">
      <td class="cell-app">${appCell(a, { star: false })}</td>
      <td data-label="Store">${a.store === "play" ? "Google Play" : "App Store"}<small>${esc(a.genre || "")}</small></td>
      <td data-label="Saved" class="nowrap">${esc(fmtDate(a.added, true))}</td>
      <td class="cell-charts" data-label="Today">${(today[a.id] || []).join(" ") || `<span class="muted">Not in today's data</span>`}</td>
      <td class="cell-note" data-label="Note"><input type="text" class="note-input" value="${esc(a.note || "")}" placeholder="Why is this interesting?" aria-label="Note for ${esc(a.name)}"></td>
      <td class="cell-remove"><button type="button" class="more remove" title="Remove from watchlist">Remove</button></td>
    </tr>`).join("")
    || `<tr><td colspan="6" class="empty">Nothing saved yet. Tap ☆ next to an app on any page to save it here.</td></tr>`;

  const total = Object.keys(watchlist.all()).length;
  if (updatedAt) setStatus(status, updatedAt, `${total} saved app${total === 1 ? "" : "s"}`);
  else status.textContent = `${total} saved app${total === 1 ? "" : "s"}`;
}

tbody.addEventListener("change", e => {
  if (!e.target.classList.contains("note-input")) return;
  const items = watchlist.all();
  const id = e.target.closest("tr").dataset.id;
  if (!items[id]) return;
  items[id].note = e.target.value.trim();
  if (!watchlist.save(items)) alert("Could not save the note: browser storage is unavailable.");
});

tbody.addEventListener("click", e => {
  if (!e.target.classList.contains("remove")) return;
  const row = e.target.closest("tr");
  const items = watchlist.all();
  const name = (items[row.dataset.id] || {}).name || "this app";
  if (!confirm(`Remove ${name} from your watchlist? Its note will be deleted too.`)) return;
  delete items[row.dataset.id];
  watchlist.save(items);
  render();
});

search.addEventListener("input", render);

$("csv").addEventListener("click", () => downloadCsv("watchlist.csv", [
  { label: "Name", value: a => a.name },
  { label: "Developer", value: a => a.developer },
  { label: "Store", value: a => a.store === "play" ? "Google Play" : "App Store" },
  { label: "Category", value: a => a.genre },
  { label: "Saved", value: a => a.added },
  { label: "Note", value: a => a.note },
  { label: "URL", value: a => a.url }
], rows()));

$("backup").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(watchlist.all(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `watchlist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("restore").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("not a watchlist file");
    const items = watchlist.all();
    let added = 0;
    for (const [id, a] of Object.entries(incoming)) {
      if (!a || typeof a.name !== "string") continue;
      if (!items[id]) added++;
      // Merge: keep what is already here, add what is missing
      items[id] = { ...a, ...items[id], id };
    }
    watchlist.save(items);
    render();
    alert(`Restored. ${added} app${added === 1 ? "" : "s"} added, existing ones kept.`);
  } catch (err) {
    alert("Could not read that file: " + err.message);
  }
});

const optional = path => loadJson(path).catch(() => null);
render();
Promise.all([
  optional("data/apps.json"), optional("data/play.json"),
  optional("data/new_apps.json"), optional("data/opportunities.json")
]).then(([ios, play, fresh, opps]) => {
  updatedAt = (ios || play || {}).updated_at || "";
  index(ios, play, fresh, opps);
  render();
});
