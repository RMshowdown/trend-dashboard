"""ดึงชาร์ต Top Free / Top Paid / Top Grossing ทุกหมวด และเก็บประวัติอันดับรายวัน

ประวัติอันดับเก็บแยกไฟล์ต่อชาร์ตต่อหมวดที่ data/rank_history/<chart>-<genre>.json
แต่ละวันเก็บเป็น list ของ app id เรียงตามอันดับ (ตำแหน่งที่ 0 = อันดับ 1)
หน้าเว็บโหลดเฉพาะไฟล์ที่กำลังดูอยู่ จึงไม่หนัก
"""
import time

from common import DATA, ROOT, fetch_chart, genre_key, load_json, utc_now, warn, write_json

CONFIG = ROOT / "config" / "app_charts.json"
OUTPUT = DATA / "apps.json"
HISTORY_DIR = DATA / "rank_history"


def history_path(chart_key, gkey):
    return HISTORY_DIR / f"{chart_key}-{gkey}.json"


def load_history(chart_key, gkey, country):
    h = load_json(history_path(chart_key, gkey), {})
    if h.get("country") != country:
        h = {"country": country, "days": {}}
    return h


def seed_from_legacy(old, today, country):
    """ย้ายข้อมูลจาก apps.json รุ่นก่อน (มีแค่ Top Free) มาเป็นประวัติ จะได้เทียบอันดับได้ตั้งแต่วันแรก"""
    old_date = old.get("updated_at", "")[:10]
    for gkey, apps in old.get("snapshots", {}).items():
        h = load_history("topfree", gkey, country)
        days = h["days"]
        if old_date and old_date < today:
            days.setdefault(old_date, [a["id"] for a in apps])
        prev_date = old.get("prev_date")
        ranked = [a for a in apps if a.get("prev_rank")]
        if prev_date and prev_date < today and ranked:
            ids = [None] * max(a["prev_rank"] for a in ranked)
            for a in ranked:
                ids[a["prev_rank"] - 1] = a["id"]
            days.setdefault(prev_date, ids)
        write_json(history_path("topfree", gkey), h, compact_lists=True)


def main():
    config = load_json(CONFIG)
    country = config["country"]
    keep_days = config.get("history_days", 30)
    now = utc_now()
    today = now.strftime("%Y-%m-%d")

    old = load_json(OUTPUT, {})
    if old.get("country") != country:
        old = {}
    snaps = old.get("snapshots", {})
    legacy = any(isinstance(v, list) for v in snaps.values())
    if legacy:
        seed_from_legacy(old, today, country)
        snaps = {}

    snapshots = {}
    compared = {}
    stale = []
    total = 0
    for chart in config["charts"]:
        ck = chart["key"]
        snapshots[ck] = {}
        compared[ck] = {}
        for genre in config["genres"]:
            gk = genre_key(genre["id"])
            try:
                apps = fetch_chart(country, chart["feed"], config["limit"], genre["id"])
                if not apps:
                    raise RuntimeError("empty chart")
            except Exception as e:
                # หมวดเดียวล้มไม่ควรทำให้ทั้งรอบเสีย ใช้ข้อมูลเดิมของหมวดนั้นไปก่อน
                warn(f"{chart['name']} / {genre['name']}: fetch failed ({e}), keeping previous data")
                stale.append(f"{ck}/{gk}")
                snapshots[ck][gk] = snaps.get(ck, {}).get(gk, [])
                compared[ck][gk] = old.get("compared", {}).get(ck, {}).get(gk)
                continue

            h = load_history(ck, gk, country)
            days = h["days"]
            earlier = sorted(d for d in days if d < today)
            prev = {}
            if earlier:
                prev = {app_id: i + 1 for i, app_id in enumerate(days[earlier[-1]]) if app_id}
            for a in apps:
                # None = เพิ่งเข้าชาร์ต (ถ้ามีข้อมูลวันก่อนให้เทียบ)
                a["prev_rank"] = prev.get(a["id"])
            compared[ck][gk] = earlier[-1] if earlier else None

            days[today] = [a["id"] for a in apps]
            h["days"] = dict(sorted(days.items())[-keep_days:])
            write_json(history_path(ck, gk), h, compact_lists=True)

            snapshots[ck][gk] = apps
            total += 1
            time.sleep(1.5)
        print(f"{chart['name']}: {len(snapshots[ck])} genres")

    if total == 0:
        raise SystemExit("all charts failed, nothing written")

    write_json(OUTPUT, {
        "updated_at": now.isoformat(timespec="seconds"),
        "country": country,
        "charts": [{"key": c["key"], "name": c["name"]} for c in config["charts"]],
        "genres": [{"key": genre_key(g["id"]), "name": g["name"]} for g in config["genres"]],
        "compared": compared,
        "stale": stale,
        "snapshots": snapshots,
    }, indent=None)
    print(f"wrote {total} charts to {OUTPUT}")


if __name__ == "__main__":
    main()
