const status = document.getElementById("status");
const container = document.getElementById("charts");

const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
Chart.defaults.color = dark ? "#98a1ad" : "#6b7480";
Chart.defaults.borderColor = dark ? "#2a3038" : "#e1e4e8";
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

// Recent direction: average of the last 7 days vs the 7 days before
function trendOf(points) {
  const avg = list => list.reduce((sum, p) => sum + p.value, 0) / (list.length || 1);
  if (points.length < 14) return null;
  const recent = avg(points.slice(-7));
  const before = avg(points.slice(-14, -7));
  if (before === 0) return recent > 0 ? Infinity : 0;
  return (recent - before) / before * 100;
}

function trendBadge(pct) {
  if (pct === null) return "";
  if (pct === Infinity) return `<span class="up">▲ new</span>`;
  if (Math.abs(pct) < 5) return `<span class="muted">flat</span>`;
  return pct > 0
    ? `<span class="up">▲ ${pct.toFixed(0)}%</span>`
    : `<span class="down">▼ ${Math.abs(pct).toFixed(0)}%</span>`;
}

function renderGroup(name, series, stale) {
  const card = document.createElement("section");
  card.className = "card";
  const summary = series
    .map(s => `<span class="nowrap">${esc(s.name)} ${trendBadge(trendOf(s.points))}</span>`)
    .join(" · ");
  card.innerHTML = `
    <h2>${esc(name)} ${stale ? `<span class="badge warn">Last update failed, showing previous data</span>` : ""}</h2>
    <p class="note">Last 7 days vs previous 7: ${summary}</p>
    <div class="chart-box"><canvas></canvas></div>`;
  container.appendChild(card);

  new Chart(card.querySelector("canvas"), {
    type: "line",
    data: {
      labels: series[0].points.map(p => fmtDate(p.date)),
      datasets: series.map(s => ({
        label: s.name,
        data: s.points.map(p => p.value),
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3
      }))
    },
    options: {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } },
        y: { min: 0, max: 100 }
      }
    }
  });
}

loadJson("data/trends.json")
  .then(data => {
    if (!data.series || !data.series.length) throw new Error("no data yet");
    setStatus(status, data.updated_at);

    // Google Trends scales each group to 0-100 on its own, so each group gets its own chart.
    // Drawing them together would suggest values across groups are comparable when they are not.
    const groups = new Map();
    for (const s of data.series) {
      if (!s.points || !s.points.length) continue;
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    }
    const stale = new Set(data.stale_groups || []);
    for (const [name, series] of groups) renderGroup(name, series, stale.has(name));
  })
  .catch(err => showError(status, err));
