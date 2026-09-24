"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MappingState } from "@/lib/mapping";
import {
  nextCopyName,
  parseProfileExport,
  serializeProfileExport,
} from "@/lib/mapping-profile";

type Profile = {
  id: string;
  portalId: string;
  name: string;
  state: Record<string, MappingState>;
  createdAt: string;
  updatedAt: string;
};

type LoadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profiles: Profile[] };

type Action = null | { kind: "info" | "error"; message: string };

function slugFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

export function ProfilePanel({
  portalId,
  mappings,
  currentSourceNames,
  onLoad,
  onSelectionCleared,
}: {
  portalId: string;
  mappings: Record<string, MappingState>;
  currentSourceNames: string[];
  onLoad: (state: Record<string, MappingState>, profileId: string) => void;
  onSelectionCleared?: () => void;
}) {
  const [status, setStatus] = useState<LoadStatus>({ kind: "idle" });
  const [selected, setSelected] = useState<string>("");
  const [saveName, setSaveName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "duplicate" | "export" | "import">(null);
  const [action, setAction] = useState<Action>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!portalId) return;
    let cancelled = false;
    startTransition(() => setStatus({ kind: "loading" }));
    fetch(`/api/portals/${portalId}/mappings`)
      .then(async (res) => {
        const body = (await res.json()) as { profiles?: Profile[]; error?: string };
        if (cancelled) return;
        startTransition(() => {
          if (!res.ok) {
            setStatus({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
            return;
          }
          setStatus({ kind: "ready", profiles: body.profiles ?? [] });
        });
      })
      .catch((err) => {
        if (cancelled) return;
        startTransition(() => setStatus({ kind: "error", message: (err as Error).message }));
      });
    return () => {
      cancelled = true;
    };
  }, [portalId]);

  async function reload() {
    if (!portalId) return;
    const res = await fetch(`/api/portals/${portalId}/mappings`);
    const body = (await res.json()) as { profiles?: Profile[]; error?: string };
    if (!res.ok) {
      setStatus({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
      return;
    }
    setStatus({ kind: "ready", profiles: body.profiles ?? [] });
  }

  async function save() {
    const name = saveName.trim();
    if (!name) return;
    if (Object.keys(mappings).length === 0) {
      setAction({ kind: "error", message: "No mappings to save yet — configure at least one source table." });
      return;
    }
    setSaving(true);
    setAction(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, state: mappings }),
      });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok) {
        setAction({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setAction({ kind: "info", message: `Saved profile "${name}"` });
      setSaveName("");
      await reload();
      if (body.profile) setSelected(body.profile.id);
    } catch (err) {
      setAction({ kind: "error", message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function load() {
    if (status.kind !== "ready") return;
    const profile = status.profiles.find((p) => p.id === selected);
    if (!profile) {
      setAction({ kind: "error", message: "Select a profile first." });
      return;
    }
    onLoad(profile.state, profile.id);
    const savedSources = Object.keys(profile.state);
    const missing = currentSourceNames.length
      ? savedSources.filter((n) => !currentSourceNames.includes(n))
      : [];
    const message =
      missing.length > 0
        ? `Loaded "${profile.name}". Waiting for source table(s): ${missing.join(", ")}`
        : `Loaded "${profile.name}"`;
    setAction({ kind: "info", message });
  }

  async function duplicate() {
    if (status.kind !== "ready") return;
    const profile = status.profiles.find((p) => p.id === selected);
    if (!profile) {
      setAction({ kind: "error", message: "Select a profile first." });
      return;
    }
    setBusy("duplicate");
    setAction(null);
    try {
      const res = await fetch(`/api/mappings/${profile.id}/duplicate`, { method: "POST" });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok) {
        setAction({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      if (body.profile) {
        setAction({ kind: "info", message: `Duplicated as "${body.profile.name}"` });
        await reload();
        setSelected(body.profile.id);
      }
    } catch (err) {
      setAction({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function exportSelected() {
    if (status.kind !== "ready") return;
    const profile = status.profiles.find((p) => p.id === selected);
    if (!profile) {
      setAction({ kind: "error", message: "Select a profile first." });
      return;
    }
    setBusy("export");
    setAction(null);
    try {
      const wire = serializeProfileExport(profile.name, profile.state, new Date().toISOString());
      const blob = new Blob([JSON.stringify(wire, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugFilename(profile.name)}.hubdb-profile.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setAction({ kind: "info", message: `Exported "${profile.name}"` });
    } catch (err) {
      setAction({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function importFromFile(file: File) {
    setBusy("import");
    setAction(null);
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setAction({ kind: "error", message: `${file.name}: not valid JSON` });
        return;
      }
      const parsed = parseProfileExport(raw);
      if (!parsed.ok) {
        setAction({ kind: "error", message: `${file.name}: ${parsed.error}` });
        return;
      }
      const existingNames = status.kind === "ready" ? status.profiles.map((p) => p.name) : [];
      const collides = existingNames.includes(parsed.profile.name);
      const name = collides ? nextCopyName(parsed.profile.name, existingNames) : parsed.profile.name;
      const res = await fetch(`/api/portals/${portalId}/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, state: parsed.profile.state }),
      });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok) {
        setAction({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      const suffix = collides ? ` (renamed from "${parsed.profile.name}" — a profile by that name already exists)` : "";
      setAction({ kind: "info", message: `Imported as "${name}"${suffix}` });
      await reload();
      if (body.profile) setSelected(body.profile.id);
    } catch (err) {
      setAction({ kind: "error", message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (status.kind !== "ready") return;
    const profile = status.profiles.find((p) => p.id === selected);
    if (!profile) return;
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    try {
      const res = await fetch(`/api/mappings/${profile.id}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setAction({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setSelected("");
      onSelectionCleared?.();
      setAction({ kind: "info", message: `Deleted profile "${profile.name}"` });
      await reload();
    } catch (err) {
      setAction({ kind: "error", message: (err as Error).message });
    }
  }

  const profiles = status.kind === "ready" ? status.profiles : [];
  const hasMappings = Object.keys(mappings).length > 0;

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Mapping profile</h2>
        <span className="text-xs text-muted-foreground">
          {status.kind === "loading"
            ? "loading…"
            : status.kind === "error"
              ? `error: ${status.message}`
              : `${profiles.length} saved`}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-medium">Load existing</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={profiles.length === 0}
              className="min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">
                {profiles.length === 0 ? "no profiles yet" : "— pick a profile —"}
              </option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={load} disabled={!selected}>
              Load
            </Button>
            <Button variant="outline" size="sm" onClick={remove} disabled={!selected}>
              Delete
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium">Save current mapping as</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="profile name"
              disabled={saving}
              className="min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
            <Button size="sm" onClick={save} disabled={saving || !saveName.trim() || !hasMappings}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {!hasMappings ? (
            <p className="text-xs text-muted-foreground">
              Configure at least one source-table mapping before saving.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={duplicate}
          disabled={!selected || busy !== null}
        >
          {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportSelected}
          disabled={!selected || busy !== null}
        >
          {busy === "export" ? "Exporting…" : "Export JSON"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === "import" ? "Importing…" : "Import JSON…"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFromFile(file);
          }}
        />
      </div>

      {action ? (
        <p
          className={
            action.kind === "error"
              ? "text-xs text-destructive"
              : "text-xs text-emerald-700 dark:text-emerald-300"
          }
        >
          {action.message}
        </p>
      ) : null}
    </section>
  );
}
