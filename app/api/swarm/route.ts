import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Assembled from segments rather than written out.
 *
 * A literal interpreter path in this file is picked up by the bundler as a file
 * reference and resolved at build time, which fails: `.venv/bin/python` is a
 * symlink pointing outside the project. Joining the segments keeps it an
 * ordinary runtime string.
 */
const DEFAULT_PYTHON = [".venv", "bin", "python"].join("/");

/**
 * Start a swarm run.
 *
 * The swarm is a Python service, so the console launches it as a process and
 * returns immediately with the correlation id. Everything after that reaches
 * the browser through Convex, as the workers write it.
 *
 * This runs the console's own machine, which is why the demo is meant to be run
 * locally. Nothing here touches tenant data: the workers still authenticate to
 * Kinde for themselves and are still judged by the seam.
 */
export async function POST(request: Request) {
  let body: { tenant?: string; goal?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }

  const tenant = String(body.tenant ?? "").toUpperCase();
  if (!["A", "B", "C"].includes(tenant)) {
    return NextResponse.json({ error: "unknown tenant" }, { status: 400 });
  }

  const python = process.env.SWARM_PYTHON ?? DEFAULT_PYTHON;

  const correlationId = randomUUID();
  const args = ["-m", "swarm", "--tenant", tenant, "--correlation-id", correlationId];
  if (typeof body.goal === "string" && body.goal.trim()) {
    args.push("--goal", body.goal.trim());
  }

  const child = spawn(python, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "ignore", "pipe"],
    // Two runs may be started from the console at once, and the model account
    // allows only a few requests in flight.
    env: { ...process.env, KIMI_MAX_CONCURRENCY: "2" },
  });

  // A missing interpreter surfaces here rather than as an unhandled crash.
  let failure: string | null = null;
  child.on("error", (error) => {
    failure = `could not start the swarm process (${python}): ${error.message}`;
    console.error(failure);
  });

  // Detach so the response is not held open for the length of the run.
  child.unref();

  // Give a failing spawn a moment to report itself before answering.
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (failure) {
    return NextResponse.json(
      {
        error:
          "The Python environment is missing. Run: python3 -m venv .venv && ./.venv/bin/pip install -r swarm/requirements.txt",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ correlationId, tenant });
}
