#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PACK_URL =
  "https://hololiscraft-resources.f0reach.me/hololiscraft-merged-pack.zip";
const OUT_PATH = resolve(ROOT, "src/data/discs.json");

async function main() {
  console.log(`▸ fetch ${PACK_URL}`);
  const res = await fetch(PACK_URL);
  if (!res.ok) throw new Error(`pack fetch failed: ${res.status}`);
  const zipBuf = Buffer.from(await res.arrayBuffer());
  console.log(`▸ ${zipBuf.length} bytes`);

  const entries = readZip(zipBuf);
  const jextEntry = entries.find((e) => e.name === "jext.json");
  if (!jextEntry) throw new Error("jext.json not found in pack");
  const jext = JSON.parse(jextEntry.data.toString("utf-8"));
  console.log(`▸ ${jext.length} discs in jext.json`);

  const discs = jext.map((d) => {
    const texPath = `assets/minecraft/textures/item/music_disc_${d["disc-namespace"]}.png`;
    const texEntry = entries.find((e) => e.name === texPath);
    if (!texEntry) console.warn(`  ! texture missing: ${texPath}`);
    const lootTables = Object.entries(d["loot-tables"] ?? {}).map(
      ([table, weight]) => ({ table, weight }),
    );
    return {
      namespace: d["disc-namespace"],
      title: d.title,
      author: d.author,
      durationSec: d.duration,
      modelData: d["model-data"],
      creeperDrop: d["creeper-drop"],
      lootTables,
      lores: d.lores ?? [],
      texB64: texEntry ? texEntry.data.toString("base64") : null,
    };
  });

  const out = {
    schemaVersion: 1,
    source: PACK_URL,
    counts: {
      discs: discs.length,
      withTexture: discs.filter((d) => d.texB64).length,
    },
    discs,
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✓ wrote ${OUT_PATH} (${discs.length} discs)`);
}

function readZip(buf) {
  const entries = [];
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === sig) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("EOCD not found");
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);

  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad CD header");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf-8");
    p += 46 + nameLen + extraLen + cmtLen;

    if (name.endsWith("/")) continue;
    const lh = localOff;
    if (buf.readUInt32LE(lh) !== 0x04034b50)
      throw new Error(`bad LFH for ${name}`);
    const lNameLen = buf.readUInt16LE(lh + 26);
    const lExtraLen = buf.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + lNameLen + lExtraLen;
    const compData = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = compData;
    } else if (method === 8) {
      data = inflateRaw(compData, uncompSize);
    } else {
      throw new Error(`unsupported method ${method} for ${name}`);
    }
    entries.push({ name, data });
  }
  return entries;
}

import zlib from "node:zlib";
function inflateRaw(buf, expectedSize) {
  return zlib.inflateRawSync(buf);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
