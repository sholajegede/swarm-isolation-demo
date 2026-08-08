import { NextResponse } from "next/server";

import { configStatus, serverEnv } from "@/lib/env";

// Read the environment per request, not at build time.
export const dynamic = "force-dynamic";

export function GET() {
  const env = serverEnv();

  return NextResponse.json({
    status: "ok",
    // The mode the server decided. Reported so an operator can confirm which
    // half of the demo a deployment is in - callers cannot change it.
    isolationMode: env.isolationMode,
    configured: configStatus(env),
    time: new Date().toISOString(),
  });
}
