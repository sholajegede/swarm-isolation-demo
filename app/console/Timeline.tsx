"use client";

import { useEffect, useRef } from "react";

export type RunEvent = {
  _id: string;
  workerLabel: string;
  kind: "worker_started" | "tool_call" | "allowed" | "denied" | "worker_finished" | "note";
  message: string;
  at: number;
};

/** A refusal reason, if the line is one, so it can be shown as a chip. */
function refusalOf(event: RunEvent): string | null {
  if (event.kind !== "denied") return null;
  const match = /refused:\s*([a-z_]+)/.exec(event.message);
  return match ? match[1] : "refused";
}

/** True when this line records a call that crossed a tenant boundary. */
function isCrossing(event: RunEvent): boolean {
  return event.kind === "allowed" && event.message.includes("CROSSED");
}

const KIND_LABEL: Record<RunEvent["kind"], string> = {
  worker_started: "start",
  tool_call: "call",
  allowed: "allow",
  denied: "deny",
  worker_finished: "done",
  note: "note",
};

export function Timeline({
  events,
  correlationId,
  running,
}: {
  events: RunEvent[];
  correlationId: string | null;
  running: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // Scroll the list itself rather than calling scrollIntoView, which walks up
  // and scrolls the page as well. While a run streams that moved the controls
  // out from under the pointer, so the kill switch could be missed.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [events.length]);

  if (!correlationId) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-dashed border-border-subtle p-8 text-center">
        <p className="max-w-xs text-sm text-muted">
          No run yet. Pick a tenant and start a swarm to watch its workers step
          through in real time.
        </p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-border-subtle p-8 text-center">
        <p className="text-sm text-muted">
          {running
            ? "Waiting for the first worker to report…"
            : "This run produced no events."}
        </p>
      </div>
    );
  }

  return (
    <ol
      ref={listRef}
      className="max-h-[28rem] overflow-y-auto rounded-lg border border-border-subtle bg-surface"
    >
      {events.map((event) => {
        const refusal = refusalOf(event);
        const crossing = isCrossing(event);

        return (
          <li
            key={event._id}
            className="arriving flex gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
          >
            <span className="w-20 shrink-0 font-mono text-xs text-muted">
              {event.workerLabel}
            </span>

            <span
              className={`w-12 shrink-0 font-mono text-xs ${
                refusal
                  ? "text-breach"
                  : crossing
                    ? "text-breach"
                    : event.kind === "allowed"
                      ? "text-ok"
                      : "text-muted"
              }`}
            >
              {KIND_LABEL[event.kind]}
            </span>

            <span className="min-w-0 flex-1 text-sm">
              <span className="break-words">{event.message}</span>

              {refusal ? (
                <span className="ml-2 inline-block rounded bg-breach-soft px-1.5 py-0.5 align-middle font-mono text-[11px] text-breach">
                  {refusal}
                </span>
              ) : null}

              {crossing ? (
                <span className="ml-2 inline-block rounded bg-breach-soft px-1.5 py-0.5 align-middle font-mono text-[11px] text-breach">
                  crossed tenant boundary
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
