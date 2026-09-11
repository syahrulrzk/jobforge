#!/usr/bin/env python3
"""Task 16-b — probe real bypass paths for JobStreet (Datadome 403 on main site).
Tests: (1) main site baseline, (2) SEO listing pages, (3) internal API guesses,
(4) xapi.seekasia.com (SEEK Asia mobile/web API host), (5) third-party reader
proxies. Every request is real — no mocks. Output: status + latency + snippet.
"""
import requests, time, sys

requests.packages.urllib3.disable_warnings()

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
APP_UA = "okhttp/4.9.3"

def prof_browser():
    return {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

def prof_api():
    return {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "Referer": "https://www.jobstreet.co.id/",
        "Origin": "https://www.jobstreet.co.id",
    }

def prof_app():
    return {"User-Agent": APP_UA, "Accept": "application/json"}

PROFILES = {"browser": prof_browser(), "api": prof_api(), "app": prof_app()}

TARGETS = [
    # ── main site baseline / SEO pages
    ("browser", "https://www.jobstreet.co.id/"),
    ("browser", "https://www.jobstreet.co.id/id/frontend-developer-jobs"),
    ("browser", "https://www.jobstreet.co.id/job-search?keyword=frontend%20developer"),
    ("mobile",  "https://www.jobstreet.co.id/id/frontend-developer-jobs"),
    # ── internal API guesses on main host
    ("api", "https://www.jobstreet.co.id/api/v1/jobs?keyword=frontend%20developer"),
    ("api", "https://www.jobstreet.co.id/api/v1/jobsearch/search?keyword=frontend%20developer"),
    ("api", "https://www.jobstreet.co.id/api/jobsearch/v1/search?keyword=frontend%20developer"),
    # ── SEEK Asia xapi (mobile app backend)
    ("app",  "https://xapi.seekasia.com/api/v1/jobsearch/search?keyword=frontend%20developer&country_sites=id&limit=20"),
    ("app",  "https://xapi.seekasia.com/jobs?keyword=frontend"),
    ("api",  "https://xapi.seekasia.com/api/v1/jobsearch/search?keyword=frontend%20developer&country_sites=id&limit=20"),
    # ── third-party reader proxies fetching the SEO listing page
    ("browser", "https://r.jina.ai/https://www.jobstreet.co.id/id/frontend-developer-jobs"),
    ("browser", "https://api.allorigins.win/raw?url=" + requests.utils.quote("https://www.jobstreet.co.id/id/frontend-developer-jobs", safe="")),
]

sniff = sys.argv[1] if len(sys.argv) > 1 else None

for prof, url in TARGETS:
    if sniff and sniff.lower() not in url.lower():
        continue
    t0 = time.time()
    try:
        r = requests.get(url, headers=PROFILES[prof], timeout=12, verify=True, allow_redirects=True)
        ms = int((time.time() - t0) * 1000)
        body = (r.text or "")[:400].replace("\n", " ")[:400]
        ct = r.headers.get("content-type", "?")
        server = r.headers.get("server", "?")
        print(f"[{r.status_code}] {ms:>5}ms prof={prof:<7} ct={ct[:28]:<28} {url[:95]}")
        print(f"      server={server} | body: {body[:300]}")
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        print(f"[ERR] {ms:>5}ms prof={prof:<7} {url[:95]}")
        print(f"      {type(e).__name__}: {str(e)[:160]}")
    print()
