import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "app_charts.json"
OUTPUT = ROOT / "data" / "apps.json"

HEADERS = {"User-Agent": "Mozilla/5.0 trend-dashboard"}


def fetch_chart(country, chart, limit, genre_id):
    url = f"https://itunes.apple.com/{country}/rss/{chart}/limit={limit}"
    if genre_id is not None:
        url += f"/genre={genre_id}"
    url += "/json"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read().decode("utf-8"))

    entries = data["feed"].get("entry", [])
    if not entries:
        raise RuntimeError(f"empty chart for genre {genre_id}")

    apps = []
    for rank, e in enumerate(entries, start=1):
        apps.append({
            "rank": rank,
            "id": e["id"]["attributes"]["im:id"],
            "name": e["im:name"]["label"],
            "developer": e["im:artist"]["label"],
            "genre": e["category"]["attributes"]["label"],
            "url": e["id"]["label"],
        })
    return apps


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    country = config["country"]
    chart = config["chart"]
    limit = config["limit"]

    snapshots = {}
    genres = []
    for genre in config["genres"]:
        key = "all" if genre["id"] is None else str(genre["id"])
        apps = fetch_chart(country, chart, limit, genre["id"])
        snapshots[key] = apps
        genres.append({"key": key, "name": genre["name"]})
        print(f"{genre['name']}: {len(apps)} apps")
        time.sleep(2)

    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "country": country,
        "genres": genres,
        "snapshots": snapshots,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(snapshots)} snapshots to {OUTPUT}")


if __name__ == "__main__":
    main()