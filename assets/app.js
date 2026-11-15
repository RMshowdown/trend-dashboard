fetch("data/trends.json")
  .then(res => res.json())
  .then(data => {
    document.getElementById("status").textContent =
      `อัปเดตล่าสุด ${data.updated_at} (ค่าเป็นดัชนีสัมพัทธ์ 0-100)`;

    const labels = data.series[0].points.map(p => p.date);

    const datasets = data.series.map(s => ({
      label: s.name,
      data: s.points.map(p => p.value),
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3
    }));

    new Chart(document.getElementById("chart"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { y: { min: 0, max: 100 } }
      }
    });
  })
  .catch(err => {
    document.getElementById("status").textContent = "โหลดข้อมูลไม่สำเร็จ: " + err;
  });