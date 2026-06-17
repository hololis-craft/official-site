#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LOOT_URL =
  "https://raw.githubusercontent.com/hololis-craft/datapack/master/datapacks/hololis/data/hololis/loot_table/holomem/player_heads.json";
const OUT_PATH = resolve(ROOT, "src/data/heads.json");
const MEMBERS_PATH = resolve(ROOT, "src/data/members.json");
const CONCURRENCY = 8;

async function main() {
  console.log(`▸ fetch ${LOOT_URL}`);
  const lootRes = await fetch(LOOT_URL);
  if (!lootRes.ok)
    throw new Error(`loot table fetch failed: ${lootRes.status}`);
  const loot = await lootRes.json();
  const entries = loot.pools.flatMap((p) => p.entries);
  console.log(`▸ ${entries.length} loot entries`);

  const uniq = new Map();
  for (const entry of entries) {
    const profile = entry.functions[0].components["minecraft:profile"];
    const member = profile.name;
    const decoded = JSON.parse(
      Buffer.from(profile.properties[0].value, "base64").toString("utf-8"),
    );
    const url = decoded.textures.SKIN.url;
    const hash = url.split("/").pop();
    const key = `${member}|${hash}`;
    if (!uniq.has(key)) uniq.set(key, { hash, url, member });
  }
  console.log(`▸ ${uniq.size} unique (member, hash) combinations`);

  const allHashes = [...new Set([...uniq.values()].map((v) => v.hash))];
  console.log(`▸ ${allHashes.length} unique texture hashes — downloading`);

  const hashToB64 = new Map();
  let done = 0;
  await pool(allHashes, CONCURRENCY, async (hash) => {
    const url = `https://textures.minecraft.net/texture/${hash}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! ${hash.slice(0, 12)} → ${res.status}`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    hashToB64.set(hash, buf.toString("base64"));
    done++;
    if (done % 25 === 0 || done === allHashes.length) {
      console.log(`  ${done}/${allHashes.length}`);
    }
  });

  const heads = [...uniq.values()]
    .map(({ hash, member }) => ({
      id: `${member}-${hash.slice(0, 8)}`,
      member,
      hash,
      b64: hashToB64.get(hash) ?? null,
    }))
    .filter((h) => h.b64);

  const members = await loadMembers();
  if (members) {
    const known = new Set([
      ...Object.keys(members),
      ...Object.values(members).flatMap((m) => m.aliases ?? []),
    ]);
    const unknown = [...new Set(heads.map((h) => h.member))].filter(
      (s) => !known.has(s),
    );
    if (unknown.length > 0) {
      console.warn(`⚠ ${unknown.length} slugs not in members.json:`);
      for (const s of unknown.sort()) console.warn(`  - ${s}`);
    } else {
      console.log("✓ all slugs resolved against members.json");
    }
  } else {
    console.warn("⚠ members.json not found — skipping slug validation");
  }

  const out = {
    schemaVersion: 1,
    source: LOOT_URL,
    counts: {
      lootEntries: entries.length,
      uniqueHeads: heads.length,
      uniqueTextures: hashToB64.size,
    },
    heads,
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  const sizeKb = Math.round((await readFile(OUT_PATH)).length / 1024);
  console.log(`✓ wrote ${OUT_PATH} (${sizeKb} KB, ${heads.length} heads)`);
}

async function loadMembers() {
  try {
    const txt = await readFile(MEMBERS_PATH, "utf-8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
