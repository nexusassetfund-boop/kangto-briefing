"""가치투자 백테스트 결과(tmp/vbt_result*.json, vbt_grid*.json) → reports/backtest_value.md 생성.

backtest_report.run_eval(backtest-expert 평가)을 재사용해 Deploy/Refine/Abandon 판정 포함.

실행: python scanner/value_backtest_report.py [--tag _base]
"""

import argparse
import json
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent))

from backtest_report import run_eval, CACHE_DIR, REPORTS

NUM_PARAMS_VALUE = 6  # min_cap, per_max, pbr_max, margin_min, fscore_min, top


def _eval_compat(m: dict) -> dict:
    """value_backtest metrics → backtest_report.run_eval 입력 형식."""
    return {
        "trades": m.get("closed_trades", 0),
        "win_rate": m.get("win_rate") or 0,
        "avg_win": m.get("avg_win", 0),
        "avg_loss": m.get("avg_loss", 0) or 0.01,
        "mdd_pct": m.get("mdd_pct", 0),
        "yearly": {str(y): {} for y in m.get("yearly_pct", {})},
    }


def grid_table(grid: dict) -> str:
    rows = ["| 변형 | CAGR% | 총수익% | MDD% | 샤프 | 초과CAGR% | 거래 | 승률% | 회전율% | 평균보유 |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for key, g in grid.items():
        rows.append(f"| {key} | {g.get('cagr_pct')} | {g.get('total_return_pct')} | {g.get('mdd_pct')} | "
                    f"{g.get('sharpe')} | {g.get('excess_cagr_pct')} | {g.get('closed_trades')} | "
                    f"{g.get('win_rate')} | {g.get('turnover_annual_pct')} | {g.get('avg_holdings')} |")
    return "\n".join(rows)


def build(m: dict, result: dict, grid: dict, verdict: dict) -> str:
    L = ["# 가치투자 자동 발굴 후보 — 5년 월간 리밸런싱 백테스트", ""]
    L.append(f"검증 기간: {m['period']} · 유니버스: KOSPI200+KOSDAQ150 (각 신호일 시점 구성, KRX 포인트인타임 덤프)")
    L.append(f"리밸런싱 {m['n_rebalances']}회 (매월 첫 거래일 시가 체결, 전월 마지막 거래일 종가 신호)")
    L.append("")
    L.append("## 전략 규칙 (실서비스 value_screen.py와 동일 기준)")
    p = result.get("params", {})
    L.append(f"- 시총 ≥ {p.get('min_cap', 0)/1e8:,.0f}억 · EPS/BPS 양수 · PER ≤ {p.get('per_max')} · PBR ≤ {p.get('pbr_max')}")
    L.append(f"- 안전마진(RIM·Graham 보수 적정가 대비) ≥ {p.get('margin_min')}%")
    L.append(f"- 마진 상위 {p.get('top_fscore')}종목 Piotroski F-Score(포인트인타임 사업연도) — {p.get('fscore_min')}점 미만 탈락"
             + ("" if p.get("use_fscore") else " **(이번 실행에서는 미적용)**"))
    L.append(f"- (F-Score, 마진) 정렬 상위 {p.get('top')}종목 동일비중, 스크린 이탈 시 매도, 후보 부족분은 현금")
    L.append("")
    L.append("## 핵심 지표")
    L.append("| 지표 | 전략 | 벤치마크(KS200) |")
    L.append("|---|---|---|")
    L.append(f"| 총수익 | {m['total_return_pct']}% | {m['bench_total_pct']}% |")
    L.append(f"| CAGR | {m['cagr_pct']}% | {m['bench_cagr_pct']}% (초과 {m['excess_cagr_pct']:+}%p) |")
    L.append(f"| MDD | {m['mdd_pct']}% | — |")
    L.append(f"| 샤프 | {m['sharpe']} | — |")
    L.append("")
    L.append("| 운용 지표 | 값 |")
    L.append("|---|---|")
    L.append(f"| 연환산 회전율 | {m['turnover_annual_pct']}% |")
    L.append(f"| 평균 보유종목 수 | {m['avg_holdings']} (평균 현금 {m['avg_cash_pct']}%) |")
    L.append(f"| 청산 거래 수 | {m['closed_trades']} (미청산 {m['open_positions']}) |")
    L.append(f"| 승률 / 평균익 / 평균손 | {m['win_rate']}% / +{m['avg_win']}% / -{m['avg_loss']}% |")
    L.append(f"| 평균 보유일 | {m['avg_days']} |")
    L.append(f"| 후보<{p.get('top', 20)} 발생 월 | {m['months_under_top']}/{m['n_rebalances']} |")
    L.append("")
    L.append("## 이탈 사유")
    for r, n in m.get("exit_reasons", {}).items():
        L.append(f"- {r}: {n}건")
    L.append("")
    L.append("## 연도별 수익률 (%)")
    L.append("| 연도 | 전략 |")
    L.append("|---|---|")
    for y, v in sorted(m.get("yearly_pct", {}).items()):
        L.append(f"| {y} | {v:+} |")
    L.append("")
    if grid:
        L.append("## 강건성 그리드 (OFAT — 고원 vs 스파이크)")
        L.append(grid_table(grid))
        L.append("")
    if verdict and "total_score" in verdict:
        L.append("## backtest-expert 평가")
        L.append(f"- **판정: {verdict.get('verdict','?')}** (점수 {verdict.get('total_score','?')}/100)")
        for dim in verdict.get("dimensions", []):
            L.append(f"  - {dim.get('name')}: {dim.get('score')}/{dim.get('max_score')}")
        if verdict.get("red_flags"):
            L.append("- 레드플래그:")
            for rf in verdict["red_flags"]:
                L.append(f"  - [{rf.get('severity')}] {rf.get('message')}")
        L.append("")
    b = m.get("bias", {})
    L.append("## 데이터 편향·한계 (필수 확인)")
    L.append(f"- 유니버스 소스: {b.get('universe_sources')} — pit=신호일 당시 구성(생존편향 없음)")
    L.append(f"- 선정됐지만 FDR 시세 없음(상폐 추정, 체결 불가 처리): {b.get('selected_unpriced')}건, "
             f"결측 종목 {len(b.get('fdr_missing_tickers', []))}개 — 이 수치가 크면 수익률 상방 편향")
    L.append(f"- 시세 단절 강제 청산(마지막 종가): {b.get('forced_liquidations')}건 · 시가 결측 미체결: {b.get('unfilled')}건")
    L.append("- 실서비스와 차이: 기존 유니버스/포트폴리오 제외 규칙 미적용(순수 전략), 주간 스크린 → 월간 리밸런싱,")
    L.append("  KIS 폴백·기술적 지표 미사용, 배당 미반영(수익률 하방 보수적)")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="_base")
    args = ap.parse_args()

    rpath = CACHE_DIR / f"vbt_result{args.tag}.json"
    result = json.loads(rpath.read_text(encoding="utf-8"))
    m = result["metrics"]
    gpath = CACHE_DIR / f"vbt_grid{args.tag}.json"
    grid = json.loads(gpath.read_text(encoding="utf-8")) if gpath.exists() else {}

    ev = _eval_compat(m)
    verdict = run_eval(ev) if ev["trades"] else {}

    out = REPORTS / "backtest_value.md"
    out.write_text(build(m, result, grid, verdict), encoding="utf-8")
    print(f"생성: {out} (CAGR {m['cagr_pct']}%, 판정 {verdict.get('verdict')})")


if __name__ == "__main__":
    main()
