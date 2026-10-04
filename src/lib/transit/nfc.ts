export type NfcHit = {
  serial: string;
  records: { recordType: string; text: string }[];
  at: string;
};

type NdefRecordLike = {
  recordType: string;
  data: BufferSource;
  encoding?: string;
  mediaType?: string;
};

type NdefReadingEvent = {
  serialNumber?: string;
  message: { records: NdefRecordLike[] };
};

type NdefReaderLike = {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((ev: NdefReadingEvent) => void) | null;
  onreadingerror: ((ev: Event) => void) | null;
};

export function nfcAvailable() {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

function decodeRecord(r: NdefRecordLike): string {
  try {
    const dec = new TextDecoder(r.encoding || "utf-8");
    return dec.decode(r.data);
  } catch {
    return r.mediaType || r.recordType;
  }
}

export async function scanOnce(external?: AbortSignal): Promise<NfcHit> {
  const Ctor = (window as unknown as { NDEFReader: new () => NdefReaderLike }).NDEFReader;
  const reader = new Ctor();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  external?.addEventListener("abort", onAbort);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error("No tag in 20s. Hold the card to the back of the phone."));
    }, 20_000);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
      fn();
    };
    reader.onreading = (ev) => {
      finish(() =>
        resolve({
          serial: (ev.serialNumber || "").toUpperCase(),
          records: (ev.message?.records ?? []).map((r) => ({
            recordType: r.recordType,
            text: decodeRecord(r),
          })),
          at: new Date().toISOString(),
        }),
      );
    };
    reader.onreadingerror = () => {
      finish(() => reject(new Error("Tag unreadable. Classic/FeliCa need the Metrodroid APK or a dump.")));
    };
    reader.scan({ signal: ctrl.signal }).catch((err: unknown) => {
      finish(() => reject(err instanceof Error ? err : new Error("NFC scan failed")));
    });
  });
}
