"""ส่งสรุปรายวันเข้า Discord ผ่าน webhook

ตั้งค่า URL ของ webhook ใน environment variable ชื่อ DISCORD_WEBHOOK_URL
(บน GitHub ใส่เป็น repository secret) ถ้าไม่ได้ตั้งไว้ สคริปต์จะข้ามไปเฉย ๆ

ทดสอบโดยไม่ส่งจริง:  python scripts/notify_discord.py --dry-run
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

from common import DATA, HEADERS, ROOT, load_json, utc_now

CONFIG = ROOT / "config" / "app_charts.json"
ITEMS = 6
CHART_SHORT = {"topfree": "Free", "toppaid": "Paid", "topgrossing": "Grossing"}


def md(text):
    """escape ตัวอักษรพิเศษของ Discord markdown ในชื่อแอป"""
    return re.sub(r"([\\*_~`|\[\]()>#])", r"\\\1", str(text))


def link(app):
    return f"[{md(app['name'])}]({app['url']})"


def best_rank(app, genre_names):
    best = None
    for chart, by_genre in app.get("ranks", {}).items():
        for gkey, rank in by_genre.items():
            points = (101 - rank) * (1 if gkey == "all" else 0.6)
            if best is None or points > best[0]:
                label = "Overall" if gkey == "all" else genre_names.get(gkey, gkey)
                best = (points, f"{CHART_SHORT.get(chart, chart)} #{rank} {label}")
    return best[1] if best else None


def trending_section(new, today, genre_names):
    apps = [a for a in new["apps"] if not a.get("upcoming") and a["score"] > 0][:ITEMS]
    lines = []
    for i, a in enumerate(apps, 1):
        parts = [md(a["genre"]), f"{a['days_since_release']}d old"]
        rank = best_rank(a, genre_names)
        if rank:
            parts.append(rank)
        if a.get("rating_delta"):
            parts.append(f"+{a['rating_delta']:,} reviews")
        flag = " 🆕" if a.get("first_seen") == today else ""
        lines.append(f"**{i}.** {link(a)}{flag}\n   {' · '.join(parts)}")
    return lines


def upcoming_section(new, today):
    apps = [a for a in new["apps"] if a.get("upcoming")]
    fresh = [a for a in apps if a.get("first_seen") == today]
    picks = sorted(fresh or apps, key=lambda a: a["release_date"])[:ITEMS]
    lines = []
    for a in picks:
        date = a["release_date"][:10]
        lines.append(f"• {link(a)} · {md(a['genre'])} · out {date}")
    if fresh:
        lines.insert(0, f"_{len(fresh)} newly announced today_")
    return lines


def movers_section(top):
    apps = top.get("snapshots", {}).get("topfree", {}).get("all", [])
    if not top.get("compared", {}).get("topfree", {}).get("all"):
        return []
    entered = [a for a in apps if a.get("prev_rank") is None][:3]
    risers = sorted(
        (a for a in apps if a.get("prev_rank") and a["prev_rank"] - a["rank"] >= 5),
        key=lambda a: a["rank"] - a["prev_rank"],
    )[:ITEMS - len(entered)]
    lines = [f"▲{a['prev_rank'] - a['rank']} → **#{a['rank']}** {link(a)}" for a in risers]
    lines += [f"NEW → **#{a['rank']}** {link(a)}" for a in entered]
    return lines


def global_section(glob):
    home = glob.get("home", "th")
    names = {c["code"]: c["code"].upper() for c in glob.get("countries", [])}
    # เน้นแอปอายุไม่เกิน 1 ปี แอปยักษ์เก่า ๆ อย่าง Roblox ไม่ได้ช่วยเรื่องไอเดีย
    gaps = [
        a for a in glob.get("apps", [])
        if a["markets"] >= 2
        and home not in a["ranks"].get("topfree", {})
        and a.get("days_since_release") is not None and a["days_since_release"] <= 365
    ][:ITEMS]
    lines = []
    for a in gaps:
        where = sorted(
            {c for by in a["ranks"].values() for c in by if c != home},
        )
        note = "" if a.get("available_home") else " · ❌ not in TH store"
        lines.append(f"• {link(a)} · {md(a['genre'])} · {', '.join(names.get(c, c) for c in where)}{note}")
    return lines


def build_payload():
    config = load_json(CONFIG)
    site = config.get("site_url", "").rstrip("/")
    new = load_json(DATA / "new_apps.json", {"apps": []})
    top = load_json(DATA / "apps.json", {})
    glob = load_json(DATA / "global.json", {})
    today = utc_now().strftime("%Y-%m-%d")
    genre_names = {g["key"]: g["name"] for g in top.get("genres", [])}

    sections = [
        ("🔥 Trending new apps", "new.html", 0xF97316, trending_section(new, today, genre_names)),
        ("🔜 Upcoming (pre-order)", "new.html?status=upcoming", 0x8B5CF6, upcoming_section(new, today)),
        ("🚀 Biggest movers · Top Free", "apps.html", 0x22C55E, movers_section(top)),
        ("🌏 Newer apps hot abroad, not on TH chart", "compare.html?age=365",0x0EA5E9, global_section(glob)),
    ]
    embeds = []
    for title, page, color, lines in sections:
        if not lines:
            continue
        text = "\n".join(lines)
        if len(text) > 1000:
            text = text[:1000].rsplit("\n", 1)[0]
        embed = {"title": title, "color": color, "description": text}
        if site:
            embed["url"] = f"{site}/{page}"
        embeds.append(embed)

    content = f"**Daily app report** · {today}"
    if site:
        content += f" · <{site}/new.html>"
    return {"username": "Trend Dashboard", "content": content, "embeds": embeds,
            "allowed_mentions": {"parse": []}}


def main():
    payload = build_payload()
    if "--dry-run" in sys.argv:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not url:
        print("DISCORD_WEBHOOK_URL is not set, skipping Discord notification")
        return

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**HEADERS, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            print(f"sent to Discord ({res.status})")
    except urllib.error.HTTPError as e:
        # ไม่พิมพ์ URL ออกมา เพราะ URL ของ webhook คือรหัสลับ
        raise SystemExit(f"Discord rejected the message: {e.code} {e.read().decode('utf-8', 'replace')[:300]}")


if __name__ == "__main__":
    main()
