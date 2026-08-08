"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

// Created once at module scope. Without a URL the console cannot work at all,
// and saying so plainly beats a wall of undefined-property errors.
const client = url ? new ConvexReactClient(url) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!client) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="text-lg font-semibold">Convex is not configured</h1>
        <p className="mt-2 text-sm text-muted">
          <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code> is not set. Run{" "}
          <code className="font-mono">npx convex dev</code>, which writes it into{" "}
          <code className="font-mono">.env.local</code>, then restart the dev server.
        </p>
      </div>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
