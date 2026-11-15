fetch("data/trends.json")
  .then(res => res.json())
  .then(data => {
    const count = data.series.length;
    document.getElementById("status").textContent =
      `โหลดสำเร็จ ${count} คำค้น อัปเดตล่าสุด ${data.updated_at}`;
  })
  .catch(err => {
    document.getElementById("status").textContent = "โหลดข้อมูลไม่สำเร็จ: " + err;
  });