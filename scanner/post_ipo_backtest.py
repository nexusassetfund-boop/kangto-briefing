# -*- coding: utf-8 -*-
"""docs/data/ipo_backtest.json 검증 → Worker KV 게시 (Post IPO 백테스터 데이터).

repo에는 커밋하지 않는다 — 5MB+ 일봉 데이터를 매일 커밋하면 repo가 비대해짐.
KV가 유일한 저장소이므로, 게시 전 검증으로 빈 데이터 덮어쓰기를 방지한다.
"""
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "data" / "ipo_backtest.json"
WORKER = "https://nexus-platform.nexusassetfund.workers.dev"
MIN_STOCKS = 200  # 현재 241개 — 급감하면 수집 실패로 간주하고 KV를 보호


def main():
    if not SRC.exists():
        print("ipo_backtest.json 없음 — 수집 실패")
        sys.exit(1)
    data = json.loads(SRC.read_text("utf-8"))
    stocks = data.get("stocks") or []
    if len(stocks) < MIN_STOCKS:
        print(f"종목 {len(stocks)}개 < 최소 {MIN_STOCKS} — 수집 이상, KV 게시 중단")
        sys.exit(1)

    token = os.environ.get("NEXUS_ADMIN_TOKEN", "").strip()
    if not token:
        print("NEXUS_ADMIN_TOKEN 없음 — KV 게시 생략 (파일만 저장)")
        return
    resp = requests.post(
        f"{WORKER}/api/push",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        data=json.dumps({"files": {"ipo_backtest.json": data}}, ensure_ascii=False).encode("utf-8"),
        timeout=120)
    print(f"POST /api/push -> {resp.status_code} {resp.text[:200]}")
    resp.raise_for_status()
    print(f"KV 게시 완료 — {len(stocks)}종목, updated_at {data.get('updated_at')}")


if __name__ == "__main__":
    main()
