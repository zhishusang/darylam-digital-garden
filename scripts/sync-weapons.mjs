import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_RELATIVE_SOURCE = path.join("4-Projects", "巨人的兵器");
const DEFAULT_ATTACHMENTS_REL = "Attachments";

function resolveObsidianRoot() {
  const root = process.env.OBSIDIAN_ROOT?.trim();
  if (root) return root;
  throw new Error(
    "Missing OBSIDIAN_ROOT. Set it before running sync, for example: OBSIDIAN_ROOT='/path/to/obsidian' npm run sync:weapons",
  );
}

function toSlugFilename(filePath, sourceRoot) {
  const rel = path.relative(sourceRoot, filePath);
  return rel
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .split("/")
    .filter(Boolean)
    .join("__");
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    if (ent.isDirectory() && ent.name.toLowerCase() === "archived") continue;
    if (ent.isDirectory() && ent.name.toLowerCase() === "book versions") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function hashShort(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 10);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveAttachment({ attachmentsDir, sourceDir, target }) {
  const normalized = String(target).replace(/^\.\/+/, "");
  const withoutAttachmentsPrefix = normalized.replace(/^Attachments[\\/]/, "");
  const fileName = path.basename(withoutAttachmentsPrefix);
  const candidates = [
    path.join(sourceDir, normalized),
    path.join(sourceDir, fileName),
    path.join(attachmentsDir, withoutAttachmentsPrefix),
    path.join(attachmentsDir, fileName),
  ];
  for (const c of candidates) if (await exists(c)) return c;
  return null;
}

async function transformEmbeds({ markdown, obsidianRoot, sourceDir, publicAssetsDir }) {
  const attachmentsDir = path.join(obsidianRoot, DEFAULT_ATTACHMENTS_REL);
  const copied = new Map(); // key -> { target, outName, publicUrl }

  const out = markdown.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner) => {
    const raw = String(inner);
    const target = raw.split("|")[0]?.trim() ?? "";
    if (!target) return "";
    const alt = path.basename(target);
    const key = `${sourceDir}::${target}`;
    const fileHash = hashShort(key);
    const ext = path.extname(alt);
    const base = ext ? alt.slice(0, -ext.length) : alt;
    const safeBase = base.replace(/[\\/:"*?<>|]+/g, " ").replace(/\s+/g, " ").trim();
    const outName = `${fileHash}-${safeBase}${ext}`.slice(0, 120);
    const publicUrl = `/weapons-assets/${encodeURIComponent(outName)}`;
    copied.set(key, { target, outName, publicUrl });
    return `![${alt}](${publicUrl})`;
  });

  await fs.mkdir(publicAssetsDir, { recursive: true });
  for (const v of copied.values()) {
    const src = await resolveAttachment({
      attachmentsDir,
      sourceDir,
      target: v.target,
    });
    if (!src) continue;
    const dest = path.join(publicAssetsDir, v.outName);
    try {
      await fs.copyFile(src, dest);
    } catch {
      // ignore copy failures
    }
  }

  return out;
}

function stripObsidianArtifacts(markdown) {
  // 1) Obsidian embeds: ![[file.png]] / ![[note]]
  // Leave embeds intact; they are transformed later.
  let out = markdown;

  // 2) Obsidian internal links: [[Page]] or [[Page|Alias]]
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_m, inner) => {
    const [targetRaw, aliasRaw] = String(inner).split("|");
    const label = (aliasRaw ?? targetRaw ?? "").trim();
    return label ? label : "";
  });

  // 3) Remove inline time templates / placeholders
  out = out.replace(/^~~.*?~~\s*$/gm, "");

  return out.trim() + "\n";
}

function ensureFrontmatter(markdown, { title, updatedDate }) {
  const hasFrontmatter = markdown.startsWith("---\n");
  if (hasFrontmatter) return markdown;
  const safeTitle = title.replace(/"/g, '\\"');
  const header = [
    "---",
    `title: "${safeTitle}"`,
    `description: ""`,
    `tags: []`,
    `draft: false`,
    `updatedDate: "${updatedDate}"`,
    "---",
    "",
  ].join("\n");
  return header + markdown;
}

async function main() {
  const obsidianRoot = resolveObsidianRoot();
  const relativeSource = process.env.WEAPONS_SOURCE_REL || DEFAULT_RELATIVE_SOURCE;
  const sourceRoot = path.join(obsidianRoot, relativeSource);

  const websiteRoot = process.cwd();
  const destRoot = path.join(websiteRoot, "src", "content", "weapons");
  const publicAssetsDir = path.join(websiteRoot, "public", "weapons-assets");
  await fs.mkdir(destRoot, { recursive: true });

  const files = (await walk(sourceRoot)).filter((file) => {
    const base = path.basename(file);
    const relPath = path.relative(sourceRoot, file).replace(/\\/g, "/").toLowerCase();
    if (relPath.includes("book versions/")) return false;
    // Only include numbered notes like 000-*.md, 001-*.md
    return /^\d{3}-/.test(base);
  });
  const stats = await Promise.all(
    files.map(async (file) => ({ file, stat: await fs.stat(file) })),
  );
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const seenIndex = new Set();
  const unique = [];
  for (const s of stats) {
    const base = path.basename(s.file);
    const m = base.match(/^(\d{3})-/);
    const idx = m?.[1];
    if (!idx) continue;
    if (seenIndex.has(idx)) continue;
    seenIndex.add(idx);
    unique.push(s);
  }
  const wanted = new Set();

  for (const { file, stat } of unique) {
    const baseTitle = path.basename(file, path.extname(file));
    const updatedDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);

    const raw = await fs.readFile(file, "utf8");
    const cleanedLinks = stripObsidianArtifacts(raw);
    const withImages = await transformEmbeds({
      markdown: cleanedLinks,
      obsidianRoot,
      sourceDir: path.dirname(file),
      publicAssetsDir,
    });
    const withFm = ensureFrontmatter(withImages, { title: baseTitle, updatedDate });

    const slug = toSlugFilename(file, sourceRoot);
    const outPath = path.join(destRoot, `${slug}.md`);
    wanted.add(outPath);
    await fs.writeFile(outPath, withFm, "utf8");
  }

  if (process.argv.includes("--prune")) {
    const existing = await fs.readdir(destRoot);
    for (const name of existing) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      const full = path.join(destRoot, name);
      if (!wanted.has(full)) await fs.rm(full);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Synced ${unique.length} file(s) from: ${sourceRoot}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
