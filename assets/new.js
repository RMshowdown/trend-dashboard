const genreSelect = document.getElementById("genre");
const daysSelect = document.getElementById("days");
const tbody = document.getElementById("apps");
const status = document.getElementById("status");

let apps = [];
let updatedAt = "";

function fmt(n) {
  return n == null ? "-" : n.toLocaleString("th-TH");
}

function render() {
  const genre = genreSelect.value;
  const maxDays = Number(daysSelect.value);

  const rows = apps
    .filter(a => a.days_since_release <= maxDays)
    .filter(a => genre === "all" || a.genre === genre);

  tbody.innerHTML = "";
  for (const a of rows) {
    const delta = a.rating_delta;
    const deltaText = delta == null ? "-" : (delta >= 0 ? "+" : "") + fmt(delta);
    const top = a.top_rank && a.top_rank.all != null ? `#${a.top_rank.all}` : "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="${a.url}" target="_blank" rel="noopener">${a.name}</a><br><small>${a.developer}</small></td>
      <td>${a.genre}</td>
      <td style="text-align: right;">${a.days_since_release}</td>
      <td style="text-align: right;">${fmt(a.rating_count)}</td>
      <td style="text-align: right;">${deltaText}</td>
      <td style="text-align: right;">${top}</td>
    `;
    tbody.appendChild(tr);
  }

  status.textContent = `แสดง ${rows.length} แอป (อัปเดตล่าสุด ${updatedAt})`;
}

fetch("data/new_apps.json")
  .then(res => res.json())
  .then(data => {
    apps = data.apps;
    updatedAt = data.updated_at;

    const genres = [...new Set(apps.map(a => a.genre))].sort();
    for (const g of genres) {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      genreSelect.appendChild(opt);
    }

    genreSelect.addEventListener("change", render);
    daysSelect.addEventListener("change", render);
    render();
  })
  .catch(err => {
    status.textContent = "โหลดข้อมูลไม่สำเร็จ: " + err;
  });