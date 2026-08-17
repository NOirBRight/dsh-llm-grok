#!/usr/bin/env python3
"""Live GUI e2e after dsh-web restart: no empty Think, no unknown X tools, x_search still works."""
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
    "You must use your built-in x_search (X / Twitter), not a local tool. "
    "Search X for the latest posts from @xai OR @xai_api about Grok 4.6. "
    "Reply with exactly 2 short bullets. Each bullet MUST include an https://x.com/ URL."
)
SHOT_DIR = Path("/tmp")


def newest_sessions(n=8):
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
    unknown = []
    tool_names = []
    texts = []
    x_urls = []
    for ev in events:
        t = ev.get("type")
        if t == "tool/call":
            name = (ev.get("data") or {}).get("name")
            if name:
                tool_names.append(name)
        if t == "tool/result":
            data = ev.get("data") or {}
            err = data.get("error") or {}
            msg = data.get("message") or {}
            blob = json.dumps(data, ensure_ascii=False)
            if "unknown tool" in blob.lower() or err.get("code") == "UNKNOWN_TOOL":
                unknown.append(blob[:240])
        if t != "assistant/message":
            continue
        msg = (ev.get("data") or {}).get("message") or {}
        content = msg.get("content") or []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "reasoning":
                text = (block.get("text") or "").strip()
                if text:
                    nonempty += 1
                    texts.append(text[:80])
                else:
                    empty += 1
            if block.get("type") == "text":
                body = block.get("text") or ""
                for token in body.split():
                    if "x.com/" in token or "twitter.com/" in token:
                        x_urls.append(token[:160])
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
                for item in obj.get("items") or []:
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
        "unknown": unknown,
        "tool_names": tool_names,
        "x_urls": x_urls[:8],
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
    print("before_sessions", sorted(before))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1400, "height": 1100})
        page.goto(URL + "/", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(4000)
        grok_new = page.get_by_role("button", name="New session in dsh-llm-grok")
        if grok_new.count():
            grok_new.first.click(timeout=10000)
        else:
            page.get_by_role("button", name="New session").first.click(timeout=10000)
        page.wait_for_timeout(1500)
        model = page.get_by_role("button", name="Select model")
        print("model_btn", model.inner_text() if model.count() else "missing")
        box = page.get_by_placeholder("Describe what you want to build")
        box.wait_for(timeout=15000)
        box.click()
        box.fill(PROMPT)
        page.get_by_role("button", name="Send message").click()
        print("sent")
        page.screenshot(path=str(SHOT_DIR / "dsh-e2e-x-sent.png"))
        started = time.time()
        last = ""
        while time.time() - started < 240:
            send = page.get_by_role("button", name="Send message")
            stop = page.get_by_role("button", name="Stop")
            status = "send=%s stop=%s thinks=%s" % (send.count(), stop.count(), len(think_rows(page)))
            if status != last:
                print(status)
                last = status
            if send.count() and not stop.count() and time.time() - started > 8:
                page.wait_for_timeout(2000)
                if page.get_by_role("button", name="Send message").count():
                    break
            page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOT_DIR / "dsh-e2e-x-done.png"))
        rows = think_rows(page)
        print("think_rows", len(rows))
        for i, text in enumerate(rows[:12]):
            print("  think[%s] %r" % (i, text[:160]))
        body = page.inner_text("body")
        print("body_has_unknown", "unknown tool" in body.lower())
        print("body_has_xcom", "x.com/" in body)
        print("BODY_TAIL", body[-900:].replace("\n", " | "))
        browser.close()

    time.sleep(1.2)
    after = newest_sessions(8)
    created = [p for p in after if p.name not in before]
    target = created[0] if created else after[0]
    print("session_dir", target)
    stats = analyze_session(target)
    print("session_stats", json.dumps(stats, ensure_ascii=False))

    failed = []
    if stats["empty_reasoning"] > 0:
        failed.append("empty Think blocks: %s" % stats["empty_reasoning"])
    if stats["unknown"]:
        failed.append("unknown tool results: %s" % stats["unknown"])
    leaked = [n for n in stats["tool_names"] if n in ("x_keyword_search", "x_semantic_search", "x_search")]
    if leaked:
        failed.append("server-search echo reached DSH tools: %s" % leaked)
    if stats["tco"] == 0 and not stats["x_urls"]:
        failed.append("no tco_* search items and no x.com citations — x_search may not have run")
    if failed:
        print("FAIL", "; ".join(failed))
        return 1
    print("PASS x_search still works; no empty Think; no unknown X tools")
    return 0


if __name__ == "__main__":
    sys.exit(main())
