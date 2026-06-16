import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DEFAULT_RELATIVE_SOURCE = path.join("D0 - Role Collections", "Chef", "料理笔记");
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

async function buildAttachmentIndex(obsidianRoot) {
  const files = await walkAllFiles(obsidianRoot);
  const index = new Map();
  for (const file of files) {
    const name = path.basename(file);
    if (!index.has(name)) index.set(name, file);
  }
  return index;
}

async function walkAllFiles(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkAllFiles(full)));
    else if (ent.isFile()) out.push(full);
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
  out = out.replace(/[ \t]+$/gm, "");
  return out.trim() + "\n";
}

function normalizeSpaces(input) {
  return String(input).replace(/\s+/g, " ").trim();
}

function stripStatusPrefix(title) {
  return normalizeSpaces(String(title).replace(/^[✅❌💪]\s*/u, ""));
}

function publicTitle(title) {
  return normalizeSpaces(
    stripStatusPrefix(title).replace(/[（(]\s*Dary[^)）]*[)）]\s*$/iu, ""),
  );
}

function safeStem(title) {
  return (
    normalizeSpaces(title)
      .normalize("NFKC")
      .replace(/[^\p{Letter}\p{Number}\p{Script=Han}\s\-_]+/gu, " ")
      .replace(/[\\/:"*?<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 60) || "note"
  );
}

function frontmatterValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*["']?(.*?)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
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

function optimizeImage(filePath) {
  try {
    execFileSync("sips", ["-s", "formatOptions", "78", "-Z", "1600", filePath], {
      stdio: "ignore",
    });
  } catch {
    // Image optimization is best-effort; sync should still complete on non-macOS hosts.
  }
}

async function resolveAttachment({ attachmentsDir, sourceDir, target, attachmentIndex }) {
  const normalized = String(target).replace(/^\.\/+/, "");
  const decoded = decodeURIComponent(normalized);
  const withoutAttachmentsPrefix = normalized.replace(/^Attachments[\\/]/, "");
  const decodedWithoutAttachmentsPrefix = decoded.replace(/^Attachments[\\/]/, "");
  const fileName = path.basename(withoutAttachmentsPrefix);
  const decodedFileName = path.basename(decodedWithoutAttachmentsPrefix);
  const candidates = [
    path.join(sourceDir, normalized),
    path.join(sourceDir, decoded),
    path.join(sourceDir, fileName),
    path.join(sourceDir, decodedFileName),
    path.join(sourceDir, "Attachments", fileName),
    path.join(sourceDir, "Attachments", decodedFileName),
    path.join(attachmentsDir, withoutAttachmentsPrefix),
    path.join(attachmentsDir, decodedWithoutAttachmentsPrefix),
    path.join(attachmentsDir, fileName),
    path.join(attachmentsDir, decodedFileName),
    path.join(path.dirname(attachmentsDir), normalized),
    path.join(path.dirname(attachmentsDir), decoded),
  ];
  for (const c of candidates) if (await exists(c)) return c;
  const indexed = attachmentIndex.get(fileName) ?? attachmentIndex.get(decodedFileName);
  if (indexed) return indexed;
  return null;
}

async function transformEmbeds({
  markdown,
  obsidianRoot,
  sourceDir,
  publicAssetsDir,
  attachmentIndex,
  wantedAssets,
}) {
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
      attachmentIndex,
    });
    if (!src) continue;
    const dest = path.join(publicAssetsDir, v.outName);
    wantedAssets.add(dest);
    try {
      await fs.copyFile(src, dest);
      optimizeImage(dest);
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

async function readExistingEntries(destRoot) {
  const out = new Map();
  let existingFromGit = [];

  try {
    const listed = execFileSync(
      "git",
      ["ls-tree", "-r", "-z", "--name-only", "HEAD", "src/content/foodie"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    existingFromGit = listed
      .split("\0")
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().endsWith(".md"));
  } catch {
    existingFromGit = [];
  }

  const existing =
    existingFromGit.length > 0
      ? existingFromGit.map((relativePath) => ({
          name: path.basename(relativePath),
          full: relativePath,
          fromGit: true,
        }))
      : (await fs.readdir(destRoot).catch(() => []))
          .filter((name) => name.toLowerCase().endsWith(".md"))
          .map((name) => ({
            name,
            full: path.join(destRoot, name),
            fromGit: false,
          }));

  for (const entry of existing) {
    const source = entry.fromGit
      ? execFileSync("git", ["show", `HEAD:${entry.full}`], {
          cwd: process.cwd(),
          encoding: "utf8",
        })
      : await fs.readFile(entry.full, "utf8");
    const parts = source.split("---");
    const frontmatter = parts[1] ?? "";
    const title = frontmatterValue(frontmatter, "title");
    const index = Number(frontmatterValue(frontmatter, "index"));
    const stem = entry.name.replace(/\.md$/i, "");
    const cleaned = publicTitle(title || stem.replace(/^\d+-/, ""));
    const key = safeStem(cleaned);

    if (!key || !Number.isFinite(index)) continue;
    out.set(key, {
      index,
      fileName: entry.name,
      title: cleaned,
    });
  }

  return out;
}

function findExistingEntry(existingEntries, cleanedTitle, entryKey) {
  const direct = existingEntries.get(entryKey);
  if (direct) return direct;

  const normalizedTitle = normalizeSpaces(cleanedTitle);
  const fuzzyMatches = [...existingEntries.values()].filter((entry) => {
    const existingTitle = normalizeSpaces(entry.title);
    return (
      existingTitle.includes(normalizedTitle) ||
      normalizedTitle.includes(existingTitle)
    );
  });

  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  return null;
}

async function main() {
  const obsidianRoot = resolveObsidianRoot();
  const relativeSource = process.env.FOODIE_SOURCE_REL || DEFAULT_RELATIVE_SOURCE;
  const sourceRoot = path.join(obsidianRoot, relativeSource);

  const websiteRoot = process.cwd();
  const destRoot = path.join(websiteRoot, "src", "content", "foodie");
  const publicAssetsDir = path.join(websiteRoot, "public", "foodie-assets");
  await fs.mkdir(destRoot, { recursive: true });
  const existingEntries = await readExistingEntries(destRoot);
  const attachmentIndex = await buildAttachmentIndex(obsidianRoot);

  const files = await walk(sourceRoot);
  const stats = await Promise.all(
    files.map(async (file) => ({ file, stat: await fs.stat(file) })),
  );

  // Start with the files you already published, so a small content edit
  // does not reshuffle the whole Foodie section.
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const maxExistingIndex = Math.max(0, ...[...existingEntries.values()].map((entry) => entry.index));
  let nextIndex = maxExistingIndex + 1;

  const wanted = new Set();
  const wantedAssets = new Set();
  for (let i = 0; i < stats.length; i++) {
    const { file, stat } = stats[i];
    const rawTitle = path.basename(file, path.extname(file));
    const cleanedTitle = publicTitle(rawTitle);
    const updatedDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
    const entryKey = safeStem(cleanedTitle);
    const existingEntry = findExistingEntry(existingEntries, cleanedTitle, entryKey);
    const index = existingEntry?.index ?? nextIndex++;

    const raw = await fs.readFile(file, "utf8");
    const cleanedLinks = stripObsidianArtifacts(raw);
    const withImages = await transformEmbeds({
      markdown: cleanedLinks,
      obsidianRoot,
      sourceDir: path.dirname(file),
      publicAssetsDir,
      attachmentIndex,
      wantedAssets,
    });
    const withFm = ensureFrontmatter(withImages, { title: cleanedTitle, updatedDate, index });

    const prefix = String(index).padStart(3, "0");
    const outFileName = existingEntry?.fileName ?? `${prefix}-${safeStem(cleanedTitle)}.md`;
    const outPath = path.join(destRoot, outFileName);
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

    const assets = await fs.readdir(publicAssetsDir).catch(() => []);
    for (const name of assets) {
      const full = path.join(publicAssetsDir, name);
      if (!wantedAssets.has(full)) await fs.rm(full);
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
