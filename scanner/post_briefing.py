# -*- coding: utf-8 -*-
"""생성된 briefing_output.json 검증 후 Worker에 게시"""
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
WORKER = "https://nexus-platform.nexusassetfund.workers.dev"


def main():
    inp = ROOT / "briefing_input.json"
    if inp.exists() and json.loads(inp.read_text("utf-8")).get("skip"):
        print("휴장일 — 게시 건너뜀")
        return
    out = ROOT / "briefing_output.json"
    if not out.exists():
        print("briefing_output.json 없음 — 생성 실패")
        sys.exit(1)
    b = json.loads(out.read_text("utf-8"))
    assert b.get("type") in ("장전", "장마감"), f"type 오류: {b.get('type')}"
    assert str(b.get("title", "")).strip(), "title 비어있음"
    assert isinstance(b.get("sections"), list) and b["sections"], "sections 비어있음"
    token = os.environ["NEXUS_ADMIN_TOKEN"]
    r = requests.post(
        f"{WORKER}/api/briefing",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        data=json.dumps(b, ensure_ascii=False).encode("utf-8"), timeout=30)
    print(f"POST /api/briefing -> {r.status_code} {r.text[:200]}")
    r.raise_for_status()


if __name__ == "__main__":
    main()
