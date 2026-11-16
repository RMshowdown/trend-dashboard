"""เทียบชาร์ตหลายประเทศ เพื่อหาแอปที่ดังในต่างประเทศแต่ยังไม่ดังหรือยังไม่มีในไทย

ผลลัพธ์อยู่ที่ data/global.json แต่ละแอปมีอันดับในทุกประเทศ และบอกว่ามีขายในสโตร์ไทยหรือไม่
"""
import time

from common import (DATA, ROOT, fetch_chart, load_json, lookup, parse_date,
                    short_text, utc_now, warn, write_json)

CONFIG = ROOT / "config" / "app_charts.json"
APPS = DATA / "apps.json"
OUTPUT = DATA / "global.json"


def main():
    config = load_json(CONFIG)
    home = config["country"]
    cmp = config["compare"]
    limit = cmp.get("limit", 100)
    charts = [c for c in config["charts"] if c["key"] in cmp["charts"]]
    countries = cmp["countries"]
    now = utc_now()

    # ชาร์ตของประเทศหลักดึงไว้แล้วใน apps.json ใช้ซ้ำได้เลย
    top = load_json(APPS, {})
    home_snaps = top.get("snapshots", {}) if top.get("country") == home else {}

    apps = {}
    fetched = 0
    for c in countries:
        code = c["code"]
        for chart in charts:
            entries = home_snaps.get(chart["key"], {}).get("all") if code == home else None
            if not entries:
                try:
                    entries = fetch_chart(code, chart["feed"], limit)
                except Exception as e:
                    warn(f"{c['name']} {chart['name']}: fetch failed ({e})")
                    continue
                time.sleep(1.5)
            fetched += 1
            for e in entries:
                rec = apps.setdefault(e["id"], {
                    "id": e["id"], "name": e["name"], "developer": e["developer"],
                    "genre": e["genre"], "icon": e.get("icon"), "url": e["url"],
                    "origin": code, "ranks": {},
                })
                rec["ranks"].setdefault(chart["key"], {})[code] = e["rank"]
        print(f"{c['name']}: done")

    if fetched == 0:
        raise SystemExit("all charts failed, nothing written")

    # เช็กว่ามีในสโตร์ไทยไหม แอปที่ไม่มีจะไม่อยู่ในผล lookup
    home_info = lookup(home, apps)
    by_origin = {}
    for app_id, rec in apps.items():
        if app_id not in home_info:
            by_origin.setdefault(rec["origin"], []).append(app_id)
    other_info = {}
    for code, ids in by_origin.items():
        other_info.update(lookup(code, ids))

    result = []
    for app_id, rec in apps.items():
        r = home_info.get(app_id) or other_info.get(app_id) or {}
        rec["available_home"] = app_id in home_info
        rec["name"] = (r.get("trackName") or rec["name"]).strip()
        rec["developer"] = r.get("artistName") or rec["developer"]
        rec["genre"] = r.get("primaryGenreName") or rec["genre"]
        rec["icon"] = r.get("artworkUrl100") or rec["icon"]
        rec["url"] = r.get("trackViewUrl") or rec["url"]
        rec["description"] = short_text(r.get("description"), 200)
        rec["release_date"] = r.get("releaseDate")
        rec["days_since_release"] = (now - parse_date(r["releaseDate"])).days if r.get("releaseDate") else None
        rec["rating_count"] = r.get("userRatingCount")

        # คะแนนรวมต่างประเทศ: ยิ่งติดอันดับสูงและติดหลายประเทศยิ่งได้มาก
        foreign = {code for by_country in rec["ranks"].values() for code in by_country if code != home}
        rec["markets"] = len(foreign)
        rec["global_score"] = sum(
            101 - rank
            for by_country in rec["ranks"].values()
            for code, rank in by_country.items() if code != home
        )
        del rec["origin"]
        result.append(rec)

    result.sort(key=lambda a: -a["global_score"])

    write_json(OUTPUT, {
        "updated_at": now.isoformat(timespec="seconds"),
        "home": home,
        "countries": countries,
        "charts": [{"key": c["key"], "name": c["name"]} for c in charts],
        "apps": result,
    }, indent=None)
    gaps = sum(1 for a in result if a["markets"] >= 2 and home not in a["ranks"].get("topfree", {}))
    print(f"wrote {len(result)} apps ({gaps} trending abroad but not on {home} Top Free) to {OUTPUT}")


if __name__ == "__main__":
    main()
