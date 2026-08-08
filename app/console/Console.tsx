"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import { Timeline, type RunEvent } from "./Timeline";

type Mode = "shared" | "per-org";

const METRIC_HELP: Record<string, string> = {
  workers: "Agents that made one call or more.",
  "tool calls": "Reads and writes that the agents tried.",
  "cross-org attempts": "Calls that reached for another tenant's record.",
  blocked: "Calls that the server refused.",
  escapes: "Cross-tenant calls that the server permitted.",
};

function Metric({
  label,
  value,
  alarming,
  loading,
}: {
  label: string;
  value: number;
  alarming?: boolean;
  loading?: boolean;
}) {
  const alarmed = Boolean(alarming) && !loading && value > 0;

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        alarmed ? "border-breach bg-breach-soft" : "border-border-subtle bg-surface"
      }`}
      title={METRIC_HELP[label]}
    >
      {loading ? (
        <span
          className="block h-8 w-8 animate-pulse rounded bg-surface-muted"
          aria-hidden="true"
        />
      ) : (
        <p
          className={`font-mono text-2xl tabular-nums ${alarmed ? "text-breach" : ""}`}
        >
          {value}
        </p>
      )}
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  killed: "stopped by the kill switch",
};

export function Console() {
  const tenants = useQuery(api.public.tenants);
  const mode = useQuery(api.public.isolationMode);
  const setMode = useMutation(api.public.setIsolationMode);
  const suspend = useAction(api.public.suspendTenant);
  const unsuspend = useAction(api.public.unsuspendTenant);
  const reseed = useAction(api.public.reseed);

  const [chosenOrg, setChosenOrg] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived rather than stored: until someone picks a tenant, the first one is
  // selected. Nothing to synchronise, and no effect that writes state.
  const orgCode = chosenOrg ?? tenants?.[0]?.orgCode ?? null;

  const events = useQuery(
    api.public.runEvents,
    correlationId ? { correlationId } : "skip",
  );
  const metrics = useQuery(
    api.public.metrics,
    correlationId ? { correlationId } : "skip",
  );
  const audit = useQuery(api.public.recentAudit, { limit: 20 });
  const runState = useQuery(
    api.public.runStatus,
    correlationId ? { correlationId } : "skip",
  );

  const tenant = tenants?.find((t) => t.orgCode === orgCode) ?? null;
  const running = busy === "run";

  async function startRun() {
    if (!tenant || !tenants) return;
    setError(null);
    setBusy("run");
    try {
      const letter = tenant.name.replace(/[^ABC]/g, "").slice(-1) || "A";
      const response = await fetch("/api/swarm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant: letter }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "could not start the swarm");
      setCorrelationId(body.correlationId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      // The run continues in the background; the button only starts it.
      setTimeout(() => setBusy(null), 1500);
    }
  }

  async function toggleSuspension() {
    if (!tenant) return;
    setError(null);
    setBusy("kill");
    try {
      if (tenant.isSuspended) {
        await unsuspend({ orgCode: tenant.orgCode });
      } else {
        await suspend({ orgCode: tenant.orgCode });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  if (tenants === undefined || mode === undefined) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (tenants.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-lg font-semibold">No tenants yet</h1>
        <p className="mt-2 text-sm text-muted">
          Load the demo data with{" "}
          <code className="font-mono">npx convex run seed:seedDemo</code>.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Swarm console</h1>
        <button
          onClick={() => void reseed({})}
          className="font-mono text-xs text-muted underline underline-offset-4 hover:text-foreground"
        >
          reset demo data
        </button>
      </header>

      {/* The switch, front and centre: the one thing that changes the outcome. */}
      <section className="mt-6 rounded-xl border border-border-subtle bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-muted">
              Isolation mode
            </p>
            <p className="mt-1 text-sm text-muted">
              The server sets this mode. The browser and the agents cannot
              change it.
            </p>
          </div>

          <div
            role="group"
            aria-label="Isolation mode"
            className="flex rounded-lg border border-border-subtle p-1"
          >
            {(["shared", "per-org"] as Mode[]).map((option) => {
              const active = mode === option;
              return (
                <button
                  key={option}
                  onClick={() => void setMode({ mode: option })}
                  aria-pressed={active}
                  className={`rounded-md px-4 py-2 font-mono text-sm transition-colors ${
                    active
                      ? option === "shared"
                        ? "bg-breach-soft text-breach"
                        : "bg-ok-soft text-ok"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-4 text-sm">
          {mode === "shared" ? (
            <span className="text-breach">
              All the agents use one identity. That identity belongs to no
              tenant. Thus an agent can read the data of any tenant that it
              names.
            </span>
          ) : (
            <span className="text-ok">
              Each agent has an identity for one tenant only. If an agent reaches
              for a different tenant, the server refuses the call and records it.
            </span>
          )}
        </p>
      </section>

      {/* Tenant picker */}
      <section className="mt-6">
        <div className="flex flex-wrap gap-2">
          {tenants.map((t) => {
            const selected = t.orgCode === orgCode;
            return (
              <button
                key={t.orgCode}
                onClick={() => {
                  setChosenOrg(t.orgCode);
                  setCorrelationId(null);
                }}
                className={`rounded-lg border px-4 py-2 text-left transition-colors ${
                  selected
                    ? "border-accent bg-surface"
                    : "border-border-subtle bg-surface-muted hover:bg-surface"
                }`}
              >
                <span className="block text-sm font-medium">
                  {t.name}
                  {t.isSuspended ? (
                    <span className="ml-2 rounded bg-halt-soft px-1.5 py-0.5 font-mono text-[11px] text-halt">
                      suspended
                    </span>
                  ) : null}
                </span>
                <span className="block font-mono text-[11px] text-muted">
                  {t.orgCode}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Controls */}
      <section className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void startRun()}
          disabled={!tenant || running}
          className="rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {running ? "Starting…" : `Run swarm for ${tenant?.name ?? "…"}`}
        </button>

        <button
          onClick={() => void toggleSuspension()}
          disabled={!tenant || busy === "kill"}
          className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 ${
            tenant?.isSuspended
              ? "border-ok text-ok hover:bg-ok-soft"
              : "border-halt text-halt hover:bg-halt-soft"
          }`}
        >
          {tenant?.isSuspended
            ? `Lift suspension on ${tenant.name}`
            : `Kill switch: suspend ${tenant?.name ?? ""}`}
        </button>

        {correlationId ? (
          <span className="flex items-center gap-2 font-mono text-xs text-muted">
            run {correlationId.slice(0, 8)}
            {runState ? (
              <span
                className={`rounded px-1.5 py-0.5 ${
                  runState.status === "killed"
                    ? "bg-halt-soft text-halt"
                    : runState.status === "running"
                      ? "bg-surface-muted"
                      : "bg-ok-soft text-ok"
                }`}
              >
                {STATUS_TEXT[runState.status] ?? runState.status}
              </span>
            ) : null}
          </span>
        ) : null}
      </section>

      {error ? (
        <p className="mt-4 rounded-md border border-breach bg-breach-soft px-4 py-3 text-sm text-breach">
          {error}
        </p>
      ) : null}

      {/* Metrics */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(() => {
          // Undefined means the query is still in flight. Zero is a real
          // answer, and the two must not look the same.
          const loading = Boolean(correlationId) && metrics === undefined;
          return (
            <>
              <Metric label="workers" value={metrics?.workers ?? 0} loading={loading} />
              <Metric
                label="tool calls"
                value={metrics?.toolCalls ?? 0}
                loading={loading}
              />
              <Metric
                label="cross-org attempts"
                value={metrics?.crossOrgAttempts ?? 0}
                loading={loading}
              />
              <Metric label="blocked" value={metrics?.blocked ?? 0} loading={loading} />
              <Metric
                label="escapes"
                value={metrics?.escapes ?? 0}
                loading={loading}
                alarming
              />
            </>
          );
        })()}
      </section>

      {tenant?.isSuspended ? (
        <p className="mt-3 rounded-md border border-halt bg-halt-soft px-4 py-3 text-sm text-halt">
          <strong className="font-semibold">{tenant.name} is suspended.</strong>{" "}
          The server refuses all of its calls
          {metrics && metrics.stopped > 0
            ? `. It refused ${metrics.stopped} calls in this run`
            : ""}
          . The timeline stops here, because a suspended tenant cannot write
          data, and it cannot write its own log lines. The other tenants
          continue to operate.
        </p>
      ) : null}

      {metrics && metrics.escapes > 0 ? (
        <p className="mt-3 rounded-md border border-breach bg-breach-soft px-4 py-3 text-sm text-breach">
          The server permitted {metrics.escapes} call
          {metrics.escapes === 1 ? "" : "s"} that crossed a tenant boundary.
          Select per-org, then start the swarm again.
        </p>
      ) : null}

      {/* Live timeline */}
      <section className="mt-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">
          Live timeline
        </h2>
        <Timeline
          events={(events ?? []) as RunEvent[]}
          correlationId={correlationId}
          running={running}
        />
      </section>

      {/* Audit, secondary */}
      <section className="mt-8">
        <details className="rounded-lg border border-border-subtle bg-surface">
          <summary className="cursor-pointer px-4 py-3 font-mono text-xs uppercase tracking-widest text-muted">
            Audit trail — every decision, across all tenants
          </summary>
          <div className="max-h-72 overflow-y-auto border-t border-border-subtle">
            {(audit ?? []).map((row) => (
              <div
                key={row._id}
                className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-2 font-mono text-[11px] last:border-b-0"
              >
                <span
                  className={row.decision === "deny" ? "text-breach" : "text-ok"}
                >
                  {row.decision}
                </span>
                <span>{row.reason}</span>
                <span className="text-muted">{row.action}</span>
                <span className="text-muted">
                  {row.actorOrgCode}
                  {row.targetOrgCode && row.targetOrgCode !== row.actorOrgCode
                    ? ` → ${row.targetOrgCode}`
                    : ""}
                </span>
                <span className="ml-auto text-muted">
                  {row.correlationId.slice(0, 8)}
                </span>
              </div>
            ))}
            {(audit ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet.</p>
            ) : null}
          </div>
        </details>
      </section>
    </main>
  );
}
