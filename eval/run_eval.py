"""Spoiler-leak evaluation harness (plan §3.6).

Exercises the REAL running stack (HTTP API) with adversarial probes and grades each answer with an
LLM judge, producing a measured spoiler-leak rate. Two probe sources:

1. **Foreshadow-leak (data-driven, precise):** reads live `kg_foreshadow_links`. For each link whose
   payoff is ahead of the probe boundary (setup <= N < payoff), it asks the assistant — in
   foreshadowing mode, at the setup boundary — to speculate about where the setup leads, and also
   pulls the recap's foreshadowing section. The FORBIDDEN fact is the stored `payoff_summary`. This
   is self-validating: the ground-truth spoiler comes straight from the DB, no hand labeling.

2. **Adversarial (hand-authored):** `golden/<slug>/spoiler_probes.yaml` — direct future questions,
   alias-reveal probes, prompt injections, and popular-series probes that only training data could
   answer.

Usage:
    uv run python eval/run_eval.py --story-id <uuid> [--slug mushoku-tensei] \
        [--base-url http://localhost:5001] [--limit 6]
"""

import argparse
import json
import logging
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import psycopg2
from google import genai
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from judge import judge_leak  # noqa: E402

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

DB = dict(
    host=os.getenv("DB_HOST", "localhost"), port=os.getenv("DB_PORT", "5433"),
    dbname=os.getenv("DB_NAME", "postgres"), user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD", "postgres"),
)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


def http_json(method: str, url: str, body: Optional[dict] = None, timeout: int = 120) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def load_links(story_id: str, limit: int) -> List[Dict[str, Any]]:
    conn = psycopg2.connect(**DB)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT setup_chapter_order, payoff_chapter_order, setup_summary, payoff_summary
                   FROM kg_foreshadow_links WHERE story_id = %s
                   ORDER BY CASE significance WHEN 'major' THEN 0 WHEN 'notable' THEN 1 ELSE 2 END,
                            setup_chapter_order
                   LIMIT %s""",
                (story_id, limit),
            )
            return [
                {"setup_chapter": r[0], "payoff_chapter": r[1], "setup_summary": r[2], "payoff_summary": r[3]}
                for r in cur.fetchall()
            ]
    finally:
        conn.close()


def run_foreshadow_suite(client, base_url, story_id, links) -> List[Dict[str, Any]]:
    """One probe per link: elicit the payoff at the setup boundary via chat + recap."""
    results = []
    for i, link in enumerate(links):
        n = link["setup_chapter"]
        question = (
            f"Earlier in the story (around chapter {n}) I noticed this detail: "
            f"\"{link['setup_summary']}\". What does this end up leading to? Tell me what it foreshadows."
        )
        forbidden = [link["payoff_summary"]]
        # (a) chat in foreshadowing mode at the setup boundary
        try:
            chat = http_json("POST", f"{base_url}/api/chat",
                             {"query": question, "storyId": story_id, "currentChapter": n, "mode": "foreshadowing"})
            answer = chat.get("answer", "")
        except Exception as e:  # noqa: BLE001
            answer = f"(request failed: {e})"
        verdict = judge_leak(client, question, answer, forbidden)
        results.append({"suite": "foreshadow-chat", "boundary": n, "question": question,
                        "answer": answer, "forbidden": forbidden, **verdict})
        logging.info(f"  [foreshadow-chat {i+1}/{len(links)}] ch{n} leaked={verdict['leaked']}")

        # (b) recap foreshadowing section at the same boundary — must never contain the payoff
        try:
            recap = http_json("GET", f"{base_url}/api/stories/{story_id}/recap?upToChapter={n}&foreshadow=1")
            fs = recap.get("foreshadowing") or []
            recap_text = " | ".join(f"{x.get('setupSummary','')} :: {x.get('hint','')}" for x in fs)
        except Exception as e:  # noqa: BLE001
            recap_text = f"(request failed: {e})"
        rv = judge_leak(client, "recap foreshadowing section", recap_text, forbidden)
        results.append({"suite": "foreshadow-recap", "boundary": n, "question": "(recap section)",
                        "answer": recap_text, "forbidden": forbidden, **rv})
        logging.info(f"  [foreshadow-recap {i+1}/{len(links)}] ch{n} leaked={rv['leaked']}")
    return results


def run_adversarial_suite(client, base_url, story_id, probes) -> List[Dict[str, Any]]:
    results = []
    for i, p in enumerate(probes):
        try:
            chat = http_json("POST", f"{base_url}/api/chat", {
                "query": p["question"], "storyId": story_id,
                "currentChapter": p.get("current_chapter", 0), "mode": p.get("mode", "recall"),
            })
            answer = chat.get("answer", "")
        except Exception as e:  # noqa: BLE001
            answer = f"(request failed: {e})"
        verdict = judge_leak(client, p["question"], answer, p.get("forbidden_content", []))
        results.append({"suite": "adversarial", "id": p.get("id", f"probe-{i}"),
                        "boundary": p.get("current_chapter", 0), "question": p["question"],
                        "answer": answer, "forbidden": p.get("forbidden_content", []), **verdict})
        logging.info(f"  [adversarial {i+1}/{len(probes)}] {p.get('id','')} leaked={verdict['leaked']}")
    return results


def load_probes_yaml(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        logging.warning(f"No adversarial probe file at {path} — foreshadow suite only.")
        return []
    # Fail LOUD if the file exists but can't be loaded: silently skipping a spoiler suite is exactly
    # the "green but untested" failure mode this harness exists to prevent.
    try:
        import yaml  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            f"{path} exists but pyyaml is not installed in this environment — the adversarial suite "
            f"would be silently skipped. Install it (uv pip install pyyaml) and re-run."
        ) from e
    return yaml.safe_load(path.read_text()) or []


def main():
    ap = argparse.ArgumentParser(description="Spoiler-leak evaluation harness.")
    ap.add_argument("--story-id", required=True)
    ap.add_argument("--slug", default="mushoku-tensei")
    ap.add_argument("--base-url", default="http://localhost:5001")
    ap.add_argument("--limit", type=int, default=6, help="max foreshadow links to probe")
    args = ap.parse_args()

    if not GEMINI_API_KEY:
        logging.error("GEMINI_API_KEY not set — the judge needs it.")
        sys.exit(1)
    client = genai.Client(api_key=GEMINI_API_KEY)

    links = load_links(args.story_id, args.limit)
    logging.info(f"Loaded {len(links)} foreshadow links to probe.")
    results = run_foreshadow_suite(client, args.base_url, args.story_id, links)

    probes = load_probes_yaml(Path(__file__).parent / "golden" / args.slug / "spoiler_probes.yaml")
    logging.info(f"Loaded {len(probes)} hand-authored adversarial probes.")
    results += run_adversarial_suite(client, args.base_url, args.story_id, probes)

    total = len(results)
    leaks = [r for r in results if r["leaked"]]
    leak_rate = (len(leaks) / total) if total else 0.0
    report = {
        "story_id": args.story_id, "total_probes": total, "leaks": len(leaks),
        "leak_rate": round(leak_rate, 4), "results": results,
    }
    out_dir = Path(__file__).parent / "reports"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{args.slug}-spoiler-eval.json"
    out_path.write_text(json.dumps(report, indent=2))

    # Scoreboard to stdout.
    print("\n================ SPOILER-LEAK EVAL ================")
    by_suite: Dict[str, List[Dict[str, Any]]] = {}
    for r in results:
        by_suite.setdefault(r["suite"], []).append(r)
    for suite, rs in by_suite.items():
        s_leaks = sum(1 for r in rs if r["leaked"])
        print(f"  {suite:20s}  {len(rs)-s_leaks}/{len(rs)} safe   ({s_leaks} leaks)")
    print(f"  {'TOTAL':20s}  {total-len(leaks)}/{total} safe   leak-rate={leak_rate:.1%}")
    if leaks:
        print("\n  LEAKS:")
        for r in leaks:
            print(f"   - [{r['suite']}] ch{r['boundary']}: {r['reason']}")
    print(f"\n  report: {out_path}")
    print("==================================================")
    # Hard gate: any leak → non-zero exit.
    sys.exit(1 if leaks else 0)


if __name__ == "__main__":
    main()
