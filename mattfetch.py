#!/usr/bin/env python3
"""MattFetch — local GasBuddy scrape for Matt's Gas.

Runs on the Mac via launchd at 07:15 and 17:15 America/Denver.
Hits GasBuddy's GraphQL endpoint through py-gasbuddy (no HTML, no Firecrawl).
Appends one observation to gas-history.json and pushes to GitHub Pages.

Setup (once):
  python3 -m venv .venv && source .venv/bin/activate
  pip install py-gasbuddy PyGithub
  # create a fine-grained PAT with contents:write on jackcsu1/co-metro-gas-prices
  # store it: security add-generic-password -s mattsgas-pat -a $USER -w <token>
  # clone the repo next to this script, or set REPO_DIR

Usage:
  python3 mattfetch.py            # one run now
  python3 mattfetch.py --dry-run  # scrape + print, no push
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    from py_gasbuddy import GasBuddy
except ImportError:
    sys.exit("pip install py-gasbuddy")

# ---- config ----
STATIONS = [
    # (stable_id, gasbuddy_station_id, name, street_addr, city)
    ("imart-250",        44900,  "I-Mart",              "250 E Dry Creek Rd",        "Littleton"),
    ("exxon-6556",      44898,  "Exxon",                "6556 S Broadway",           "Littleton"),
    ("shell-8020",      44897,  "Shell",                "8020 S Broadway",           "Littleton"),
    ("ks-holly",        110924, "King Soopers",         "8250 S Holly St",           "Centennial"),
    ("qt-7801",         209545, "QuikTrip",             "7801 E Arapahoe Rd",        "Greenwood Village"),
    ("murphy-12022",    160558, "Murphy USA",           "12022 E Arapahoe Rd",       "Englewood"),
    ("sinclair-7500",   16682,  "Sinclair",             "7500 S Broadway",           "Littleton"),
    ("conoco-7450",     40178,  "Conoco",               "7450 S Colorado Blvd",      "Littleton"),
    ("ks-8080",         192043, "King Soopers",         "8080 S Broadway",           "Littleton"),
    ("shell-6200sf",    44896,  "Shell",                "6200 S Santa Fe Dr",        "Littleton"),
]

CITIES = {"Centennial", "Littleton", "Greenwood Village", "Englewood"}
MAX_AGE_DAYS = 14
PAUSE_SEC = 3
REPO_DIR = Path(os.environ.get("MATTSGAS_REPO", Path(__file__).resolve().parent))
TAPE_PATH = REPO_DIR / "gas-history.json"
KEYCHAIN_SERVICE = "mattsgas-pat"


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    return None


def price_node(data, key):
    node = data.get(key) or {}
    if not isinstance(node, dict):
        return None
    return num(node.get("price"))


def load_tape():
    if TAPE_PATH.exists():
        return json.loads(TAPE_PATH.read_text())
    return {
        "source": "observed GasBuddy GraphQL via py-gasbuddy (local MattFetch)",
        "area": "Centennial, Littleton, Greenwood Village, Englewood",
        "grades": ["regular", "premium"],
        "tracked": [s[0] for s in STATIONS],
        "observations": [],
    }


def denver_now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=-6)))


async def scrape_all():
    seen = {}
    blocked = []
    for sid, gbid, name, addr, city in STATIONS:
        try:
            gb = GasBuddy(station_id=gbid)
            data = await gb.price_lookup()
        except Exception as e:
            blocked.append(f"{gbid}: {str(e)[:80]}")
            time.sleep(PAUSE_SEC)
            continue
        rec = {
            "id": sid,
            "name": data.get("name") or name,
            "addr": (data.get("address") or {}).get("line1") or addr,
            "city": (data.get("address") or {}).get("locality") or city,
            "regular": price_node(data, "regular_gas"),
            "premium": price_node(data, "premium_gas"),
            "lat": data.get("latitude"),
            "lon": data.get("longitude"),
            "source": "py-gasbuddy",
        }
        seen[sid] = rec
        time.sleep(PAUSE_SEC)
    return seen, blocked


def append_observation(tape, seen, blocked):
    now = denver_now()
    prem = sum(1 for s in seen.values() if s.get("premium") is not None)
    status = "ok" if seen else "blocked"
    if seen and prem == 0:
        status = "partial"
    obs = {
        "date": now.strftime("%Y-%m-%d"),
        "crawled_at": now.strftime("%Y-%m-%dT%H:%M:%S-06:00"),
        "status": status,
        "note": "py-gasbuddy tracked=%d premium=%d/%d" % (len(STATIONS), prem, len(seen)) +
                  ("; blocked: " + "; ".join(blocked) if blocked else ""),
        "stations": list(seen.values()),
    }
    tape.setdefault("observations", []).append(obs)
    # trim: keep up to MAX_AGE_DAYS distinct dates
    dates, kept = [], []
    for item in reversed(tape["observations"]):
        d = item.get("date")
        if d in dates:
            kept.append(item)
            continue
        if len(dates) >= MAX_AGE_DAYS:
            continue
        dates.append(d)
        kept.append(item)
    tape["observations"] = list(reversed(kept))
    return obs


def push_tape():
    """Commit + push gas-history.json using a PAT from Keychain."""
    try:
        token = subprocess.check_output(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            text=True,
        ).strip()
    except Exception:
        print("No PAT in Keychain (service=%s). Skipping push." % KEYCHAIN_SERVICE)
        return False
    env = os.environ.copy()
    env["GIT_ASKPASS"] = "true"
    # rewrite remote to embed token for this push only
    try:
        remote = subprocess.check_output(
            ["git", "-C", str(REPO_DIR), "remote", "get-url", "origin"], text=True
        ).strip()
    except Exception as e:
        print("git remote failed:", e)
        return False
    # origin should be https://github.com/jackcsu1/co-metro-gas-prices.git
    authed = remote.replace("https://", f"https://x-access-token:{token}@")
    subprocess.run(
        ["git", "-C", str(REPO_DIR), "remote", "set-url", "origin", authed],
        check=False, capture_output=True,
    )
    subprocess.run(["git", "-C", str(REPO_DIR), "add", "gas-history.json"], check=True)
    r = subprocess.run(
        ["git", "-C", str(REPO_DIR), "diff", "--cached", "--quiet"],
        capture_output=True,
    )
    if r.returncode == 0:
        print("no tape change")
        return True
    subprocess.run(
        ["git", "-C", str(REPO_DIR), "-c", "user.name=mattfetch",
         "-c", "user.email=mattfetch@local", "commit",
         "-m", "MattFetch: observed GasBuddy crawl"],
        check=True,
    )
    push = subprocess.run(
        ["git", "-C", str(REPO_DIR), "push", "origin", "HEAD"],
        capture_output=True, text=True,
    )
    # restore clean remote url
    subprocess.run(
        ["git", "-C", str(REPO_DIR), "remote", "set-url", "origin", remote],
        check=False, capture_output=True,
    )
    if push.returncode != 0:
        print("push failed:", push.stderr[-300:])
        return False
    print("pushed")
    return True


async def main(dry_run=False):
    seen, blocked = await scrape_all()
    tape = load_tape()
    obs = append_observation(tape, seen, blocked)
    print(obs["status"], "stations", len(seen), "premium", sum(1 for s in seen.values() if s.get("premium") is not None))
    if dry_run:
        print(json.dumps(obs, indent=2)[:800])
        return
    TAPE_PATH.write_text(json.dumps(tape, indent=2) + "\n")
    push_tape()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    asyncio.run(main(dry_run=args.dry_run))
