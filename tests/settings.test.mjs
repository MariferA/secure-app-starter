import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createApp, appSlug, escapeHtml } from "../create-app.mjs";
import {
  parseCliArgs,
  collectSettings,
  metadataText,
  defaultDescription,
} from "../settings.mjs";
import { themes, getTheme } from "../themes.mjs";
const here = path.resolve(import.meta.dirname, "..");
const fixture = () => mkdtempSync(path.join(tmpdir(), "starter-settings-"));
test("wizard asks for the title, validates theme answers, and accepts defaults", async () => {
  const answers = [
    "../bad",
    "Sample Space",
    "invalid",
    "2",
    "Sample Author",
    "",
  ];
  const prompts = [],
    messages = [];
  const result = await collectSettings(
    {},
    {
      question: async (query) => {
        prompts.push(query);
        assert.ok(answers.length);
        return answers.shift();
      },
      write: (value) => messages.push(value),
      validateTitle: appSlug,
    },
  );
  assert.equal(result.title, "Sample Space");
  assert.equal(result.theme, "blue");
  assert.equal(result.author, "Sample Author");
  assert.equal(result.description, defaultDescription);
  assert.equal(answers.length, 0);
  assert.ok(prompts[0].startsWith("App title"));
  assert.ok(messages.some((m) => m.includes("without slashes")));
  assert.ok(messages.some((m) => m.includes("Choose a theme:")));
});
test("existing title skips only that question and flags can provide every setting", async () => {
  const prompts = [];
  const answers = ["", "", ""];
  const result = await collectSettings(
    { title: "Next App" },
    {
      question: async (q) => {
        prompts.push(q);
        return answers.shift();
      },
      write: () => {},
      validateTitle: appSlug,
    },
  );
  assert.equal(result.theme, "forest");
  assert.equal(result.author, "");
  assert.equal(prompts.length, 3);
  assert.ok(prompts[0].startsWith("Theme"));
  const supplied = {
    title: "From Flags",
    theme: "violet",
    author: "A. Name",
    description: "A useful app.",
  };
  assert.deepEqual(
    await collectSettings(supplied, {
      question: async () => assert.fail("flags must not prompt"),
      write: () => {},
      validateTitle: appSlug,
    }),
    supplied,
  );
});
test("CLI parsing supports interactive mode, flags and help and rejects typos", () => {
  assert.equal(parseCliArgs([]).title, undefined);
  assert.equal(parseCliArgs(["--help"]).help, true);
  const parsed = parseCliArgs([
    "My App",
    "--theme=rose",
    "--author",
    "Test Author",
    "--description",
    "Receipts & notes",
    "--directory",
    "/tmp",
    "-y",
  ]);
  assert.equal(parsed.theme, "rose");
  assert.equal(parsed.yes, true);
  assert.equal(parsed.directory, "/tmp");
  assert.throws(() => parseCliArgs(["one", "two"]));
  assert.throws(() => parseCliArgs(["--theem", "blue"]));
  assert.throws(() => parseCliArgs(["--author"]));
});
test("unsupported themes and invalid metadata fail before creating any files", async () => {
  const directory = fixture();
  try {
    for (const options of [
      { theme: "custom; color:red" },
      { author: "invalid\nname" },
      { description: "x".repeat(241) },
    ])
      await assert.rejects(
        createApp("Never Created", { directory, ...options }),
      );
    assert.deepEqual(readdirSync(directory), []);
    assert.throws(() => metadataText("\u001b[31m", "Author", 100));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("generated theme, favicon and metadata share the chosen settings and preserve literal user text", async () => {
  const directory = fixture();
  try {
    const name = "Field $&",
      author = 'A "quoted" & <name>',
      description = 'Track "$&" <script>alert("x")</script> & __APP_SLUG__.';
    const app = await createApp(name, {
      directory,
      theme: "violet",
      author,
      description,
    });
    const config = JSON.parse(
      readFileSync(path.join(app.target, "app.config.json"), "utf8"),
    );
    assert.deepEqual(config, {
      name,
      slug: "field",
      author,
      description,
      theme: "violet",
    });
    for (const file of [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
    ]) {
      const pkg = JSON.parse(readFileSync(path.join(app.target, file), "utf8"));
      assert.equal(pkg.author, author);
      assert.equal(pkg.description, description);
    }
    const html = readFileSync(
      path.join(app.target, "apps/web/index.html"),
      "utf8",
    );
    assert.ok(html.includes("Field $&amp;"));
    const metaValue = (name) => {
      const tag = html.match(
        new RegExp("<meta\\s+name=[\"']" + name + "[\"'][\\s\\S]*?/>"),
      )[0];
      return tag.match(/content=(["'])([\s\S]*?)\1/)[2].replace(
        /&(?:amp|lt|gt|quot|#39);/g,
        (entity) =>
          ({
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&#39;": "'",
          })[entity],
      );
    };
    assert.equal(metaValue("description"), description);
    assert.equal(metaValue("author"), author);
    assert.equal(escapeHtml("<\"&'>"), "&lt;&quot;&amp;&#39;&gt;");
    assert.ok(!html.includes("<script>alert"));
    const css = readFileSync(
      path.join(app.target, "apps/web/src/theme.css"),
      "utf8",
    );
    assert.ok(css.includes("--theme-primary: #6d28d9"));
    assert.ok(css.includes("--theme-story: #2e1554"));
    assert.ok(!/__APP_THEME/.test(css));
    const styles = readFileSync(
      path.join(app.target, "apps/web/src/index.css"),
      "utf8",
    );
    assert.ok(styles.includes("@import './theme.css'"));
    assert.ok(!/#(?:163b30|254f3c|d9f584)\b/i.test(styles));
    const icon = readFileSync(
      path.join(app.target, "apps/web/public/favicon.svg"),
      "utf8",
    );
    assert.ok(icon.includes("#2e1554"));
    assert.ok(icon.includes("#c4b5fd"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("all presets have complete colors and readable primary and story text", () => {
  const luminance = (hex) => {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((c) => parseInt(c, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const [index, theme] of themes.entries()) {
    assert.equal(getTheme(String(index + 1)), theme);
    assert.deepEqual(Object.keys(theme.colors), Object.keys(themes[0].colors));
    for (const color of Object.values(theme.colors))
      assert.match(color, /^#[0-9a-f]{6}$/);
    assert.ok(
      contrast(theme.colors.primary, theme.colors.card) >= 4.5,
      theme.id + " button contrast",
    );
    assert.ok(
      contrast(theme.colors.story, theme.colors["story-foreground"]) >= 4.5,
      theme.id + " story contrast",
    );
  }
});
test("noninteractive CLI accepts settings without hanging and missing titles explain how to run", () => {
  const directory = fixture();
  try {
    const empty = spawnSync(
      process.execPath,
      [path.join(here, "create-app.mjs"), "--directory", directory],
      { cwd: here, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /terminal.*setup prompts/);
    assert.deepEqual(readdirSync(directory), []);
    const result = spawnSync(
      process.execPath,
      [
        path.join(here, "create-app.mjs"),
        "CLI Sample",
        "--directory",
        directory,
        "--theme",
        "amber",
        "--author",
        "Test Author",
        "--description",
        "A sample workspace.",
        "--yes",
      ],
      { cwd: here, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Warm amber/);
    const config = JSON.parse(
      readFileSync(path.join(directory, "cli-sample/app.config.json"), "utf8"),
    );
    assert.equal(config.author, "Test Author");
    assert.equal(config.description, "A sample workspace.");
    assert.equal(config.theme, "amber");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
