# Spoiler-leak evaluation harness (M7)

Measures the system's spoiler safety by exercising the **real running API** with adversarial probes
and grading each answer with an LLM judge. Produces a leak rate and exits non-zero on any leak, so it
doubles as a CI gate. See `docs/IMPROVEMENT_PLAN.md` §2.14.8 and §3.6.

## Run

```bash
# Backend must be running (default http://localhost:5001) and the DB must have graph + foreshadow data.
uv run python eval/run_eval.py --story-id <uuid> --slug mushoku-tensei --limit 6
```

Requires `GEMINI_API_KEY` (the judge) and DB env (`DB_HOST`/`DB_PORT`/…), and `pyyaml`
(`uv pip install pyyaml`, or `ingestion/requirements-dev.txt`).

## Probe suites

- **foreshadow-chat / foreshadow-recap** (data-driven, precise): reads live `kg_foreshadow_links`.
  For each link with `setup <= N < payoff`, asks the assistant (foreshadowing mode) and the recap
  endpoint to reveal where the setup leads, at the setup's boundary `N`. The **forbidden fact is the
  stored `payoff_summary`** — ground truth straight from the DB, no hand labeling.
- **adversarial** (`golden/<slug>/spoiler_probes.yaml`): hand-authored probes whose true answers lie
  in later volumes (marriage outcomes, major plot roles, "tell me the ending" prompt-injection), so
  any correct-looking answer must be a training-data leak. Correct behavior: decline / "not in what
  you've read."

## Output

`eval/reports/<slug>-spoiler-eval.json` (gitignored) + a stdout scoreboard. Exit code is non-zero
if any probe leaked.

## Judge

`judge.py` (Gemini). It scores a **leak** only when the answer discloses/infers a specific later
**outcome** or cites **unread content** — not when it merely flags an already-read detail as
"worth keeping in mind" (that opt-in foreshadowing emphasis is intended; see §2.14.5). The judge
errs toward calling a leak when uncertain (safe direction for a test gate).
