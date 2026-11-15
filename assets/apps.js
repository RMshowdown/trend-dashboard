const genreSelect = document.getElementById("genre");
const tbody = document.getElementById("apps");
const status = document.getElementById("status");

let data = null;

function render(key) {
  const apps = data.snapshots[key] || [];
  tbody.innerHTML = "";
  for (const app of apps) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${app.rank}</td>
      <td><a href="${app.url}" target="_blank" rel="noopener">${app.name}</a></td>
      <td>${app.developer}</td>
      <td>${app.genre}</td>
    `;
    tbody.appendChild(tr);
  }
}

fetch("data/apps.json")
  .then(res => res.json())
  .then(json => {
    data = json;
    status.textContent = `อัปเดตล่าสุด ${data.updated_at}`;

    for (const g of data.genres) {
      const opt = document.createElement("option");
      opt.value = g.key;
      opt.textContent = g.name;
      genreSelect.appendChild(opt);
    }

    genreSelect.addEventListener("change", () => render(genreSelect.value));
    render(genreSelect.value);
  })
  .catch(err => {
    status.textContent = "โหลดข้อมูลไม่สำเร็จ: " + err;
  });