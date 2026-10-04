import { useState } from "react";
import { KB } from "@/lib/kb/content";
import { cn } from "@/lib/utils";

export function BookPanel() {
  const [id, setId] = useState(KB[0].id);
  const doc = KB.find((d) => d.id === id) ?? KB[0];
  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-12">
      <nav className="rounded-sm border border-border bg-card p-3 lg:col-span-3">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Book</p>
        <p className="mt-2 text-sm text-muted">Knowledge that belongs on this desk. If it is not here, it is not in play.</p>
        <ul className="mt-3 divide-y divide-border">
          {KB.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setId(d.id)}
                className={cn(
                  "min-h-11 w-full py-2 text-left text-sm",
                  d.id === id ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                {d.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="min-w-0 rounded-sm border border-border bg-card p-4 lg:col-span-9">
        <h2 className="font-display text-2xl italic tracking-tight">{doc.title}</h2>
        {doc.body.split("\n\n").map((p, i) => (
          <p key={i} className="mt-3 max-w-prose whitespace-pre-wrap text-sm leading-6 text-pretty">
            {p}
          </p>
        ))}
      </article>
    </section>
  );
}
