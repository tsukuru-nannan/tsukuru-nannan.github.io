#!/usr/bin/env python3
"""Spotify RSSを全件取得し、サイト用JSONを安全に更新する（外部依存なし）。"""
import argparse
from collections import Counter
from datetime import timezone
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
RSS_URL = "https://anchor.fm/s/106c91948/podcast/rss"
CATEGORIES = {"DX": "dx", "3Dプリンター": "3d", "工作機械": "machine", "AI": "ai", "雑談": "talk"}


def category_for(title):
    normalized = unicodedata.normalize("NFKC", title).strip()
    match = re.search(r"【([^】]+)】\s*$", normalized)
    return CATEGORIES.get(match.group(1).strip(), "other") if match else "other"


def http_url(value):
    parts = urlsplit(value)
    return value if parts.scheme in ("https", "http") and parts.hostname else ""


def embed_for(link):
    parts = urlsplit(link)
    # RSSに含まれる実際の番組IDを使う。旧HTMLの番組スラッグを固定しない。
    if parts.hostname == "open.spotify.com" and re.fullmatch(r"/episode/[A-Za-z0-9]+", parts.path):
        return "https://open.spotify.com/embed" + parts.path
    if parts.hostname in ("podcasters.spotify.com", "creators.spotify.com", "anchor.fm"):
        if re.fullmatch(r"/pod/show/[^/]+/episodes/[^/]+", parts.path):
            return urlunsplit(("https", "podcasters.spotify.com", parts.path.replace("/episodes/", "/embed/episodes/", 1), "", ""))
    return ""


def parse_feed(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("RSSに未対応のDOCTYPE/ENTITYが含まれています")
    root = ET.fromstring(data)
    items = root.findall("./channel/item")
    if not items:
        raise ValueError("RSSにエピソードがありません")
    episodes, seen = [], set()
    for item in items:
        title = item.findtext("title", "").strip()
        link = http_url(item.findtext("link", "").strip())
        identity = item.findtext("guid", "").strip() or link
        if not title or not identity or not link:
            raise ValueError("タイトル・ID・リンクが欠けたエピソードがあります")
        if identity in seen:
            raise ValueError(f"エピソードIDが重複しています: {identity}")
        seen.add(identity)
        date = parsedate_to_datetime(item.findtext("pubDate", ""))
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        enclosure = item.find("enclosure")
        audio = http_url(enclosure.get("url", "")) if enclosure is not None else ""
        episodes.append({
            "id": identity, "title": title, "category": category_for(title),
            "url": link, "embed_url": embed_for(link),
            "published": date.astimezone(timezone.utc).isoformat(), "audio_url": audio,
        })
    return sorted(episodes, key=lambda item: (item["published"], item["id"]), reverse=True)


def fetch_feed(url):
    request = Request(url, headers={"User-Agent": "TsukuruNannan-RSS-Updater/1.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read(10 * 1024 * 1024 + 1)
            if len(data) > 10 * 1024 * 1024:
                raise ValueError("RSSが10MBを超えています")
            return data
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def update(data, output, allow_removals=False):
    episodes = parse_feed(data)
    existing = json.loads(output.read_text(encoding="utf-8")) if output.exists() else []
    if existing and not allow_removals:
        missing = {item["id"] for item in existing} - {item["id"] for item in episodes}
        if missing:
            raise ValueError(f"以前取得した{len(missing)}件がRSSにありません。既存データを保持して更新を中止します")
    if not existing:
        if len(episodes) < 44 or not any(re.search(r"#1\s", item["title"]) for item in episodes):
            raise ValueError("初回取得は第1回を含む44件以上が必要です。RSSの全件取得を確認してください")
    content = json.dumps(episodes, ensure_ascii=False, indent=2) + "\n"
    changed = not output.exists() or output.read_text(encoding="utf-8") != content
    if changed:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(output.name + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(output)
    print(f"{len(episodes)}件 / 分類: {dict(Counter(item['category'] for item in episodes))}")
    print("データを更新しました" if changed else "変更はありません")
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed", type=Path, help="検証用のローカルRSSファイル")
    parser.add_argument("--output", type=Path, default=ROOT / "episodes.json")
    parser.add_argument("--allow-removals", action="store_true", help="意図的に公開回を削除した場合のみ使用")
    args = parser.parse_args()
    data = args.feed.read_bytes() if args.feed else fetch_feed(os.environ.get("PODCAST_RSS_URL", RSS_URL))
    changed = update(data, args.output, args.allow_removals)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"changed={str(changed).lower()}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"更新失敗（既存JSONを維持）: {error}", file=sys.stderr)
        sys.exit(1)
