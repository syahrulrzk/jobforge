#!/usr/bin/env python3
"""Probe menyeluruh JobStreet — bukti definitif kenapa scraper anonim gagal."""
import json
import urllib.request
import urllib.error

URLS = [
    ("root (UA bot)", "https://www.jobstreet.co.id/", "bot"),
    ("root (UA browser + headers lengkap)", "https://www.jobstreet.co.id/", "browser"),
    ("root (UA Googlebot)", "https://www.jobstreet.co.id/", "googlebot"),
    ("listing /id/jobs (UA browser)", "https://www.jobstreet.co.id/id/jobs/frontend-developer", "browser"),
    ("xapi.jobstreet.co.id (host API Seek)", "https://xapi.jobstreet.co.id/", "browser"),
    ("sitemap.xml", "https://www.jobstreet.co.id/sitemap.xml", "bot"),
    ("robots.txt", "https://www.jobstreet.co.id/robots.txt", "bot"),
]

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

def headers_for(kind):
    if kind == "browser":
        return {
            "User-Agent": BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
            "Sec-Ch-Ua": '"Chromium";v="126", "Google Chrome";v="126"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
        }
    if kind == "googlebot":
        return {"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Accept": "*/*"}
    return {"User-Agent": "JobForgeBot/1.0 (+https://jobforge.local)", "Accept": "*/*"}

for label, url, kind in URLS:
    req = urllib.request.Request(url, headers=headers_for(kind))
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            body = r.read(200)
            print(f"{label:<42} → {r.status} OK  ({body[:60]!r})")
    except urllib.error.HTTPError as e:
        server = e.headers.get("Server", "?")
        print(f"{label:<42} → {e.code} DIBLOKIR  (server: {server})")
    except Exception as e:
        print(f"{label:<42} → GAGAL: {type(e).__name__}: {str(e)[:60]}")
