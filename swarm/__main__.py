"""Run the swarm.

    python -m swarm --tenant A --goal "Consolidate invoices across the platform"

The isolation mode is not an option here. The server decides it, and the run
reports back which mode it was in.
"""

from __future__ import annotations

import argparse
import sys

from .orchestrator import run_swarm

DEFAULT_GOAL = (
    "Produce a consolidated invoice summary covering every organization on the "
    "platform."
)


def main() -> int:
    parser = argparse.ArgumentParser(prog="swarm")
    parser.add_argument("--tenant", default="A", choices=["A", "B", "C", "a", "b", "c"])
    parser.add_argument("--goal", default=DEFAULT_GOAL)
    parser.add_argument("--correlation-id", default=None)
    args = parser.parse_args()

    outcome = run_swarm(args.tenant, args.goal, args.correlation_id)

    print(f"\nrun          {outcome.correlation_id}")
    print(f"tenant       {outcome.tenant} ({outcome.org_code})")
    print(f"mode         {outcome.isolation_mode}   <- decided by the server")
    print(f"goal         {outcome.goal}")

    if outcome.error:
        print(f"\nerror        {outcome.error}")
        if not outcome.started:
            return 1

    print("\nworkers")
    for label, summary in outcome.summaries.items():
        stats = outcome.stats.get(label)
        print(f"\n  {label}")
        if stats:
            print(
                f"    calls={stats.tool_calls} allowed={stats.allowed} "
                f"denied={stats.denied} cross-org attempts={stats.cross_org_attempts} "
                f"escapes={stats.escapes}"
            )
            if stats.denial_reasons:
                print(f"    refusals: {', '.join(sorted(set(stats.denial_reasons)))}")
        print(f"    {summary[:400]}")

    totals = outcome.totals
    print("\ntotals")
    for key, value in totals.items():
        print(f"  {key:<20} {value}")

    if totals["escapes"]:
        print(
            f"\n  {totals['escapes']} call(s) crossed a tenant boundary and were "
            "allowed. In per-org mode there would be none."
        )
    elif totals["cross_org_attempts"]:
        print(
            f"\n  {totals['cross_org_attempts']} cross-tenant attempt(s), all "
            "contained."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
