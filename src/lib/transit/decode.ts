export type Decoded = {
  system: string;
  fields: { label: string; value: string }[];
  note?: string;
};

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function be16(b: Uint8Array, i: number) {
  return (b[i] << 8) | b[i + 1];
}
function be32(b: Uint8Array, i: number) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function clipperDate(seconds: number) {
  const epoch = Date.UTC(1900, 0, 1);
  return new Date(epoch + seconds * 1000).toISOString().replace(".000Z", "Z");
}

export function decodeOpal(hex: string): Decoded | null {
  const raw = hexToBytes(hex);
  if (raw.length !== 16) return null;
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = raw[15 - i];
  const bits: number[] = [];
  for (const byte of b) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  const take = (start: number, len: number) => {
    let n = 0;
    for (let i = 0; i < len; i++) n = (n << 1) | bits[start + i];
    return n;
  };
  let balance = take(54, 21);
  if (balance & (1 << 20)) balance -= 1 << 21;
  const serial = take(96, 32);
  const check = take(92, 4);
  const days = take(39, 15);
  const mins = take(28, 11);
  const tap = new Date(Date.UTC(1980, 0, 1) + days * 86400000 + mins * 60000);
  const number = `308522${String(serial).padStart(9, "0")}${check}`;
  return {
    system: "Opal (Sydney)",
    fields: [
      { label: "Card number", value: number },
      { label: "Balance", value: `A$${(balance / 100).toFixed(2)}` },
      { label: "Last tap", value: Number.isNaN(tap.getTime()) ? "—" : tap.toISOString() },
      { label: "Weekly journeys", value: String(take(16, 4)) },
      { label: "Auto top-up", value: take(20, 1) ? "on" : "off" },
      { label: "Blocked", value: take(91, 1) ? "yes" : "no" },
    ],
    note: "Opal DESFire file 0x7, 16 bytes. Spec: Metrodroid wiki / Opal.",
  };
}

export function decodeOctopus(hex: string): Decoded | null {
  const b = hexToBytes(hex);
  if (b.length < 4) return null;
  const raw = be32(b, 0);
  const hkd = (raw - 500) / 10;
  if (hkd < -50 || hkd > 3000) return null;
  return {
    system: "Octopus (Hong Kong)",
    fields: [{ label: "Balance", value: `HK$${hkd.toFixed(1)}` }],
    note: "FeliCa service 0x0117. Units of 0.1 HKD plus 500. Metrodroid wiki / Octopus.",
  };
}

export function decodeClipper(files: Record<string, string>): Decoded | null {
  const f2 = files["2"] || files["0x2"] || files["02"];
  const f8 = files["8"] || files["0x8"] || files["08"];
  const fe = files["14"] || files["e"] || files["0xe"] || files["0E"];
  if (!f2 && !f8) return null;
  const fields: { label: string; value: string }[] = [];
  if (f8) {
    const b = hexToBytes(f8);
    if (b.length >= 5) fields.push({ label: "Serial", value: be32(b, 1).toString() });
  }
  if (f2) {
    const b = hexToBytes(f2);
    if (b.length >= 20) {
      fields.push({ label: "Balance", value: `$${(be16(b, 18) / 100).toFixed(2)}` });
      if (b.length >= 8) fields.push({ label: "Last use", value: clipperDate(be32(b, 4)) });
    }
  }
  if (fe) {
    const b = hexToBytes(fe);
    const trips = Math.floor(b.length / 32);
    fields.push({ label: "Trip records", value: String(trips) });
    if (trips > 0 && b.length >= 32) {
      fields.push({ label: "Last fare", value: `$${(be16(b, 6) / 100).toFixed(2)}` });
      fields.push({ label: "Entry", value: clipperDate(be32(b, 12)) });
    }
  }
  if (!fields.length) return null;
  return {
    system: "Clipper (San Francisco Bay)",
    fields,
    note: "DESFire AID 0x9011f2. Layout: Metrodroid wiki / Clipper.",
  };
}

export function decodeClassicUid(uid: string): Decoded {
  return {
    system: "Unknown ISO 14443 tag",
    fields: [{ label: "UID", value: uid.toUpperCase() }],
    note: "Web NFC can see the UID and NDEF. MIFARE Classic sectors, FeliCa systems, and Calypso files need the Metrodroid APK or an imported dump.",
  };
}

export { hexToBytes, be16, be32 };
