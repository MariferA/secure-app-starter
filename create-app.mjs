import {
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import net from "node:net";
import * as prettier from "prettier";
import { setup } from "./template/scripts/setup.mjs";
const here = fileURLToPath(new URL(".", import.meta.url));
export function appSlug(title) {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 80 ||
    /[\x00-\x1f\x7f/\\]/.test(title)
  )
    throw new Error(
      "Use a title of 1–80 characters without slashes or control characters.",
    );
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug.length > 48)
    throw new Error("Use a shorter title (up to 48 slug characters).");
  if (!slug || ["node-modules", "secure-app-starter"].includes(slug))
    throw new Error("Choose a different app title.");
  return slug;
}
async function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}
async function ports(parent) {
  const used = new Set();
  for (const name of readdirSync(parent)) {
    const envFile = path.join(parent, name, ".env.example");
    if (existsSync(envFile) && lstatSync(envFile).isFile()) {
      const text = readFileSync(envFile, "utf8");
      for (const match of text.matchAll(/^(?:WEB_PORT|API_PORT)=(\d+)$/gm))
        used.add(Number(match[1]));
    }
  }
  let web = 5180,
    api = 8084;
  while (web <= 65535 && (used.has(web) || !(await freePort(web)))) web++;
  while (
    api <= 65535 &&
    (used.has(api) || api === web || !(await freePort(api)))
  )
    api++;
  if (web > 65535 || api > 65535) throw new Error("No local ports available.");
  return { web, api };
}
function walk(root, prefix = "") {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = path.join(prefix, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Template symlinks are not permitted.");
      if (
        ["node_modules", ".git", ".secrets", "dist", "coverage"].includes(
          entry.name,
        ) ||
        entry.name === ".env" ||
        (entry.name.startsWith(".env.") && entry.name !== ".env.example") ||
        /\.(pem|key|tgz)$/.test(entry.name)
      )
        throw new Error("Private/build artifact in template: " + relative);
      return entry.isDirectory() ? walk(root, relative) : [relative];
    },
  );
}
export async function createApp(
  title,
  { directory = path.dirname(here), git = true } = {},
) {
  const name = title.trim(),
    slug = appSlug(title);
  const parent = realpathSync(directory),
    target = path.join(parent, slug);
  if (existsSync(target))
    throw new Error("Destination already exists: " + target);
  const { web, api } = await ports(parent);
  const template = path.join(here, "template");
  const files = walk(template);
  const formatOptions = await prettier.resolveConfig(
    path.join(template, ".prettierrc"),
  );
  mkdirSync(target, { mode: 0o755 });
  try {
    for (const file of files) {
      const output = path.join(target, file);
      mkdirSync(path.dirname(output), { recursive: true });
      let content = readFileSync(path.join(template, file), "utf8");
      for (const [token, value] of Object.entries({
        __APP_SLUG__: slug,
        __APP_TITLE_JSON__: JSON.stringify(name),
        __WEB_PORT__: String(web),
        __API_PORT__: String(api),
        __DB_NAME__: slug.replaceAll("-", "_"),
      }))
        content = content.replaceAll(token, value);
      if (
        /__APP_SLUG__|__APP_TITLE_JSON__|__WEB_PORT__|__API_PORT__|__DB_NAME__/.test(
          content,
        )
      )
        throw new Error("Unresolved template token in " + file);
      if (
        file !== "pnpm-lock.yaml" &&
        (await prettier.getFileInfo(output)).inferredParser
      )
        content = await prettier.format(content, {
          ...formatOptions,
          filepath: output,
        });
      writeFileSync(output, content, {
        flag: "wx",
        mode: file === ".husky/pre-commit" ? 0o755 : 0o644,
      });
    }
    setup(target);
    if (git) {
      const result = spawnSync("git", ["init", "-b", "main"], {
        cwd: target,
        encoding: "utf8",
      });
      if (result.status !== 0)
        throw new Error(
          "Git initialization failed: " +
            (result.stderr || result.error?.message),
        );
    }
    return { target, slug, name, webPort: web, apiPort: api };
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (
      !args[0] ||
      args.length > 3 ||
      (args.length > 1 && (args[1] !== "--directory" || !args[2]))
    )
      throw new Error(
        'Usage: pnpm create:app "App Title" [--directory /absolute/parent]',
      );
    const result = await createApp(args[0], { directory: args[2] });
    console.log(
      "Created " +
        result.name +
        " at " +
        result.target +
        "\nWeb: http://localhost:" +
        result.webPort +
        " · API: http://localhost:" +
        result.apiPort +
        "\nNext: cd " +
        JSON.stringify(result.target) +
        " && pnpm install\nAdd your own Google/MongoDB settings to .env, then run pnpm dev.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
