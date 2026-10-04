import { Link, createFileRoute } from "@tanstack/react-router";
import { TransitPanel } from "@/components/transit";

export const Route = createFileRoute("/tap")({
  component: TapPage,
});

function TapPage() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-end justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Envelope</p>
          <h1 className="font-display text-2xl italic">TAP</h1>
        </div>
        <Link to="/" className="flex h-11 items-center text-sm text-muted hover:text-fg">
          Back to desk
        </Link>
      </header>
      <TransitPanel />
    </div>
  );
}
