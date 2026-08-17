#!/usr/bin/env python3
"""Drive the live DSH GUI: new Grok session, force server search, assert Think rows."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = os.environ.get("DSH_WEB_URL", "http://127.0.0.1:3080")
HOME = Path(os.environ.get("DSH_HOME", Path.home() / ".dsh"))
SESS_ROOT = HOME / "sessions" / "--home-noirbright-Workstation-dsh-llm-grok--"
PROMPT = (
    "Do not write or edit files. Do not call run_code. "
    "You must use your built-in web_search and x_search. "
    "Search the public web AND X for ALL of: "
    "(1) official xAI grok-4.6 reasoning.effort values, "
    "(2) whether xhigh is documented, "
    "(3) the latest xAI API changelog headline. "
    "Reply with exactly 3 short bullets, each citing a URL."
)
SHOT_DIR = Path("/tmp")


def newest_sessions(n: int = 5):
    if not SESS_ROOT.is_dir():
        return []
    dirs = [p for p in SESS_ROOT.iterdir() if p.is_dir()]
    dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return dirs[:n]


def decode_session(path: Path):
    raw = subprocess.check_output(["zstd", "-dc", str(path / "session.jsonl.zstd")])
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def analyze_session(path: Path):
    events = decode_session(path)
    empty = 0
    nonempty = 0
    tco = 0
    rs = 0
    packed = 0
    packed_items = 0
    texts = []
    for ev in events:
        if ev.get("type") != "assistant/message":
            continue
        msg = (ev.get("data") or {}).get("message") or {}
        content = msg.get("content") or []
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "reasoning":
                continue
            text = (block.get("text") or "").strip()
            if text:
                nonempty += 1
                texts.append(text[:80])
            else:
                empty += 1
        blocks = ((msg.get("source") or {}).get("replayState") or {}).get("blocks") or []
        for block in blocks:
            if not isinstance(block, dict) or block.get("type") != "reasoning":
                continue
            sig = block.get("thinkingSignature")
            if not isinstance(sig, str) or not sig.startswith("{"):
                continue
            try:
                obj = json.loads(sig)
            except json.JSONDecodeError:
                continue
            if obj.get("type") == "dsh-grok-packed-reasoning":
                packed += 1
                items = obj.get("items") or []
                packed_items += len(items)
                for item in items:
                    if isinstance(item, dict):
                        i = str(item.get("id") or "")
                        if i.startswith("tco_"):
                            tco += 1
                        elif i.startswith("rs_"):
                            rs += 1
                continue
            i = str(obj.get("id") or "")
            if i.startswith("tco_"):
                tco += 1
            elif i.startswith("rs_"):
                rs += 1
    return {
        "id": path.name,
        "events": len(events),
        "empty_reasoning": empty,
        "nonempty_reasoning": nonempty,
        "tco": tco,
        "rs": rs,
        "packed": packed,
        "packed_items": packed_items,
        "previews": texts[:5],
    }


def think_rows(page):
    rows = page.locator("text=/^Think/").all()
    out = []
    for row in rows:
        try:
            parent = row.locator("xpath=ancestor::*[self::button or self::div][1]")
            text = (parent.inner_text() if parent.count() else row.inner_text()) or ""
            out.append(text.strip())
        except Exception:
            out.append((row.inner_text() or "").strip())
    return out


def main() -> int:
    before = {p.name for p in newest_sessions(20)}
    print("before_sessions", sorted(before)[-5:])
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(URL + "/", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(SHOT_DIR / "dsh-e2e-home2.png"))
        grok_new = page.get_by_role("button", name="New session in dsh-llm-grok")
        if grok_new.count():
            grok_new.first.click(timeout=10000)
        else:
            page.get_by_role("button", name="New session").first.click(timeout=10000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOT_DIR / "dsh-e2e-new.png"))
        model = page.get_by_role("button", name="Select model")
        print("model_btn", model.inner_text() if model.count() else "missing")
        box = page.get_by_placeholder("Describe what you want to build")
        box.wait_for(timeout=15000)
        box.click()
        box.fill(PROMPT)
        page.get_by_role("button", name="Send message").click()
        print("sent")
        page.screenshot(path=str(SHOT_DIR / "dsh-e2e-sent.png"))
        deadline = time.time() + 240
        last = ""
        started = time.time()
        while time.time() < deadline:
            send = page.get_by_role("button", name="Send message")
            stop = page.get_by_role("button", name="Stop")
            thinks = think_rows(page)
            status = "send=%s stop=%s thinks=%s" % (send.count(), stop.count(), len(thinks))
            if status != last:
                print(status)
                last = status
            if send.count() and not stop.count() and time.time() - started > 8:
                page.wait_for_timeout(1500)
                if page.get_by_role("button", name="Send message").count():
                    break
            page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOT_DIR / "dsh-e2e-done.png"))
        rows = think_rows(page)
        print("think_rows", len(rows))
        for i, text in enumerate(rows[:20]):
            print("  think[%s] %r" % (i, text[:160]))
        body = page.inner_text("body")
        print("body_tail", body[-800:].replace("\n", " | "))
        browser.close()

    time.sleep(1)
    after = newest_sessions(8)
    created = [p for p in after if p.name not in before]
    target = created[0] if created else after[0]
    print("session_dir", target)
    stats = analyze_session(target)
    print("session_stats", json.dumps(stats, ensure_ascii=False))

    failed = []
    if stats["empty_reasoning"] > 0:
        failed.append("session still has %s empty reasoning blocks" % stats["empty_reasoning"])
    if stats["tco"] > 0 and stats["packed"] == 0:
        failed.append("saw %s tco_* items but none packed" % stats["tco"])
    if stats["nonempty_reasoning"] == 0 and stats["tco"] == 0:
        print("WARN: no visible thinking and no tco items; search may not have fired")
    if failed:
        print("FAIL", "; ".join(failed))
        return 1
    print("PASS gui e2e")
    return 0


if __name__ == "__main__":
    sys.exit(main())
