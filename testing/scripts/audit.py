#!/usr/bin/env python3
"""PACT static health check (AUD-1).

A fast, dependency-free "is the system still healthy?" audit. Python **stdlib only** —
no pip installs, runs in seconds. Intended to be run before every commit and (eventually)
in CI.

Usage:
    python3 testing/scripts/audit.py            # file-based checks only (offline, default)
    python3 testing/scripts/audit.py --rls      # also run the live RLS proof (needs env creds)
    python3 testing/scripts/audit.py -h

Exit code is 0 when every check passes (warnings do not fail the run) and 1 when any
check FAILs — so it drops straight into a pre-commit hook or a CI gate.

What it checks (file-based, offline):
  * every service-worker PRE_CACHE URL resolves to a file on disk
  * PWA icons 192 / 512 / 180 exist and are the right pixel dimensions; 404.html exists
  * manifest.json has the required fields, scope + start_url = /PACT/, and a maskable icon
  * every app HTML page registers the service worker
  * the service-worker install handler has no unconditional skipWaiting()
  * (warning) any served media asset larger than 100 KB
  * engine-symbol drift guard: each tool imports DATA/compute/baseBuild/MUT/... from
    js/engine.js and re-defines none of them locally (the modern successor to the old
    "hand-copied MUT byte-compare" check — see the block comment on check_engine_bridge)

Optional (with --rls): as a non-DM player, confirm the Supabase REST API REJECTS both
(a) a write to characters.ap (the DM-only column) and (b) setting campaign_id to a
campaign never joined. Credentials come from the environment at runtime and are never
committed. See check_rls() for the required env vars.
"""

import argparse
import json
import os
import re
import struct
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Repo layout: this file lives at <repo>/testing/scripts/audit.py
# ---------------------------------------------------------------------------
REPO = Path(__file__).resolve().parents[2]

# The public URL prefix the app is served under (GitHub Pages project site).
URL_PREFIX = "/PACT/"

# App pages that MUST register the service worker. 404.html (a GH-Pages redirect stub)
# and docs/*.html (static content, e.g. the Players Guide) are intentionally exempt —
# they are not part of the installable app shell.
APP_PAGES = ["index.html", "login.html",
             "tools/PACT-CharGen-Webtool.html",
             "tools/PACT-Live-Char-Sheet.html",
             "tools/DM-Console.html"]

# The three UI-only tools that must consume the engine via the module bridge.
TOOLS = ["tools/PACT-CharGen-Webtool.html",
         "tools/PACT-Live-Char-Sheet.html",
         "tools/DM-Console.html"]

# Engine symbols the tools must IMPORT (never re-define locally, or they can drift).
ENGINE_SYMBOLS = ["DATA", "compute", "baseBuild", "MUT",
                  "foldBuild", "activeEvents", "economy"]

ASSET_SIZE_LIMIT = 100 * 1024  # 100 KB — media assets above this are warned about
IMAGE_EXTS = {".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico"}

# ---------------------------------------------------------------------------
# Tiny result collector
# ---------------------------------------------------------------------------
PASS, WARN, FAIL = "PASS", "WARN", "FAIL"
_SYM = {PASS: "✓", WARN: "!", FAIL: "✗"}


class Report:
    def __init__(self):
        self.rows = []      # (status, group, message)
        self._group = None

    def group(self, name):
        self._group = name

    def add(self, status, message):
        self.rows.append((status, self._group, message))

    def ok(self, message):
        self.add(PASS, message)

    def warn(self, message):
        self.add(WARN, message)

    def fail(self, message):
        self.add(FAIL, message)

    def counts(self):
        c = {PASS: 0, WARN: 0, FAIL: 0}
        for status, _g, _m in self.rows:
            c[status] += 1
        return c

    def print(self):
        last_group = object()
        for status, group, message in self.rows:
            if group != last_group:
                print("\n== %s ==" % group)
                last_group = group
            print("  [%s] %s" % (_SYM[status], message))
        c = self.counts()
        print("\n%s  %d passed, %d warning(s), %d failed"
              % ("PASS" if c[FAIL] == 0 else "FAIL",
                 c[PASS], c[WARN], c[FAIL]))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def read(path):
    return (REPO / path).read_text(encoding="utf-8")


def url_to_path(url):
    """Map a served URL (/PACT/... ) to a repo-relative filesystem path.

    /PACT/            -> index.html  (directory root serves index.html)
    /PACT/js/x.js     -> js/x.js
    """
    if not url.startswith(URL_PREFIX):
        return None
    rel = url[len(URL_PREFIX):]
    if rel == "":
        rel = "index.html"
    return rel


def png_dimensions(path):
    """Return (width, height) of a PNG by reading its IHDR chunk. Stdlib only."""
    with open(path, "rb") as fh:
        header = fh.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", header[16:24])
    return width, height


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
def check_service_worker_precache(rep):
    rep.group("service-worker PRE_CACHE")
    sw = read("service-worker.js")
    m = re.search(r"PRE_CACHE\s*=\s*\[(.*?)\]", sw, re.DOTALL)
    if not m:
        rep.fail("could not find a PRE_CACHE array in service-worker.js")
        return
    urls = re.findall(r"""['"]([^'"]+)['"]""", m.group(1))
    if not urls:
        rep.fail("PRE_CACHE array is empty")
        return
    missing = []
    for url in urls:
        rel = url_to_path(url)
        if rel is None:
            rep.warn("PRE_CACHE entry not under %s (skipped): %s" % (URL_PREFIX, url))
            continue
        if not (REPO / rel).is_file():
            missing.append(url)
    if missing:
        for url in missing:
            rep.fail("PRE_CACHE URL has no file on disk: %s" % url)
    else:
        rep.ok("all %d PRE_CACHE URLs resolve to files on disk" % len(urls))


def check_icons_and_404(rep):
    rep.group("PWA icons + 404")
    wanted = [("icons/icon-192.png", 192, 192),
              ("icons/icon-512.png", 512, 512),
              ("icons/apple-touch-icon.png", 180, 180)]
    for rel, w, h in wanted:
        p = REPO / rel
        if not p.is_file():
            rep.fail("missing icon: %s" % rel)
            continue
        dims = png_dimensions(p)
        if dims is None:
            rep.warn("%s exists but is not a readable PNG (dimensions unverified)" % rel)
        elif dims != (w, h):
            rep.fail("%s is %dx%d, expected %dx%d" % (rel, dims[0], dims[1], w, h))
        else:
            rep.ok("%s present (%dx%d)" % (rel, w, h))
    if (REPO / "404.html").is_file():
        rep.ok("404.html present")
    else:
        rep.fail("404.html missing")


def check_manifest(rep):
    rep.group("manifest.json")
    try:
        man = json.loads(read("manifest.json"))
    except (OSError, ValueError) as exc:
        rep.fail("could not read/parse manifest.json: %s" % exc)
        return
    for field in ("name", "short_name", "start_url", "scope", "display", "icons"):
        if field not in man:
            rep.fail("manifest missing required field: %s" % field)
    if man.get("start_url") == URL_PREFIX:
        rep.ok("start_url = %s" % URL_PREFIX)
    else:
        rep.fail("start_url is %r, expected %r" % (man.get("start_url"), URL_PREFIX))
    if man.get("scope") == URL_PREFIX:
        rep.ok("scope = %s" % URL_PREFIX)
    else:
        rep.fail("scope is %r, expected %r" % (man.get("scope"), URL_PREFIX))
    icons = man.get("icons", [])
    if any("maskable" in (ic.get("purpose") or "") for ic in icons):
        rep.ok("a maskable icon is declared")
    else:
        rep.fail("no icon declares purpose \"maskable\"")


def check_sw_registration(rep):
    rep.group("service-worker registration")
    for page in APP_PAGES:
        if not (REPO / page).is_file():
            rep.fail("app page missing: %s" % page)
            continue
        if re.search(r"serviceWorker\.register", read(page)):
            rep.ok("%s registers the service worker" % page)
        else:
            rep.fail("%s does not register the service worker" % page)


def check_sw_install_no_skipwaiting(rep):
    rep.group("service-worker install handler")
    sw = read("service-worker.js")
    install = re.search(r"addEventListener\(\s*['\"]install['\"]", sw)
    if not install:
        rep.fail("no install handler found in service-worker.js")
        return
    # The install region runs from the install listener up to the next addEventListener
    # (the activate handler). An unconditional skipWaiting() inside it would defeat the
    # deliberate "prompt before reload" upgrade flow, so it must not appear here.
    after = sw[install.end():]
    nxt = re.search(r"addEventListener\(", after)
    region = after[: nxt.start()] if nxt else after
    if "skipWaiting" in region:
        rep.fail("install handler contains skipWaiting() (must be gated behind a message)")
    else:
        rep.ok("install handler has no unconditional skipWaiting()")


def check_engine_bridge(rep):
    # -------------------------------------------------------------------
    # Engine-symbol drift guard (successor to AUD-1's original "byte-compare
    # each tool's embedded MUT against js/engine.js" check).
    #
    # WHY THIS SHAPE: as of D-GH26/D-GH33/D-GH36/D-GH37 all three tools import
    # DATA/compute/baseBuild/MUT/foldBuild/activeEvents/economy live from
    # js/engine.js, and CharGen's last local copy (buildToLiveLog's throwaway
    # MUT subset) was removed in D-GH40. There is no hand-copied engine symbol
    # left in any tool to byte-compare, so the old check has zero targets and
    # would be a misleading no-op. The real, current risk is REGRESSION: a
    # future edit pasting a local `const MUT = {...}` (or DATA/compute/...) back
    # into a tool, which could then silently drift from the engine. This guard
    # fails loudly on exactly that, and also confirms the import bridge is present.
    #
    # Only DATA/compute/baseBuild/MUT are guarded against local re-definition.
    # foldBuild/activeEvents/economy are deliberately imported under _engine*
    # aliases and wrapped by thin per-tool index adapters (Live Sheet + DM
    # Console scrub their LOG by index; the adapters just slice eventsUpTo() and
    # delegate to the engine — no rules logic, no drift). See D-GH37.
    # -------------------------------------------------------------------
    rep.group("engine-symbol drift guard")
    local_def = re.compile(
        r"\b(?:const|let|var)\s+(DATA|MUT|compute|baseBuild)\s*=\s*\{"
        r"|\bfunction\s+(compute|baseBuild)\s*\(")
    import_re = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]\.\./js/engine\.js['\"]")
    for tool in TOOLS:
        src = read(tool)
        name = Path(tool).name
        m = import_re.search(src)
        if not m:
            rep.fail("%s does not import from ../js/engine.js" % name)
        else:
            imported = {s.split(" as ")[0].strip() for s in m.group(1).split(",")}
            missing = [s for s in ("DATA", "compute", "MUT") if s not in imported]
            if missing:
                rep.fail("%s import is missing engine symbol(s): %s"
                         % (name, ", ".join(missing)))
            else:
                rep.ok("%s imports DATA/compute/MUT from the engine" % name)
        hits = {a or b for a, b in local_def.findall(src)}
        if hits:
            rep.fail("%s locally re-defines engine symbol(s): %s (drift risk)"
                     % (name, ", ".join(sorted(hits))))
        else:
            rep.ok("%s re-defines no engine symbols locally" % name)


def check_large_assets(rep):
    rep.group("large media assets (warning only)")
    # source-assets/ holds pre-optimization originals by design — never flag them.
    roots = [REPO / "assets", REPO / "icons"]
    big = []
    for root in roots:
        if not root.is_dir():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
                size = p.stat().st_size
                if size > ASSET_SIZE_LIMIT:
                    big.append((size, p.relative_to(REPO)))
    if not big:
        rep.ok("no media asset exceeds %d KB" % (ASSET_SIZE_LIMIT // 1024))
        return
    for size, rel in sorted(big, reverse=True):
        rep.warn("%d KB  %s" % (size // 1024, rel))


# ---------------------------------------------------------------------------
# Optional live RLS proof (--rls). Stdlib urllib only; no committed credentials.
# ---------------------------------------------------------------------------
def _rls_patch(url, key, jwt, payload):
    """PATCH a Supabase REST endpoint as a player; return (status, body_text)."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PATCH")
    req.add_header("apikey", key)
    req.add_header("Authorization", "Bearer " + jwt)
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def _rls_rejected(status, body):
    """A write is 'rejected' when the server errors (>=400) or returns zero rows.

    With Prefer: return=representation, a successful write echoes the row; an
    RLS/column-grant block returns HTTP 4xx or a 200 with an empty array.
    """
    if status >= 400:
        return True
    body = (body or "").strip()
    return body in ("", "[]")


def check_rls(rep):
    rep.group("RLS proof (live)")
    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    jwt = os.environ.get("PACT_PLAYER_JWT")
    char_id = os.environ.get("PACT_TEST_CHARACTER_ID")
    foreign_campaign = os.environ.get("PACT_FOREIGN_CAMPAIGN_ID")
    if not all([base, key, jwt, char_id, foreign_campaign]):
        rep.warn("skipped — set SUPABASE_URL, SUPABASE_ANON_KEY, PACT_PLAYER_JWT, "
                 "PACT_TEST_CHARACTER_ID, PACT_FOREIGN_CAMPAIGN_ID to run it")
        return
    endpoint = "%s/rest/v1/characters?id=eq.%s" % (base.rstrip("/"), char_id)

    # (a) player writing the DM-only characters.ap column must be rejected
    status, body = _rls_patch(endpoint, key, jwt, {"ap": 999999})
    if _rls_rejected(status, body):
        rep.ok("write to characters.ap rejected (status %s)" % status)
    else:
        rep.fail("SECURITY: player write to characters.ap SUCCEEDED (status %s): %s"
                 % (status, body[:200]))

    # (b) player attaching a character to a campaign they never joined must be rejected
    status, body = _rls_patch(endpoint, key, jwt, {"campaign_id": foreign_campaign})
    if _rls_rejected(status, body):
        rep.ok("setting campaign_id to an unjoined campaign rejected (status %s)" % status)
    else:
        rep.fail("SECURITY: player set campaign_id to an unjoined campaign (status %s): %s"
                 % (status, body[:200]))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(
        description="PACT static health check (AUD-1) — stdlib only.")
    parser.add_argument("--rls", action="store_true",
                        help="also run the live Supabase RLS proof (needs env creds)")
    args = parser.parse_args(argv)

    rep = Report()
    check_service_worker_precache(rep)
    check_icons_and_404(rep)
    check_manifest(rep)
    check_sw_registration(rep)
    check_sw_install_no_skipwaiting(rep)
    check_engine_bridge(rep)
    check_large_assets(rep)
    if args.rls:
        check_rls(rep)

    rep.print()
    return 1 if rep.counts()[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
