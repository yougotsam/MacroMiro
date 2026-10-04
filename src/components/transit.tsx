import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Nfc, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CARDS, PROTOCOLS, type Region } from "@/lib/transit/cards";
import { decodeClassicUid } from "@/lib/transit/decode";
import { nfcAvailable, scanOnce, type NfcHit } from "@/lib/transit/nfc";
import { parseDump, type DumpCard } from "@/lib/transit/parse";
import { cn } from "@/lib/utils";

const REGIONS: { id: Region | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "americas", label: "Americas" },
  { id: "europe", label: "Europe" },
  { id: "asia", label: "Asia" },
  { id: "oceania", label: "Oceania" },
  { id: "cis", label: "CIS" },
];

export function TransitPanel() {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState<Region | "all">("americas");
  const [nfc, setNfc] = useState<NfcHit | null>(null);
  const [nfcErr, setNfcErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [dumps, setDumps] = useState<DumpCard[]>([]);
  const [dumpErr, setDumpErr] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [canNfc, setCanNfc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanNfc(nfcAvailable());
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CARDS.filter((c) => {
      if (region !== "all" && c.region !== region && c.region !== "world") return false;
      if (!needle) return true;
      return `${c.name} ${c.where} ${c.media}`.toLowerCase().includes(needle);
    });
  }, [q, region]);

  async function scan() {
    setScanning(true);
    setNfcErr(null);
    try {
      const hit = await scanOnce();
      setNfc(hit);
    } catch (e) {
      setNfcErr(e instanceof Error ? e.message : "NFC failed");
    } finally {
      setScanning(false);
    }
  }

  function onFile(file: File) {
    setDumpErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text =
          typeof reader.result === "string"
            ? reader.result
            : arrayBufferToHex(reader.result as ArrayBuffer);
        setDumps(parseDump(text));
      } catch (e) {
        setDumpErr(e instanceof Error ? e.message : "Import failed");
      }
    };
    if (file.name.match(/\.(mfc|mfd|bin|dump)$/i)) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  const nfcDecoded = nfc ? decodeClassicUid(nfc.serial) : null;

  return (
    <div className="grid gap-4 px-4 py-5 sm:px-6 md:grid-cols-12 lg:px-8 md:py-6">
      <section className="md:col-span-4 min-w-0 rounded-md border border-border bg-card p-4 md:p-6">
        <p className="font-mono text-xs tracking-[0.18em] text-subtle uppercase">Metrodroid</p>
        <h2 className="mt-1 font-display text-3xl italic tracking-tight">Tap</h2>
        <p className="mt-2 text-sm leading-normal text-pretty text-muted">
          Scan on Android Chrome, or import a dump from{" "}
          <a
            className="inline-flex min-h-11 items-center underline"
            href="https://github.com/metrodroid/metrodroid"
            target="_blank"
            rel="noreferrer"
          >
            Metrodroid
          </a>
          .
        </p>

        <div className="mt-5 grid gap-2">
          <Button onClick={() => void scan()} disabled={!canNfc || scanning}>
            <Nfc className="size-4" /> {scanning ? "Hold the card…" : canNfc ? "Scan with NFC" : "NFC not in this browser"}
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Import Metrodroid dump
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.json,.mfc,.mfd,.bin,.dump,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <textarea
            className="mt-2 min-h-24 w-full rounded-[var(--radius-sm)] border border-border bg-bg px-3 py-2 font-mono text-base text-fg"
            placeholder="Or paste Farebot XML / JSON / hex"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <Button
            variant="ghost"
            disabled={!paste.trim()}
            onClick={() => {
              setDumpErr(null);
              try {
                setDumps(parseDump(paste));
              } catch (e) {
                setDumpErr(e instanceof Error ? e.message : "Paste failed");
              }
            }}
          >
            Parse paste
          </Button>
        </div>
        {!canNfc ? (
          <p className="mt-3 text-sm text-muted">NFC is Chrome on Android. Import a dump otherwise.</p>
        ) : null}
        {nfcErr ? <p className="mt-3 text-sm text-down">{nfcErr}</p> : null}
        {dumpErr ? <p className="mt-3 text-sm text-down">{dumpErr}</p> : null}

        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-subtle">Protocols Metrodroid speaks</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {PROTOCOLS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="md:col-span-4 min-w-0 rounded-md border border-border bg-card p-4 md:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Last read</h2>
          {nfc || dumps.length ? <Badge tone="armed">live</Badge> : <Badge>empty</Badge>}
        </div>

        {nfc ? (
          <article className="mt-4 rounded-[var(--radius-md)] border border-border bg-bg p-4">
            <p className="font-display text-2xl italic tracking-tight">Tag {nfc.serial || "no UID"}</p>
            <p className="mt-1 font-mono text-xs text-subtle">{nfc.at}</p>
            {nfcDecoded
              ? nfcDecoded.fields.map((f) => (
                  <p key={f.label} className="mt-2 text-sm">
                    <span className="text-subtle">{f.label} · </span>
                    {f.value}
                  </p>
                ))
              : null}
            {nfc.records.length ? (
              <ul className="mt-3 space-y-1 font-mono text-xs text-muted">
                {nfc.records.map((r, i) => (
                  <li key={i}>
                    {r.recordType}: {r.text.slice(0, 120)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">{nfcDecoded?.note}</p>
            )}
          </article>
        ) : null}

        {dumps.map((d, i) => (
          <article key={`${d.id}-${i}`} className="mt-4 rounded-[var(--radius-md)] border border-border bg-bg p-4">
            <p className="font-display text-2xl italic tracking-tight">{d.decoded?.system ?? d.type}</p>
            <p className="mt-1 font-mono text-xs text-subtle">
              {d.type} · {d.id || "no uid"}
            </p>
            {d.decoded?.fields.map((f) => (
              <p key={f.label} className="mt-2 text-sm">
                <span className="text-subtle">{f.label} · </span>
                <span className="font-mono tabular-nums">{f.value}</span>
              </p>
            ))}
            {d.decoded?.note ? <p className="mt-3 text-sm text-muted text-pretty">{d.decoded.note}</p> : null}
            {d.sectors.length ? (
              <p className="mt-2 font-mono text-xs text-subtle">{d.sectors.length} sectors in dump</p>
            ) : null}
          </article>
        ))}

        {!nfc && dumps.length === 0 ? (
          <p className="mt-6 text-sm text-muted">
            Nothing on the glass. Scan on Android, or drop a Farebot-Export.xml / JSON / .mfc from
            Metrodroid. We do not invent a balance.
          </p>
        ) : null}
      </section>

      <section className="md:col-span-4 min-w-0 rounded-md border border-border bg-card p-4 md:p-6">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted" />
          <h2 className="text-sm font-medium">Atlas</h2>
          <span className="font-mono text-xs text-subtle">{filtered.length}</span>
        </div>
        <Input
          className="mt-3"
          placeholder="Clipper, TAP, Oyster…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-1">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRegion(r.id)}
              className={cn(
                "min-h-11 min-w-11 px-3 text-sm rounded-[var(--radius-sm)]",
                region === r.id ? "bg-accent text-accent-foreground" : "text-muted hover:bg-surface-2",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <ul className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {filtered.map((c) => (
            <li key={`${c.name}-${c.where}`} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{c.name}</p>
                {c.keys ? <Badge tone="down">keys</Badge> : null}
                {c.ios ? <Badge>iOS</Badge> : null}
                {c.idOnly ? <Badge tone="paper">id only</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                {c.where} · {c.media}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-subtle text-pretty">
          Card list from Metrodroid 3.1.0 README (GPL-3). Based on Farebot by Eric Butler. Not affiliated
          with any agency.
        </p>
      </section>
    </div>
  );
}

function arrayBufferToHex(buf: ArrayBuffer) {
  const u = new Uint8Array(buf);
  let s = "";
  for (const b of u) s += b.toString(16).padStart(2, "0");
  return s;
}
