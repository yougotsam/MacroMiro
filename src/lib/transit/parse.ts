import { decodeClipper, decodeOctopus, decodeOpal, type Decoded } from "./decode";

export type DumpCard = {
  type: string;
  id: string;
  scannedAt?: string;
  sectors: { index: number; blocks: string[] }[];
  files: Record<string, string>;
  rawHex?: string;
  decoded: Decoded | null;
};

function attr(el: Element, name: string) {
  return el.getAttribute(name) || el.getAttribute(name.toLowerCase()) || "";
}

function collectHex(el: Element): string {
  return (el.textContent || "").replace(/[^0-9a-f]/gi, "");
}

export function parseDump(text: string): DumpCard[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJson(trimmed);
  if (trimmed.startsWith("<")) return parseXml(trimmed);
  const hex = trimmed.replace(/[^0-9a-f]/gi, "");
  if (hex.length >= 32 && hex.length % 2 === 0) return [fromHexBlob(hex)];
  throw new Error("Not a Metrodroid/Farebot XML, JSON, or hex dump.");
}

function fromHexBlob(hex: string): DumpCard {
  const decoded =
    hex.length === 32
      ? decodeOpal(hex) ?? decodeOctopus(hex)
      : decodeOpal(hex.slice(0, 32)) ?? decodeOctopus(hex.slice(0, 32));
  const sectors: DumpCard["sectors"] = [];
  const blockSize = 32;
  if (hex.length >= 1024 * 2) {
    for (let s = 0; s < hex.length / (4 * blockSize); s++) {
      const blocks = [];
      for (let b = 0; b < 4; b++) {
        const o = (s * 4 + b) * blockSize;
        blocks.push(hex.slice(o, o + blockSize));
      }
      sectors.push({ index: s, blocks });
    }
  }
  return {
    type: hex.length === 32 ? "short-file" : "raw-hex",
    id: hex.slice(0, 8),
    sectors,
    files: hex.length === 32 ? { "7": hex } : {},
    rawHex: hex,
    decoded,
  };
}

function parseXml(xml: string): DumpCard[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML parse failed.");
  const nodes = [...doc.querySelectorAll("card, Card")];
  if (!nodes.length) throw new Error("No <card> nodes. Export from Metrodroid: Scanned Cards → Import/Export.");
  return nodes.map((node) => {
    const type = attr(node, "type") || node.getAttribute("type") || "unknown";
    const id = attr(node, "id") || attr(node, "serial") || "";
    const scannedAt = attr(node, "scanned_at") || attr(node, "scannedAt");
    const sectors: DumpCard["sectors"] = [];
    node.querySelectorAll("sector, Sector").forEach((sec) => {
      const index = Number(attr(sec, "index") || attr(sec, "id") || sectors.length);
      const blocks = [...sec.querySelectorAll("block, Block")].map(collectHex);
      sectors.push({ index, blocks });
    });
    const files: Record<string, string> = {};
    node.querySelectorAll("file, File").forEach((f) => {
      const fid = attr(f, "id") || attr(f, "index");
      files[fid.replace(/^0x/i, "").toLowerCase()] = collectHex(f);
    });
    const decoded = guess(type, id, files, sectors);
    return { type, id, scannedAt, sectors, files, decoded };
  });
}

function parseJson(text: string): DumpCard[] {
  const data = JSON.parse(text) as unknown;
  const rows = Array.isArray(data) ? data : [data];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    if (r.KeyType) {
      return {
        type: String(r.KeyType),
        id: String(r.TagId ?? ""),
        sectors: [],
        files: {},
        decoded: {
          system: "MIFARE key file",
          fields: [
            { label: "KeyType", value: String(r.KeyType) },
            { label: "Tag", value: String(r.TagId ?? "static") },
            { label: "Keys", value: String(Array.isArray(r.keys) ? r.keys.length : 0) },
          ],
          note: "Key material only. Import this into Metrodroid on-device to unlock Classic sectors.",
        },
      };
    }
    const type = String(r.type ?? r.Type ?? r.tagType ?? "json");
    const id = String(r.id ?? r.tagId ?? r.TagId ?? r.serial ?? "");
    const files: Record<string, string> = {};
    const fileObj = (r.files ?? r.Files) as Record<string, string> | undefined;
    if (fileObj && typeof fileObj === "object") {
      for (const [k, v] of Object.entries(fileObj)) files[k.replace(/^0x/i, "").toLowerCase()] = String(v).replace(/[^0-9a-f]/gi, "");
    }
    const apps = r.applications ?? r.Applications;
    if (apps && typeof apps === "object") {
      for (const app of Object.values(apps as Record<string, { files?: Record<string, string> }>)) {
        if (app?.files) {
          for (const [k, v] of Object.entries(app.files)) files[k.replace(/^0x/i, "").toLowerCase()] = String(v).replace(/[^0-9a-f]/gi, "");
        }
      }
    }
    const sectors: DumpCard["sectors"] = [];
    const secs = (r.sectors ?? r.Sectors) as { index?: number; blocks?: string[] }[] | undefined;
    if (Array.isArray(secs)) {
      secs.forEach((s, i) => sectors.push({ index: s.index ?? i, blocks: (s.blocks ?? []).map(String) }));
    }
    return { type, id, sectors, files, decoded: guess(type, id, files, sectors) };
  });
}

function guess(
  type: string,
  id: string,
  files: Record<string, string>,
  sectors: DumpCard["sectors"],
): Decoded | null {
  const clip = decodeClipper(files);
  if (clip) return clip;
  if (files["7"]) {
    const opal = decodeOpal(files["7"]);
    if (opal) return opal;
  }
  const t = type.toLowerCase();
  if (t.includes("felica") || t.includes("octopus")) {
    const first = Object.values(files)[0] || sectors[0]?.blocks[0];
    if (first) {
      const oct = decodeOctopus(first);
      if (oct) return oct;
    }
  }
  if (id || sectors.length) {
    return {
      system: type || "Imported dump",
      fields: [
        { label: "UID / serial", value: id || "—" },
        { label: "Sectors", value: String(sectors.length) },
        { label: "Files", value: String(Object.keys(files).length) },
      ],
      note: "Dump loaded. No matching public decoder for this media yet — atlas still applies.",
    };
  }
  return null;
}
