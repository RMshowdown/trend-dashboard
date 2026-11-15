import json
import time
from datetime import datetime, timezone
from pathlib import Path

from pytrends.request import TrendReq

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "keywords.json"
OUTPUT = ROOT / "data" / "trends.json"


def fetch_group(pytrends, keywords, timeframe, geo):
    pytrends.build_payload(keywords, timeframe=timeframe, geo=geo)
    df = pytrends.interest_over_time()
    if df.empty:
        raise RuntimeError(f"no data returned for {keywords}")
    return df[df["isPartial"] == False].drop(columns=["isPartial"])


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    pytrends = TrendReq(hl="th-TH", tz=420)

    series = []
    for group in config["groups"]:
        df = fetch_group(pytrends, group["keywords"], config["timeframe"], config["geo"])
        for kw in group["keywords"]:
            points = [
                {"date": idx.strftime("%Y-%m-%d"), "value": int(row[kw])}
                for idx, row in df.iterrows()
            ]
            series.append({"name": kw, "group": group["name"], "points": points})
        time.sleep(5)

    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "geo": config["geo"],
        "timeframe": config["timeframe"],
        "series": series,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(series)} series to {OUTPUT}")


if __name__ == "__main__":
    main()