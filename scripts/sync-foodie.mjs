import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_RELATIVE_SOURCE = path.join("6-Roles", "Chef", "料理笔记");
const DEFAULT_ATTACHMENTS_REL = "Attachments";

function resolveObsidianRoot() {
  const root = process.env.OBSIDIAN_ROOT?.trim();
  if (root) return root;
  throw new Error(
    "Missing OBSIDIAN_ROOT. Set it before running sync, for example: OBSIDIAN_ROOT='/path/to/obsidian' npm run sync:foodie",
  );
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function stripObsidianArtifacts(markdown) {
  // Keep image embeds `![[...]]` intact; they are handled later.
  let out = markdown.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_m, inner) => {
    const [targetRaw, aliasRaw] = String(inner).split("|");
    const label = (aliasRaw ?? targetRaw ?? "").trim();
    return label ? label : "";
  });
  out = out.replace(/^~~.*?~~\s*$/gm, "");
  return out.trim() + "\n";
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
  // target may include subpaths; Obsidian embeds usually reference filename.
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
  const copied = new Map(); // src -> publicUrl

  const out = markdown.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner) => {
    const raw = String(inner);
    const target = raw.split("|")[0]?.trim() ?? "";
    if (!target) return "";
    const alt = path.basename(target);
    // Placeholder URL; actual copy happens after replace
    const key = `${sourceDir}::${target}`;
    const fileHash = hashShort(key);
    const ext = path.extname(alt);
    const base = ext ? alt.slice(0, -ext.length) : alt;
    const safeBase = base.replace(/[\\/:"*?<>|]+/g, " ").replace(/\s+/g, " ").trim();
    const outName = `${fileHash}-${safeBase}${ext}`.slice(0, 120);
    const publicUrl = `/foodie-assets/${encodeURIComponent(outName)}`;
    copied.set(key, { target, outName, publicUrl });
    return `![${alt}](${publicUrl})`;
  });

  // Copy assets (best-effort)
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
      // ignore copy failures; markdown will still render without image if missing
    }
  }

  return out;
}

function ensureFrontmatter(markdown, { title, updatedDate, index }) {
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
    `index: ${index}`,
    "---",
    "",
  ].join("\n");
  return header + markdown;
}

async function main() {
  const obsidianRoot = resolveObsidianRoot();
  const relativeSource = process.env.FOODIE_SOURCE_REL || DEFAULT_RELATIVE_SOURCE;
  const sourceRoot = path.join(obsidianRoot, relativeSource);

  const websiteRoot = process.cwd();
  const destRoot = path.join(websiteRoot, "src", "content", "foodie");
  const publicAssetsDir = path.join(websiteRoot, "public", "foodie-assets");
  await fs.mkdir(destRoot, { recursive: true });

  const files = await walk(sourceRoot);
  const stats = await Promise.all(
    files.map(async (file) => ({ file, stat: await fs.stat(file) })),
  );

  // Sort by time (newest first), then assign index starting from 1 (001)
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const wanted = new Set();
  for (let i = 0; i < stats.length; i++) {
    const { file, stat } = stats[i];
    const baseTitle = path.basename(file, path.extname(file))
      .replace(/^✅\s*/u, "")
      .trim();
    const updatedDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
    const index = i + 1;

    const raw = await fs.readFile(file, "utf8");
    const cleanedLinks = stripObsidianArtifacts(raw);
    const withImages = await transformEmbeds({
      markdown: cleanedLinks,
      obsidianRoot,
      sourceDir: path.dirname(file),
      publicAssetsDir,
    });
    const withFm = ensureFrontmatter(withImages, { title: baseTitle, updatedDate, index });

    const prefix = String(index).padStart(3, "0");
    const safeName = baseTitle
      .normalize("NFKC")
      // drop emoji / symbols; keep letters, numbers, spaces, dashes, underscores, and CJK
      .replace(/[^\p{Letter}\p{Number}\p{Script=Han}\s\-_]+/gu, " ")
      .replace(/[\\/:"*?<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 60) || "note";
    const outPath = path.join(destRoot, `${prefix}-${safeName}.md`);
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
  console.log(`Synced ${files.length} file(s) from: ${sourceRoot}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
