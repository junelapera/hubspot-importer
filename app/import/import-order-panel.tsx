"use client";

import type { ImportOrderPlan } from "@/lib/mapping";

export function ImportOrderPanel({ plan }: { plan: ImportOrderPlan }) {
  const nodeByName = new Map(plan.nodes.map((n) => [n.name, n]));
  const displayOrder = plan.ok ? plan.order : plan.cycleBreakOrder;

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold">Import order</h2>
        <span className="text-xs text-muted-foreground">
          Foreign tables first — determined by the FK config on each mapping.
        </span>
        {plan.ok ? (
          <span className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            no cycles
          </span>
        ) : (
          <span className="ml-auto rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-800 dark:text-yellow-200">
            cycles — two-phase write
          </span>
        )}
      </header>

      <ol className="space-y-2">
        {displayOrder.map((name, i) => {
          const node = nodeByName.get(name);
          const deferredForNode = plan.deferred.filter((e) => e.from === name);
          return (
            <li key={name} className="flex items-baseline gap-3 text-sm">
              <span className="w-6 text-right font-mono text-xs text-muted-foreground">{i + 1}.</span>
              <div className="flex-1">
                <span className="font-medium">{name}</span>
                {node && node.dependencies.length > 0 ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    depends on {node.dependencies.map((d) => (
                      <code key={d} className="mr-1 rounded bg-muted px-1">{d}</code>
                    ))}
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-muted-foreground">(no dependencies)</span>
                )}
                {deferredForNode.length > 0 ? (
                  <span className="ml-2 text-xs text-yellow-800 dark:text-yellow-200">
                    · deferred edge to {deferredForNode.map((e) => (
                      <code key={e.to} className="mr-1 rounded bg-muted px-1">{e.to}</code>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {!plan.ok ? (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-800 dark:text-yellow-200 space-y-1">
          <p className="font-medium">Detected cycle{plan.cycles.length === 1 ? "" : "s"}:</p>
          <ul className="ml-4 list-disc">
            {plan.cycles.map((cycle, i) => (
              <li key={i}>
                {cycle.join(" → ")} → <em>{cycle[0]}</em>
              </li>
            ))}
          </ul>
          <p className="pt-1">
            {plan.deferred.length} FK edge{plan.deferred.length === 1 ? "" : "s"} will be deferred and PATCHed in after the main insert pass.
          </p>
        </div>
      ) : null}
    </section>
  );
}
