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
        A swarm is a group of AI agents working at once. Give them one shared
        login for all your customers, and a single agent that misbehaves can
        reach every customer&rsquo;s data. Agents move faster than anyone can
        react, so by the time you notice, it has already been everywhere.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-surface p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-breach">
            Shared identity
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            Every agent carries the same credential. It belongs to no customer
            in particular, so nothing says no. One agent reads them all.
          </p>
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-ok">
            Identity per customer
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            Each agent carries a credential scoped to one customer. The same
            reach is refused at the boundary, recorded, and goes no further.
          </p>
        </div>
      </div>

      <p className="mt-10 text-base leading-relaxed">
        This is a working demo, not a mock-up. Real agents decide what to do,
        real tokens are issued per customer, and a real server decides what each
        call is allowed to touch. You can watch an agent reach across, and watch
        the same reach get stopped.
      </p>

      <p className="mt-4 text-base leading-relaxed">
        There is also an emergency stop. Suspend one customer and its agents die
        where they stand, while everyone else keeps working.
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
