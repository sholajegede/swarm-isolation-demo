import Link from "next/link";

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">
        Multi-tenant AI safety
      </p>

      <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        One agent goes wrong.
        <br />
        How far does it get?
      </h1>

      <p className="mt-6 text-lg leading-relaxed text-muted">
        A swarm is a group of AI agents that work at the same time. Each of your
        customers is a tenant. If you give the swarm one login for all the
        tenants, then one agent that goes wrong can read the data of every
        tenant. Agents work faster than a person can react. When you see the
        problem, the agent has already read everything.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-surface p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-breach">
            Shared identity
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            All the agents use the same credential. That credential belongs to
            no tenant. Thus nothing refuses the call, and one agent reads all
            the tenants.
          </p>
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-ok">
            Identity per tenant
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            Each agent uses a credential for one tenant only. The server refuses
            the same call at the boundary. It records the attempt. The agent
            gets no data.
          </p>
        </div>
      </div>

      <p className="mt-10 text-base leading-relaxed">
        This demo operates. It is not a mock-up. The agents decide their own
        actions. The identity service issues a token for each tenant. The server
        decides what each call can read. You can watch an agent reach for
        another tenant. Then you can watch the server stop the same call.
      </p>

      <p className="mt-4 text-base leading-relaxed">
        The demo also has an emergency stop. Suspend one tenant, and its agents
        stop immediately. The other tenants continue to operate.
      </p>

      <Link
        href="/console"
        className="mt-10 inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Open the console
        <span aria-hidden="true">&rarr;</span>
      </Link>

      <p className="mt-4 font-mono text-xs text-muted">
        Three beats to try: leak, contain, kill.
      </p>
    </main>
  );
}
