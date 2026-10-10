import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, Radio, RefreshCw, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrokerPanel, CalendarCompact, CatalystRadar, InboxCompact, liveAnalog } from "@/components/desk-panels";
import { PerpCockpit } from "@/components/PerpCockpit";
import { SwarmPanel } from "@/components/swarm-panel";
import { LoopPanel } from "@/components/loop";
import { Fail, Quiet } from "@/components/fail";
import type { Opinion, PlayId } from "@/lib/envelope/opinion";
import { savePaper } from "@/lib/envelope/paper";
import { CLIP_CHOICES, CLIP_USD, DAILY_STOP_USD, START_CASH, clampClip, notional } from "@/lib/envelope/clip";
import { BOOK_LABEL, type BookScan } from "@/lib/envelope/board";
import { ScanBoard } from "@/components/scan-board";
import { loadGraph, remember } from "@/lib/envelope/graph";
import { runPulse, type Pulse } from "@/lib/envelope/pulse";
import { markYes, type UpDownRound } from "@/lib/scan/updown";
import { candlePath, DEFAULT_TAPE, readTape, type TapeSettings } from "@/lib/live/indicators";
import { TFS, type TfId } from "@/lib/live/tf";
import type { AnalogLive } from "@/lib/live/empirical";
import type { BookId, DeskPayload, Tape } from "@/lib/live/types";
import type { BrokerChoice } from "@/lib/printgate/broker";
import type { Fill } from "@/lib/printgate/engine";
import type { ScanPayload, ScanRow } from "@/lib/scan/types";
import { EtClock } from "@/components/et-clock";
import { cn } from "@/lib/utils";

type Tab = "floor" | "scan" | "print" | "book" | "perps" | "swarm";

const TABS: { id: Tab; label: string; title: string; line: string }[] = [
  { id: "floor", label: "Desk", title: "Desk", line: "Chart, the open ticket, and the last decision." },
  { id: "print", label: "News", title: "News", line: "Calendar and Spark. A note. Not an order." },
  { id: "swarm", label: "Swarm", title: "Swarm", line: "MiroFish. A crowd read. Not an order." },
  { id: "perps", label: "Perps", title: "Perps", line: "Kalshi margin. Own cash." },
];

type Position = {
  book: BookId;
  side: "long" | "short";
  entry: number;
  sizeUsd: number;
  opened: string;
  play: PlayId;
  venue?: "spot" | "poly5m" | "kalshi15m";
  ticker?: string;
  leg?: "up" | "down";
  slug?: string;
  beat?: number;
  slotEnd?: number;
  chip?: string;
  yes?: number;
};

type LedgerRow = {
  id: string;
  ts: string;
  play: PlayId;
  note: string;
  delta: number;
};

const BOOKS: { id: BookId; label: string }[] = [
  { id: "btc", label: "BTC" },
  { id: "eth", label: "ETH" },
  { id: "sol", label: "SOL" },
  { id: "xrp", label: "XRP" },
  { id: "gold", label: "Gold" },
];

const START = START_CASH;

type HeartPayload = {
  cash?: number;
  pos?: Position | null;
  positions?: Position[];
  ledger?: LedgerRow[];
  armed?: boolean;
  lastNote?: string;
  lastTick?: string | null;
  ticks?: number;
  board?: BookScan[];
  clipUsd?: number;
  round?: UpDownRound | null;
  live?: boolean;
  begun?: boolean;
  dayLoss?: number;
};

export function Envelope({ initialBegun = false }: { initialBegun?: boolean }) {
  const [tab, setTab] = useState<Tab>("floor");
  const [brokerId, setBrokerId] = useState<BrokerChoice["id"]>("paper");
  const [book, setBook] = useState<BookId>("btc");
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [opinion, setOpinion] = useState<Opinion | null>(null);
  const [cash, setCash] = useState<number | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [fcLive, setFcLive] = useState(false);
  const [scan, setScan] = useState<ScanPayload | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [armed, setArmed] = useState(false);
  const [tf, setTf] = useState<TfId>("5m");
  const [settings, setSettings] = useState<TapeSettings>(DEFAULT_TAPE);
  const [clipUsd, setClipUsd] = useState(CLIP_USD);
  const [rawTape, setRawTape] = useState<Tape | null>(null);
  const [gear, setGear] = useState(false);
  const [showLoop, setShowLoop] = useState(false);
  const [heartNote, setHeartNote] = useState("idle");
  const [heartTick, setHeartTick] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [board, setBoard] = useState<BookScan[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [round, setRound] = useState<UpDownRound | null>(null);
  const [liveKalshi, setLiveKalshi] = useState(false);
  const [begun, setBegun] = useState(initialBegun);
  const [dayLoss, setDayLoss] = useState(0);
  const [tapeKey, setTapeKey] = useState(0);
  const deskSig = useRef("");
  const scanSig = useRef("");
  const heartSig = useRef("");
  const wantBegin = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem("envelope.begun") === "1") {
        setBegun(true);
        setArmed(true);
      }
    } catch {
      /* private window */
    }
  }, []);

  const applyHeart = useCallback((h: HeartPayload) => {
    if (wantBegin.current != null) {
      if (h.begun === wantBegin.current) wantBegin.current = null;
      else h = { ...h, begun: wantBegin.current, armed: wantBegin.current };
    }
    const sig = JSON.stringify({
      a: h.armed,
      begun: h.begun,
      c: h.cash,
      n: h.lastNote,
      p: h.positions ?? h.pos,
      lid: h.ledger?.[0]?.id ?? null,
      b: (h.board ?? []).map((x) => `${x.book}:${x.n}:${x.auto}:${x.last}`),
      clip: h.clipUsd,
      r: h.round ? `${h.round.slug}:${h.round.leftSec}:${h.round.up}:${h.round.take}` : "",
      live: h.live,
      loss: h.dayLoss,
    });
    if (sig === heartSig.current) return;
    heartSig.current = sig;
    if (typeof h.cash === "number") setCash(h.cash);
    if (h.positions) {
      setPositions(h.positions);
      setPos(h.positions[0] ?? null);
    } else if (h.pos !== undefined) {
      setPos(h.pos ?? null);
      setPositions(h.pos ? [h.pos] : []);
    }
    if (h.ledger) setLedger(h.ledger);
    if (h.armed != null) setArmed(h.armed);
    if (h.lastNote) setHeartNote(h.lastNote);
    if (h.lastTick) setHeartTick(h.lastTick);
    if (h.board) setBoard(h.board);
    if (h.clipUsd) setClipUsd(clampClip(h.clipUsd));
    if (h.round !== undefined) setRound(h.round ?? null);
    if (h.live != null) setLiveKalshi(h.live);
    if (typeof h.dayLoss === "number") setDayLoss(h.dayLoss);
    if (h.begun != null) {
      setBegun(h.begun);
      try {
        sessionStorage.setItem("envelope.begun", h.begun ? "1" : "0");
      } catch {
        /* private window */
      }
    }
  }, []);

  useEffect(() => {
    let gone = false;
    void fetch("/api/live/heart")
      .then((r) => r.json())
      .then((h: HeartPayload) => {
        if (gone) return;
        if (h && typeof h.cash === "number") {
          applyHeart(h);
        }
        setHydrated(true);
      })
      .catch(() => {
        setHydrated(true);
      });
    return () => {
      gone = true;
    };
  }, [applyHeart]);

  useEffect(() => {
    if (!hydrated) return;
    if (cash == null) return;
    savePaper({ cash, pos, ledger, book, brokerId, armed, tf, settings, clipUsd });
  }, [hydrated, cash, pos, ledger, book, brokerId, armed, tf, settings, clipUsd]);

  const load = useCallback(async (fresh = false, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const res = await fetch(fresh ? "/api/live/desk?fresh=1" : "/api/live/desk");
      if (!res.ok) throw new Error(`desk ${res.status}`);
      const data = (await res.json()) as DeskPayload;
      if ("error" in data && !("snapshot" in data)) throw new Error(String((data as { error: string }).error));
      const sig = `${data.asOf}|${data.snapshot.btc}|${data.snapshot.sol}|${data.snapshot.gold}|${data.snapshot.es}|${data.snapshot.oil}`;
      if (sig !== deskSig.current) {
        deskSig.current = sig;
        setDesk(data);
      }
      if (fresh) {
        deskSig.current = "";
        setTapeKey((n) => n + 1);
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "desk failed");
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const [fc, sc] = await Promise.all([
        fetch("/api/firecrawl/pull").then((r) => r.json() as Promise<{ live?: boolean }>),
        fetch("/api/live/scan").then((r) => r.json() as Promise<ScanPayload>),
      ]);
      setFcLive(!!fc.live);
      if (sc && "rows" in sc) {
        const sig = `${sc.asOf ?? ""}|${sc.scanN}|${sc.rows?.[0]?.market ?? ""}`;
        if (sig !== scanSig.current) {
          scanSig.current = sig;
          setScan(sc);
        }
      }
    } catch {
      /* chrome meta is optional */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMeta();
    const a = setInterval(() => {
      if (document.hidden) return;
      void load(false, true);
    }, 120_000);
    const b = setInterval(() => {
      if (document.hidden) return;
      void loadMeta();
    }, 180_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load, loadMeta]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void fetch("/api/live/heart")
        .then((r) => r.json())
        .then((h: HeartPayload) => {
          if (typeof h.cash !== "number") return;
          applyHeart(h);
        })
        .catch(() => {
          /* next */
        });
    }, 30_000);
    return () => clearInterval(id);
  }, [applyHeart]);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)
        return;
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) setTab(TABS[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let gone = false;
    const pull = () => {
      void fetch(`/api/live/tape?book=${book}&tf=${tf}`)
        .then((r) => r.json() as Promise<Tape>)
        .then((t) => {
          if (gone || !t?.bars?.length) return;
          setRawTape((prev) => {
            const prevLast = prev?.bars.at(-1)?.c;
            const nextLast = t.bars.at(-1)?.c;
            if (prev && prev.book === t.book && prev.bars.length === t.bars.length && prevLast === nextLast && prev.last === t.last) return prev;
            return t;
          });
        })
        .catch(() => {
          /* keep last */
        });
    };
    pull();
    const id = setInterval(pull, 15_000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, [book, tf, tapeKey]);

  const baseTape = rawTape && rawTape.book === book ? rawTape : desk?.tapes[book] ?? null;
  const tape = useMemo(() => {
    if (!baseTape) return null;
    return readTape(
      baseTape.book,
      baseTape.symbol,
      baseTape.venue,
      baseTape.bars,
      baseTape.last,
      baseTape.changePct,
      baseTape.asOf,
      settings,
    );
  }, [baseTape, settings]);

  const last = tape?.last ?? 0;
  const unreal = useMemo(() => {
    if (!positions.length) {
      if (!pos) return 0;
      if ((pos.venue === "poly5m" || pos.venue === "kalshi15m") && round) {
        const nowYes = pos.leg === "down" ? round.down : round.up;
        return markYes(pos.sizeUsd, pos.yes ?? pos.entry, nowYes);
      }
      return last ? Number((((pos.side === "long" ? 1 : -1) * (last - pos.entry)) / pos.entry * notional(pos.book, pos.sizeUsd)).toFixed(2)) : 0;
    }
    return positions.reduce((a, p) => {
      if ((p.venue === "poly5m" || p.venue === "kalshi15m") && round) {
        const nowYes = p.leg === "down" ? round.down : round.up;
        return a + markYes(p.sizeUsd, p.yes ?? p.entry, nowYes);
      }
      const px = p.book === book && last ? last : desk?.tapes[p.book]?.last ?? p.entry;
      return a + ((p.side === "long" ? 1 : -1) * (px - p.entry)) / p.entry * notional(p.book, p.sizeUsd);
    }, 0);
  }, [positions, pos, last, book, desk, round]);
  const locked = positions.reduce((a, p) => a + (p.venue === "poly5m" || p.venue === "kalshi15m" ? p.sizeUsd : 0), 0);
  const equity = (cash ?? 0) + locked + unreal;
  const dead = liveKalshi ? (cash ?? 0) <= 8 : equity <= 0 || (cash ?? START) <= START - DAILY_STOP_USD;
  const view = TABS.find((t) => t.id === tab) ?? TABS[0];
  const dayPnl = ledger.reduce((a, r) => a + r.delta, 0);
  const pulse = desk && tape ? runPulse({ desk, tape, scan, cash: cash ?? 0, dayPnl, clipUsd, ledger }) : null;
  const sit = pulse ? pulse.action !== "scalp" : opinion?.pick.id === "sit";

  async function ask() {
    setAsking(true);
    try {
      const res = await fetch("/api/live/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book }),
      });
      const data = (await res.json()) as Opinion;
      setOpinion(data);
    } finally {
      setAsking(false);
    }
  }

  function flatten(reason: string) {
    if (!pos) return;
    const delta = Number(unreal.toFixed(2));
    setCash((c) => Number(((c ?? 0) + delta).toFixed(2)));
    setLedger((rows) =>
      [
        {
          id: `${Date.now()}`,
          ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          play: pos.play,
          note: reason,
          delta,
        },
        ...rows,
      ].slice(0, 16),
    );
    setPos(null);
    if (delta !== 0) {
      remember(loadGraph(), {
        thesis: `${pos.side} ${pos.book} · ${reason}`,
        result: delta >= 0 ? "pass" : "fail",
        pnl: delta,
        source: "paper",
      });
    }
    void fetch("/api/live/heart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flatten: pos.book }),
    })
      .then((r) => r.json())
      .then((h: HeartPayload) => applyHeart(h))
      .catch(() => {
        /* next */
      });
  }

  function take(play: PlayId) {
    if (!tape || !desk) return;
    if (play === "sit") {
      if (pos) flatten("Sat. Flattened to cash.");
      else {
        setLedger((rows) =>
          [
            {
              id: `${Date.now()}`,
              ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
              play,
              note: opinion?.pick.why ?? "Sat. Cash unchanged.",
              delta: 0,
            },
            ...rows,
          ].slice(0, 16),
        );
      }
      return;
    }
    if (play === "event") {
      setLedger((rows) =>
        [
          {
            id: `${Date.now()}`,
            ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            play,
            note: "Event is the Gate. Type the official print. Not a 15m.",
            delta: 0,
          },
          ...rows,
        ].slice(0, 16),
      );
      setTab("print");
      return;
    }
    if (brokerId !== "paper") {
      setLedger((rows) =>
        [
          {
            id: `${Date.now()}`,
            ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            play,
            note: `${brokerId} not wired. Staying on paper.`,
            delta: 0,
          },
          ...rows,
        ].slice(0, 16),
      );
      return;
    }
    if (pos) flatten("Rolled prior paper.");
    const size = pulse?.sizeUsd || opinion?.sizeUsd || clipUsd;
    const side = pulse?.side ?? (tape.stacked === "short" ? "short" : "long");
    setPos({
      book,
      side,
      entry: tape.last,
      sizeUsd: size,
      opened: new Date().toISOString(),
      play,
    });
    setLedger((rows) =>
      [
        {
          id: `${Date.now()}`,
          ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          play,
          note: `${armed ? "Pulse auto · " : ""}Paper ${side.toUpperCase()} ${tape.symbol} @ ${fmt(tape.last, book)} · $${size} · ${tf} ${tape.venue}`,
          delta: 0,
        },
        ...rows,
      ].slice(0, 16),
    );
  }

  function paperAt(nextBook: BookId, side: "long" | "short", sizeUsd: number, note: string, play: PlayId = "scalp") {
    if (!desk) return;
    if (pos) flatten("Rolled prior paper.");
    const t = desk.tapes[nextBook];
    const px = nextBook === book && tape ? tape.last : t.last;
    setBook(nextBook);
    setPos({
      book: nextBook,
      side,
      entry: px,
      sizeUsd,
      opened: new Date().toISOString(),
      play,
    });
    setLedger((rows) =>
      [
        {
          id: `${Date.now()}`,
          ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          play,
          note,
          delta: 0,
        },
        ...rows,
      ].slice(0, 16),
    );
  }

  function paperFill(fill: Fill) {
    const next: BookId =
      fill.instrument === "CL"
        ? "oil"
        : fill.instrument === "ES"
          ? "es"
          : fill.instrument === "BTC"
            ? "btc"
            : fill.instrument === "SOL"
              ? "sol"
              : "gold";
    paperAt(next, fill.side, clipUsd, `Gate ${fill.side.toUpperCase()} ${fill.instrument} @ ${fill.price} · ${fill.reason}`, "event");
    setTab("floor");
  }

  function paperScan(row: ScanRow) {
    const meme = row.venue === "solana" && !/^(SOL|JUP)\//i.test(row.market) && !/SOLUSDT|SOL 1|SOL-USD/i.test(row.market);
    if (meme) {
      setLedger((rows) =>
        [
          {
            id: `${Date.now()}`,
            ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            play: "scalp" as PlayId,
            note: `DEX intent $${row.sizeUsd || clipUsd} · ${row.market} · no meme book · Open the pair. Not a fill.`,
            delta: 0,
          },
          ...rows,
        ].slice(0, 16),
      );
      return;
    }
    if (!desk) return;
    const next: BookId = /gold|GC=F/i.test(row.market)
      ? "gold"
      : /silver|SI=F/i.test(row.market)
        ? "silver"
        : /oil|WTI|CL=F/i.test(row.market)
          ? "oil"
          : /ES=F|S&P|SPX/i.test(row.market)
            ? "es"
            : /eth|ethereum/i.test(row.market)
              ? "eth"
              : /sol/i.test(row.market) || row.venue === "jupiter"
                ? "sol"
                : /btc|bitcoin/i.test(row.market)
                  ? "btc"
                  : book;
    const t = next === book && tape ? tape : desk.tapes[next];
    const side = t.stacked === "short" ? "short" : "long";
    const size = row.sizeUsd || clipUsd;
    paperAt(next, side, size, `Scan paper ${side.toUpperCase()} ${next} $${size} · ${row.market.slice(0, 72)}`, "scalp");
    setTab("floor");
  }

  function setBegin(next: boolean) {
    wantBegin.current = next;
    setBegun(next);
    setArmed(next);
    try {
      sessionStorage.setItem("envelope.begun", next ? "1" : "0");
    } catch {
      /* private window */
    }
    void fetch("/api/live/heart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ begin: next, armed: next }),
    })
      .then((r) => r.json())
      .then((h: HeartPayload) => applyHeart(h))
      .catch(() => {
        /* keep the click */
      });
  }

  function tickNow() {
    void fetch("/api/live/heart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tick: true, clipUsd }),
    })
      .then((r) => r.json())
      .then((h: HeartPayload) => applyHeart(h))
      .catch(() => {
        /* next */
      });
  }

  return (
    <div className="min-h-dvh min-w-0 overflow-x-hidden bg-bg text-fg">
      <header className="sticky top-0 z-30 min-w-0 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Envelope</p>
            <p className="mt-0.5 truncate text-sm text-muted">{view.line}</p>
          </div>
          <div className="flex items-center gap-4">
            <EtClock />
            <div className="text-right">
              <p className="font-mono text-xs uppercase tracking-widest text-subtle">{begun ? "Orders on" : "Orders off"}</p>
              <p className="font-display text-2xl italic tabular-nums tracking-tight">{cash == null ? "…" : `$${equity.toFixed(2)}`}</p>
              <button
                type="button"
                className={cn(
                  "mt-1 h-9 rounded-sm px-3 font-mono text-xs",
                  begun ? "bg-armed text-primary-foreground" : "border border-border",
                )}
                onClick={() => setBegin(!begun)}
              >
                {begun ? "LIVE" : "OFF"}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { job: "Scan", line: clock - Date.parse(heartTick ?? "") > 90_000 ? "Scanner asleep" : "Watching five books" },
            { job: "Day", line: `Down $${dayLoss.toFixed(2)} of $15` },
            { job: "Stop", line: `$${(15 - dayLoss).toFixed(2)} left of $15` },
            { job: "Open", line: positions.length ? `${positions.length} ticket${positions.length === 1 ? "" : "s"}` : "Flat" },
          ].map((seat) => (
            <div key={seat.job} className="min-w-0 rounded-sm bg-card/40 px-3 py-2">
              <p className="font-mono text-xs uppercase tracking-widest text-subtle">{seat.job}</p>
              <p className="mt-1 line-clamp-2 text-sm text-fg" title={seat.line}>{seat.line}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-xs text-subtle">
          {round?.ticker ?? "no ticket"}
          {round ? ` · ${Math.floor(round.leftSec / 60)}:${String(round.leftSec % 60).padStart(2, "0")} left` : ""}
          {pos ? ` · ${positions.length} open` : " · flat"}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-5" title={heartNote}>
          {(["btc", "eth", "sol", "xrp", "gold"] as BookId[]).map((id) => {
            const row = board.find((b) => b.book === id);
            const hot = row?.action === "scalp";
            const why = row?.reason ?? "waiting";
            const tail = why.split(" · ").slice(2).join(" · ") || why;
            return (
              <div key={id} className="min-w-0 rounded-sm border border-border bg-card/70 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs tracking-widest text-subtle">{BOOK_LABEL[id]}</span>
                  <span className={cn("font-mono text-xs", hot ? "text-primary" : "text-muted")}>{hot ? "IN" : "SIT"}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-sm text-fg" title={why}>{tail}</p>
              </div>
            );
          })}
        </div>
        {positions.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {positions.map((p) => {
              const paid = p.yes ?? p.entry;
              const mult = paid > 0 ? (1 / paid).toFixed(2) : "—";
              return (
                <li key={p.ticker ?? `${p.book}-${p.opened}`} className="rounded-sm border border-border px-3 py-1 font-mono text-xs tabular-nums">
                  {BOOK_LABEL[p.book]} {p.leg === "down" ? "NO" : "YES"} {Math.round(paid * 100)}¢ · {mult}x · ${p.sizeUsd.toFixed(0)}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 font-mono text-xs text-subtle">No open tickets.</p>
        )}
        <AccountLine />
        <nav className="mt-3 flex items-center gap-1 overflow-x-auto">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "h-11 shrink-0 px-4 text-sm rounded-sm transition-colors duration-150",
                tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-card",
              )}
            >
              <span className="mr-2 hidden font-mono text-xs text-subtle sm:inline">{i + 1}</span>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setGear((g) => !g)}
            aria-label="Broker"
            className={cn(
              "ml-auto h-11 min-w-11 shrink-0 rounded-sm px-3 text-sm",
              gear ? "bg-primary text-primary-foreground" : "text-subtle hover:bg-card hover:text-fg",
            )}
          >
            <Settings2 className="size-4" />
          </button>
        </nav>
        {gear ? (
          <div className="mt-3 rounded-sm border border-border bg-card p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Broker</p>
            <p className="mt-1 text-sm text-muted">Orders leave only when live is on. Size is $1, $2 if the lean matches, $5 only at 35¢ or cheaper.</p>
            <div className="mt-3">
              <BrokerPanel selected={brokerId} onSelect={setBrokerId} />
            </div>
          </div>
        ) : null}
      </header>

      {tab === "floor" ? (
        <>
          <Floor
            desk={desk}
            err={err}
            busy={busy}
            tape={tape}
            book={book}
            tf={tf}
            settings={settings}
            opinion={opinion}
            asking={asking}
            ledger={ledger}
            pos={pos}
            last={last}
            unreal={unreal}
            dead={dead}
            sit={sit}
            pulse={pulse}
            armed={begun}
            clipUsd={clipUsd}
            analog={liveAnalog(desk)}
            round={round}
            walking={showLoop}
            board={board}
            basisPct={scan?.basisPct ?? null}
            binanceBtc={scan?.binanceBtc ?? null}
            fair={scan?.fair ?? null}
            onBook={(id) => {
              setBook(id);
              setOpinion(null);
            }}
            onTf={setTf}
            onSettings={setSettings}
            onClip={setClipUsd}
            onAsk={() => void ask()}
            onTake={take}
            onFlat={() => flatten("Flattened to cash.")}
            onRefresh={() => void load(true)}
            onArm={() => setBegin(!begun)}
            onTick={tickNow}
            onWalk={() => setShowLoop((v) => !v)}
            onGate={() => setTab("print")}
          />
        </>
      ) : null}
      {tab === "print" ? (
        <div className="mx-auto grid max-w-3xl gap-3 px-3 py-3 sm:px-4">
          <div className="flex gap-2">
            <NewsPull />
          </div>
          <InboxCompact />
          <CalendarCompact desk={desk} />
          <SparkNote />
          <CatalystRadar />
        </div>
      ) : null}
      {tab === "swarm" ? <SwarmPanel /> : null}
      {tab === "perps" ? <PerpsLater /> : null}
    </div>
  );
}

function SparkNote() {
  const [line, setLine] = useState("");
  const [prob, setProb] = useState<number | null>(null);
  const [bias, setBias] = useState("");
  const [news, setNews] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const read = useCallback((note: { sparkCard?: { event?: string; why?: string; quote?: string; bias?: string; probability?: number | null } | null; spark?: string; sparkError?: string; deskNews?: { fed?: { meeting?: string; noChange?: number; hike?: number; ease?: number }; calendar?: { thisWeek?: { name?: string; actual?: string | null; forecast?: string | null }[]; nextWeek?: { name?: string; when?: string }[] }; providers?: { benzinga?: { status?: string } }; goldReserve?: { asOf?: string; ounces?: number } } | null } | null) => {
    if (!note) return;
    const card = note.sparkCard;
    setProb(typeof card?.probability === "number" ? card.probability : null);
    setBias(card?.bias || "");
    setLine(card?.event ? `${card.event}. ${card.why || card.quote || ""}` : note.spark || "");
    setErr(note.sparkError || "");
    const fed = note.deskNews?.fed;
    const nfp = (note.deskNews?.calendar?.thisWeek ?? []).find((row) => /non-farm/i.test(row.name || ""));
    const nxt = note.deskNews?.calendar?.nextWeek?.[0];
    const gold = note.deskNews?.goldReserve;
    const blocked = note.deskNews?.providers?.benzinga?.status === "terms";
    const bits = [
      fed?.meeting ? `Fed ${fed.meeting}: no change ${fed.noChange ?? "?"}%, hike ${fed.hike ?? "?"}%, cut ${fed.ease ?? "?"}%` : "",
      nfp ? `NFP ${nfp.actual ?? "pending"} vs forecast ${nfp.forecast ?? "?"}` : "",
      nxt?.name ? `Next high: ${nxt.name} ${nxt.when ?? ""}` : "",
      gold?.ounces ? `US gold reserve ${Math.round((gold.ounces || 0) / 1e6)} million oz as of ${gold.asOf}, book value, not the market price.` : "",
      blocked ? "Benzinga is in the catalog. It stays off until the terms are accepted." : "",
    ].filter(Boolean);
    setNews(bits.join(" · "));
  }, []);

  useEffect(() => {
    let stop = false;
    const pull = () => {
      void fetch("/api/firecrawl/radar")
        .then((r) => (r.ok ? r.json() : null))
        .then((note) => {
          if (!stop) read(note);
        })
        .catch(() => {
          /* quiet */
        });
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [read]);

  return (
    <section className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-primary">News</h2>
        <button
          type="button"
          disabled={busy}
          className="h-8 rounded-sm border border-border px-2 font-mono text-xs hover:bg-secondary disabled:opacity-40"
          onClick={() => {
            setBusy(true);
            setErr("");
            void fetch("/api/firecrawl/radar", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spark: true }),
            })
              .then((r) => r.json())
              .then((note) => read(note))
              .catch(() => setErr("Spark did not answer"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
      </div>
      {prob != null ? <p className="mt-2 font-display text-2xl italic tabular-nums">{Math.round(prob * 100)}%</p> : null}
      {prob != null ? <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Source-quoted odds (e.g. FedWatch). Not a Kalshi settlement probability. Not the trade.</p> : null}
      {news ? <p className="mt-2 text-sm leading-6 text-fg">{news}</p> : null}
      <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Reads itself every 90 minutes. This does not send the order.</p>
      <p className="mt-2 text-sm leading-5">{line || "No sentence yet. This is the calendar, not the 15-minute call."}</p>
      {err ? <p className="mt-1 font-mono text-xs text-down">{err}</p> : null}
    </section>
  );
}

function NewsPull() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  return (
    <button
      type="button"
      disabled={busy}
      className="h-10 rounded-sm border border-border px-3 font-mono text-xs hover:bg-secondary disabled:opacity-40"
      onClick={() => {
        setBusy(true);
        void fetch("/api/firecrawl/pull", { method: "POST" })
          .then((r) => r.json())
          .then((d: { live?: boolean; errors?: string[] }) => setNote(d.live ? "Pages pulled." : d.errors?.[0] || "Pull failed."))
          .catch(() => setNote("Pull failed."))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Pulling…" : "Pull pages"}
      {note ? ` · ${note}` : ""}
    </button>
  );
}

function PerpsLater() {
  const [rows, setRows] = useState<Array<{ ticker: string; bid: number; ask: number; lev: number; contractSize: number }>>([]);
  const [note, setNote] = useState("Reading the margin book…");
  const [cash, setCash] = useState(0);
  const [fireNote, setFireNote] = useState("");
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void fetch("/api/live/kalshi")
        .then((r) => r.json())
        .then((j: { cashUsd?: number; perps?: Array<{ ticker: string; bid: number; ask: number; lev: number; contractSize: number }> }) => {
          if (stop) return;
          const list = j.perps ?? [];
          setRows(list);
          if (typeof j.cashUsd === "number") setCash(j.cashUsd);
          setNote(list.length ? "Live Kalshi margin. The buttons below send the bracket you set." : "The margin book did not answer.");
        })
        .catch(() => {
          if (!stop) setNote("The margin book did not answer.");
        });
    };
    pull();
    const id = setInterval(pull, 20_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  const book = rows.find((r) => r.ticker === "KXGOLDPERP") ?? rows[0];
  const price = book ? (book.bid + book.ask) / 2 || book.ask || book.bid : 0;
  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">Separate book · not the 15-minute ticket</p>
      <h2 className="mt-2 font-display text-3xl italic">Kalshi perpetuals</h2>
      <p className="mt-3 text-sm leading-6 text-muted">{note}</p>
      <ul className="mt-4 divide-y divide-border border-y border-border font-mono text-sm tabular-nums">
        {rows.map((r) => (
          <li key={r.ticker} className="flex items-baseline justify-between gap-3 py-2">
            <span>{r.ticker}</span>
            <span className="text-subtle">
              {r.bid.toFixed(2)} / {r.ask.toFixed(2)} · size {r.contractSize || "—"} · {r.lev ? `${r.lev.toFixed(1)}x` : "lev unread"}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <PerpCockpit
          key={book?.ticker ?? "KXGOLDPERP"}
          ticker={book?.ticker ?? "KXGOLDPERP"}
          maxLeverage={book && book.lev >= 1 ? book.lev : 1}
          currentPrice={price > 0 ? price : 0}
          balanceUsd={cash}
          dailyPnL={0}
          onDispatchOrder={() => {
            setFireNote("Perpetual orders are disabled until their independent margin, fees, bracket safety and risk tests pass.");
          }}
        />
      </div>
      {fireNote ? <p className="mt-3 text-sm leading-6 text-muted">{fireNote}</p> : null}
    </section>
  );
}

function Ticker({ desk, pos, onBook }: { desk: DeskPayload; pos: Position | null; onBook: (id: BookId) => void }) {
  const s = desk.snapshot;
  const items = [
    ["BTC", "btc", s.btc, desk.tapes.btc.changePct],
    ["ETH", "eth", desk.tapes.eth.last, desk.tapes.eth.changePct],
    ["SOL", "sol", s.sol, desk.tapes.sol.changePct],
    ["GC", "gold", s.gold, desk.tapes.gold.changePct],
  ] as const;
  return (
    <div className="mt-3 min-w-0 overflow-x-auto border-y border-border py-2">
      <div className="flex w-max items-baseline gap-4 font-mono text-xs tabular-nums">
        {items.map(([k, id, v, ch]) => (
          <button key={k} type="button" onClick={() => onBook(id)} className="flex h-11 items-baseline gap-2 px-1">
            <span className={pos?.book === id ? "text-armed" : "text-subtle"}>{k}</span>
            <span>{v == null ? "—" : v > 0 && v < 1.5 ? `${Math.round(v * 100)}¢` : v.toFixed(2)}</span>
            {ch != null ? (
              <span className={ch >= 0 ? "text-armed" : "text-down"}>
                {ch >= 0 ? "+" : ""}
                {ch.toFixed(2)}%
              </span>
            ) : null}
          </button>
        ))}
        <span className="text-subtle">VIX {s.vix == null ? "—" : s.vix.toFixed(0)}</span>
        <span className="text-subtle">DXY {s.dxy == null ? "—" : s.dxy.toFixed(2)}</span>
        {desk.next ? (
          <span className="text-subtle">
            next {desk.next.name}
            {desk.hoursToNext != null ? ` ${Math.max(0, desk.hoursToNext).toFixed(1)}h` : ""}
          </span>
        ) : null}
        <span className="text-subtle">
          {desk.session.cash} · heat {desk.heat}
        </span>
      </div>
    </div>
  );
}

function AccountLine() {
  const [line, setLine] = useState("Reading the Kalshi account…");
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void fetch("/api/live/kalshi")
        .then((r) => r.json())
        .then((j: {
          auth?: boolean;
          livePath?: boolean;
          begun?: boolean;
          shard2?: number | null;
          cashUsd?: number | null;
          openOrders?: number | null;
          marketPositions?: number | null;
          round?: { ticker?: string };
          gold15m?: { ticker?: string };
          btcRule?: { ticker?: string | null; status?: string | null };
          goldRule?: { ticker?: string | null; status?: string | null };
          error?: string | null;
        }) => {
          if (stop) return;
          if (!j.auth) {
            setLine("Kalshi account did not answer. No order was sent.");
            return;
          }
          const path = j.livePath ? "Live on" : "Live off";
          const shard = j.shard2 == null ? "shard unread" : `$${Number(j.shard2).toFixed(2)} on the crypto book`;
          const orders = j.openOrders == null ? "" : ` · ${j.openOrders} resting`;
          const pos = j.marketPositions == null ? "" : ` · ${j.marketPositions} on Kalshi`;
          setLine(`${path} · ${shard}${orders}${pos}`);
        })
        .catch(() => {
          if (!stop) setLine("Kalshi account unread. No order was sent.");
        });
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return <p className="mt-1 font-mono text-xs leading-4 text-primary">{line}</p>;
}

function chartNote(book: BookId) {
  if (book === "btc" || book === "eth" || book === "sol" || book === "xrp" || book === "gold") {
    return "These candles are the coin. The bet is the 15-minute Kalshi ticket, not this chart.";
  }
  return "This book is not on the desk.";
}

function BrtiLine() {
  const [line, setLine] = useState("BRTI not read yet");
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void fetch("/api/live/brti")
        .then((r) => r.json())
        .then((j: { status?: string; mode?: string; trailing60?: number | null; volReady?: boolean; settlement?: string; settlementValue?: number | null; ageMs?: number | null }) => {
          if (stop) return;
          const px = j.trailing60 == null ? "no print" : j.trailing60.toFixed(2);
          const settle = j.settlement === "print" && j.settlementValue != null ? j.settlementValue.toFixed(2) : (j.settlement ?? "absent");
          setLine(`BRTI ${j.status ?? "unread"} · ${j.mode ?? "none"} · trailing 60s ${px} · vol ${j.volReady ? "ready" : "not enough"} · settlement ${settle}`);
        })
        .catch(() => {
          if (!stop) setLine("BRTI unread. The chart stays.");
        });
    };
    pull();
    const id = setInterval(pull, 5_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return <p className="mt-2 font-mono text-xs text-subtle">{line}</p>;
}

function GoldLine() {
  const [line, setLine] = useState("XAU not read yet");
  useEffect(() => {
    let stop = false;
    const pull = () => {
      void fetch("/api/live/pyth")
        .then((r) => r.json())
        .then((j: { status?: string; spot?: number | null; candleClose?: number | null; settlement?: string; closedMinutes?: number }) => {
          if (stop) return;
          const spot = j.spot == null ? "no tick" : j.spot.toFixed(2);
          const close = j.candleClose == null ? "no close yet" : j.candleClose.toFixed(2);
          setLine(`XAU ${j.status ?? "unread"} · spot ${spot} · last 1m close ${close} · ${j.settlement ?? "absent"} · ${j.closedMinutes ?? 0} finished minutes`);
        })
        .catch(() => {
          if (!stop) setLine("XAU unread. Same Kalshi account. No second broker.");
        });
    };
    pull();
    const id = setInterval(pull, 5_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);
  return <p className="mt-1 font-mono text-xs text-subtle">{line}</p>;
}

function ProbBoard({
  rows,
}: {
  rows: { book: string; ticker?: string; leftSec?: number | null; action?: string; reason: string; up?: number | null; down?: number | null; prob?: { label: string; modelPYes: number | null; netEdge: number | null; noTrade: string[] } }[] | null;
}) {
  const [voice, setVoice] = useState("Hear this window");
  const script = !rows?.length
    ? ""
    : rows
        .map((row) => {
          const p = row.prob?.modelPYes == null ? "no model yet" : `${Math.round(row.prob.modelPYes * 100)} percent yes`;
          return `${row.book} ${row.ticker ?? ""} ${p}. Market yes ${row.up == null ? "unread" : row.up.toFixed(2)}. ${row.prob?.noTrade?.[0] ?? row.action ?? ""}`;
        })
        .join(" ");
  return (
    <section className="mx-4 mt-4 rounded-sm border border-border bg-card p-4 sm:mx-6 lg:mx-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-prose">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Two contracts</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Bitcoin, ether, solana, and gold. The index feeds update about once a second. This card samples them every 5 seconds. A number here is a formula. It has not been scored on resolved Kalshi windows.
          </p>
        </div>
        <button
          type="button"
          className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-secondary"
          onClick={() => {
            if (script.length < 20) return;
            setVoice("Reading…");
            void fetch("/api/live/brief", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: `Desk check. ${script}`.slice(0, 500) }),
            })
              .then(async (res) => {
                if (!res.ok) {
                  setVoice("Voice off");
                  return;
                }
                const url = URL.createObjectURL(await res.blob());
                await new Audio(url).play();
                setVoice("Hear this window");
              })
              .catch(() => setVoice("Voice off"));
          }}
        >
          {voice}
        </button>
      </div>
      {!rows ? (
        <p className="mt-4 text-sm text-muted">Probabilities have not loaded.</p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {rows.map((row) => {
            const model = row.prob?.modelPYes;
            const blocked = row.prob?.noTrade?.filter((item) => item !== "not calibrated") ?? [];
            return (
              <article key={row.book} className="rounded-sm border border-border bg-background p-4">
                <p className="font-mono text-xs uppercase tracking-widest text-primary">{row.book}</p>
                <p className="mt-2 font-display text-3xl italic tabular-nums">{model == null ? "—" : model.toFixed(2)}</p>
                <p className="mt-1 text-sm text-muted">{model == null ? (blocked[0] ?? "No model yet") : "Formula. Not a grade of past Kalshi results."}</p>
                <p className="mt-3 font-mono text-xs text-subtle">
                  {row.ticker || "no contract"} · {row.leftSec ?? "—"}s left · market yes {row.up == null ? "—" : row.up.toFixed(2)} · no {row.down == null ? "—" : row.down.toFixed(2)}
                </p>
                <p className="mt-2 text-sm text-fg">{blocked[0] ?? row.reason}</p>
                <p className="mt-1 font-mono text-xs text-subtle">{row.action ?? "WAITING"}{row.prob?.netEdge == null ? "" : ` · net ${row.prob.netEdge.toFixed(3)}`}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Floor({
  desk,
  err,
  busy,
  tape,
  book,
  tf,
  settings,
  opinion,
  asking,
  ledger,
  pos,
  last,
  unreal,
  dead,
  sit,
  pulse,
  armed,
  clipUsd,
  analog,
  walking,
  board,
  basisPct,
  binanceBtc,
  fair,
  round,
  onBook,
  onTf,
  onSettings,
  onClip,
  onAsk,
  onTake,
  onFlat,
  onRefresh,
  onArm,
  onTick,
  onWalk,
  onGate,
}: {
  desk: DeskPayload | null;
  err: string | null;
  busy: boolean;
  tape: Tape | null;
  book: BookId;
  tf: TfId;
  settings: TapeSettings;
  opinion: Opinion | null;
  asking: boolean;
  ledger: LedgerRow[];
  pos: Position | null;
  last: number;
  unreal: number;
  dead: boolean;
  sit: boolean;
  pulse: Pulse | null;
  armed: boolean;
  clipUsd: number;
  analog: AnalogLive | null;
  round: UpDownRound | null;
  walking: boolean;
  board: BookScan[];
  basisPct: number | null;
  binanceBtc: number | null;
  fair: ScanPayload["fair"];
  onBook: (id: BookId) => void;
  onTf: (id: TfId) => void;
  onSettings: (s: TapeSettings) => void;
  onClip: (n: number) => void;
  onAsk: () => void;
  onTake: (play: PlayId) => void;
  onFlat: () => void;
  onRefresh: () => void;
  onArm: () => void;
  onTick: () => void;
  onWalk: () => void;
  onGate: () => void;
}) {
  const pick = opinion?.pick;
  const [spot, setSpot] = useState<Tape | null>(null);
  useEffect(() => {
    let gone = false;
    const pull = () => {
      void fetch(`/api/live/price?book=${book}&tf=${tf}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((t: Tape | null) => {
          if (gone || !t?.bars?.length) return;
          setSpot((prev) => {
            if (prev && prev.book === t.book && prev.last === t.last && prev.bars.length === t.bars.length) return prev;
            return t;
          });
        })
        .catch(() => {
          /* keep the last coin chart */
        });
    };
    pull();
    const id = setInterval(pull, 15_000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, [book, tf]);
  const draw = spot && spot.book === book ? spot : null;
  const candles = useMemo(() => {
    if (!draw) return null;
    const marks =
      draw.fib236 !== draw.fib618
        ? [
            { label: "50", price: draw.fib50 },
            { label: "62", price: draw.fib618 },
            { label: "VWAP", price: draw.vwap },
            { label: "70.5", price: draw.fib618 + (draw.fib786 - draw.fib618) * ((0.705 - 0.618) / (0.786 - 0.618)) },
            { label: "79", price: draw.fib786 },
          ]
        : [];
    return candlePath(draw.bars, 640, 180, settings, marks);
  }, [draw, settings]);

  if (err && !desk && !tape) return <Fail message={`Live desk failed: ${err}. Refresh in a moment.`} />;
  if (!desk || !tape) {
    return (
      <main className="grid gap-4 px-4 py-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <section className="rounded-sm border border-border bg-card p-4 lg:col-span-3">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Floor</p>
          <p className="mt-3 text-sm text-muted">Prices are still coming in. The page stays put.</p>
        </section>
        <section className="rounded-sm border border-border bg-card p-4 lg:col-span-9">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Chart</p>
          <p className="mt-3 text-sm text-muted">The chart is still here. Candles draw when the tape has bars. A slow load does not remove it.</p>
          <p className="mt-2 text-sm text-muted">{chartNote(book)}</p>
          <BrtiLine />
        </section>
      </main>
    );
  }

  return (
    <main className="grid gap-3 px-3 py-3 sm:px-4 lg:grid-cols-12 lg:px-6">
      <section className="order-1 min-w-0 rounded-sm border border-border bg-card p-3 shadow-sm sm:p-4 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-widest text-primary">
              {tf} · {tape.venue}
            </h2>
            <p className="font-mono text-xs text-subtle">{tape.symbol}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {BOOKS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onBook(b.id)}
                className={cn(
                  "min-h-11 min-w-11 px-4 text-sm rounded-sm transition-colors duration-150",
                  book === b.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {TFS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTf(t.id)}
              className={cn(
                "h-11 min-w-11 px-3 text-sm rounded-sm border border-border transition-colors duration-150",
                tf === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-2 font-display text-3xl italic tabular-nums tracking-tight">
          {draw ? draw.last.toLocaleString("en-US", { maximumFractionDigits: draw.last > 100 ? 0 : 2 }) : "…"}
        </p>
        <p className="font-mono text-xs text-subtle">
          {draw ? `${draw.symbol} · ${draw.venue}` : "Waiting for the coin"}
          {` · ticket ${fmt(tape.last, book)}`}
          {draw?.changePct != null ? ` · ${draw.changePct >= 0 ? "+" : ""}${draw.changePct.toFixed(2)}% on this window` : ""}
        </p>
        {candles ? (
          <div className="mt-3">
            <svg viewBox="0 0 640 180" className="mt-2 h-44 w-full text-muted-foreground sm:h-48" role="img" aria-label={`${tf} ${draw?.symbol ?? "price"}`}>
              {candles.ticks.map((t) => (
                <g key={t.label}>
                  <line x1="0" y1={t.y} x2="582" y2={t.y} className="stroke-border" strokeWidth="1" />
                  <text x="586" y={t.y + 3} className="fill-subtle" fontSize="11">
                    {t.label}
                  </text>
                </g>
              ))}
              {candles.guides.map((g) => (
                <g key={g.label}>
                  <line x1="0" y1={g.y} x2="582" y2={g.y} className="stroke-warning/50" strokeWidth="1" strokeDasharray="2 4" />
                  <text x="4" y={g.y - 2} className="fill-warning" fontSize="10">
                    {g.label}
                  </text>
                </g>
              ))}
              <line x1="0" y1={candles.lastY} x2="582" y2={candles.lastY} className="stroke-primary" strokeWidth="1" strokeDasharray="3 3" />
              {candles.wicks.map((d, i) => (
                <path key={i} d={d} stroke="currentColor" strokeWidth="1" fill="none" />
              ))}
              {candles.bodies.map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} className={b.up ? "fill-armed" : "fill-down"} />
              ))}
              {candles.emaSlow ? <path d={candles.emaSlow} className="stroke-subtle" fill="none" strokeWidth="1.25" /> : null}
              {candles.emaFast ? <path d={candles.emaFast} className="stroke-primary" fill="none" strokeWidth="1.5" /> : null}
            </svg>
            {tape.rsi != null && draw ? (
              <svg viewBox="0 0 640 56" className="mt-2 h-12 w-full" role="img" aria-label={`RSI ${tape.rsi.toFixed(0)}`}>
                <line x1="0" y1={candles.rsi70} x2="640" y2={candles.rsi70} className="stroke-down/40" strokeWidth="1" />
                <line x1="0" y1={candles.rsi30} x2="640" y2={candles.rsi30} className="stroke-armed/40" strokeWidth="1" />
                {candles.rsi ? <path d={candles.rsi} className="stroke-warning" fill="none" strokeWidth="1.5" /> : null}
                <text x="4" y="12" className="fill-subtle" fontSize="10">
                  RSI {draw.rsi == null ? "—" : draw.rsi.toFixed(0)}
                </text>
              </svg>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2 font-mono text-xs text-subtle">
          RSI {draw?.rsi == null ? "—" : draw.rsi.toFixed(0)}
          {" · "}
          EMA 20/50 {draw?.stacked ?? "—"}
          {" · "}
          Fib {draw?.fibZone ?? "—"}
          {draw && draw.bars.length > 2 ? ` · ${candleName(draw.bars)}` : ""}
        </p>
      </section>

      <aside className="order-2 flex min-w-0 flex-col gap-3 lg:col-span-4 lg:sticky lg:top-20 lg:self-start">
        <section className="rounded-sm border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Call</h2>
            <Badge tone={round?.take ? "armed" : "neutral"}>{round?.take ? "take" : "sit"}</Badge>
          </div>
          {round ? (
            <>
              <p className="mt-2 font-display text-3xl italic tabular-nums">{round.leftSec}s</p>
              <p className="mt-1 font-mono text-sm tabular-nums">
                UP {round.up.toFixed(2)} · DOWN {round.down.toFixed(2)}
              </p>
              <p className="mt-1 font-mono text-xs text-subtle">
                line {round.beat.toFixed(0)} · index {round.spot.toFixed(0)} · {round.moveBps >= 0 ? "+" : ""}
                {round.moveBps.toFixed(1)} bp
              </p>
              <p className="mt-2 text-sm leading-5">{round.reason}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No open ticket on this book yet.</p>
          )}
          <Button className="mt-3 h-11 w-full" variant={armed ? "default" : "secondary"} onClick={onArm}>
            {armed ? "LIVE" : "OFF"}
          </Button>
        </section>
        <section className="rounded-sm border border-border bg-card p-3">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Contracts</h2>
          <ScanBoard board={board} book={book} onBook={onBook} />
          <SparkNote />
        </section>
      </aside>
      <section className="order-4 max-h-32 overflow-y-auto rounded-sm border border-border bg-card p-3 lg:order-4 lg:col-span-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Fills</h2>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-2">
            {ledger.slice(0, 4).map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-2 border-t border-border py-1 first:border-t-0">
                <p className="truncate font-mono text-xs text-subtle">{row.ts} · {row.note}</p>
                <p className={cn("shrink-0 font-mono text-xs tabular-nums", row.delta >= 0 ? "text-armed" : "text-down")}>
                  {row.delta >= 0 ? "+" : ""}
                  {row.delta.toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="order-5 rounded-sm border border-border bg-card px-3 py-2 font-mono text-xs text-subtle lg:order-4 lg:col-span-4">
        {desk.next
          ? `${desk.next.name} · ${desk.hoursToNext != null ? `${Math.max(0, desk.hoursToNext).toFixed(0)}h` : "—"} · forecast ${fmtNum(desk.next.forecast)}`
          : "No print due"}
      </p>
    </main>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-subtle">{k}</p>
      <p className="mt-1 font-mono text-sm tabular-nums capitalize">{v}</p>
    </div>
  );
}

function Num({
  k,
  value,
  min,
  max,
  onChange,
}: {
  k: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="rounded-sm border border-border bg-background p-3">
      <span className="text-xs uppercase tracking-wide text-subtle">{k}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-11 w-full bg-transparent font-mono text-sm tabular-nums text-fg outline-none"
      />
    </label>
  );
}

function candleName(bars: { o: number; h: number; l: number; c: number }[]) {
  const a = bars.at(-2);
  const b = bars.at(-1);
  if (!a || !b) return "";
  const bull = b.c > b.o && a.c < a.o && b.c >= a.o && b.o <= a.c;
  const bear = b.c < b.o && a.c > a.o && b.o >= a.c && b.c <= a.o;
  if (bull) return "bullish engulf";
  if (bear) return "bearish engulf";
  return "";
}

function fmt(n: number, _book: BookId) {
  if (n > 0 && n < 1.5) return `${Math.round(n * 100)}¢`;
  return n.toFixed(2);
}

function fmtNum(v: number | string | null) {
  if (v == null || v === "") return "—";
  return String(v);
}
