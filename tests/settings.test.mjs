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
import {
  defaultColors,
  getTheme,
  normalizeHex,
  contrastRatio,
} from "../themes.mjs";
const here = path.resolve(import.meta.dirname, "..");
const fixture = () => mkdtempSync(path.join(tmpdir(), "starter-settings-"));
test("wizard asks for three hex colors, retries invalid input, and accepts defaults", async () => {
  const answers = [
    "../bad",
    "Sample Space",
    "forest",
    "#DBE6DE",
    "#ABC",
    "",
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
  assert.equal(result.primary, "#dbe6de");
  assert.equal(result.secondary, "#aabbcc");
  assert.equal(result.tertiary, defaultColors.tertiary);
  assert.equal(result.author, "Sample Author");
  assert.equal(result.description, defaultDescription);
  assert.equal(answers.length, 0);
  assert.ok(prompts[0].startsWith("App title"));
  assert.ok(prompts.some((q) => q.startsWith("Primary color")));
  assert.ok(prompts.some((q) => q.startsWith("Secondary color")));
  assert.ok(prompts.some((q) => q.startsWith("Tertiary color")));
  assert.ok(messages.some((m) => m.includes("must be a hex color")));
});
test("an existing title skips only that question, and complete flags require no questions", async () => {
  const prompts = [],
    answers = ["", "", "", "", ""];
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
  assert.equal(result.primary, defaultColors.primary);
  assert.equal(result.secondary, defaultColors.secondary);
  assert.equal(result.tertiary, defaultColors.tertiary);
  assert.equal(result.author, "");
  assert.equal(prompts.length, 5);
  assert.ok(prompts[0].startsWith("Primary color"));
  const supplied = {
    title: "From Flags",
    primary: "#123456",
    secondary: "#abcdef",
    tertiary: "#fedcba",
    author: "A. Name",
    description: "A useful app.",
  };
  assert.deepEqual(
    await collectSettings(supplied, {
      question: async () => assert.fail("complete flags must not prompt"),
      write: () => {},
      validateTitle: appSlug,
    }),
    supplied,
  );
});
test("CLI parses hex role flags and rejects obsolete presets and misspelled options", () => {
  assert.equal(parseCliArgs([]).title, undefined);
  assert.equal(parseCliArgs(["--help"]).help, true);
  const parsed = parseCliArgs([
    "My App",
    "--primary=#dbe6de",
    "--secondary",
    "#123456",
    "--tertiary",
    "#aabbcc",
    "--author",
    "Test Author",
    "--description",
    "Notes",
    "--directory",
    "/tmp",
    "-y",
  ]);
  assert.equal(parsed.primary, "#dbe6de");
  assert.equal(parsed.secondary, "#123456");
  assert.equal(parsed.tertiary, "#aabbcc");
  assert.equal(parsed.yes, true);
  assert.equal(parsed.directory, "/tmp");
  assert.throws(() => parseCliArgs(["one", "two"]));
  assert.throws(() => parseCliArgs(["--theme", "forest"]));
  assert.throws(() => parseCliArgs(["--primery", "#fff"]));
  assert.throws(() => parseCliArgs(["--author"]));
});
test("invalid hex colors and metadata fail before creating any files", async () => {
  const directory = fixture();
  try {
    for (const options of [
      { primary: "custom; color:red" },
      { secondary: "#abcd" },
      { tertiary: "blue" },
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
      primary: "#dbe6de",
      secondary: "#244a3c",
      tertiary: "#b8cbbd",
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
      theme: { ...defaultColors },
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
    assert.ok(css.includes("--theme-primary: #dbe6de"));
    assert.ok(css.includes("--theme-secondary: #244a3c"));
    assert.ok(css.includes("--theme-tertiary: #b8cbbd"));

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
    const selected = getTheme(defaultColors);
    assert.ok(icon.includes(selected.colors.story));
    assert.ok(icon.includes(selected.colors["story-accent"]));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("hex normalization preserves exact color choices and rejects CSS payloads", () => {
  assert.equal(normalizeHex("#DBE6DE"), "#dbe6de");
  assert.equal(normalizeHex(" #aBc "), "#aabbcc");
  for (const value of [
    "forest",
    "123456",
    "#abcd",
    "#12345678",
    "#ffgg00",
    "#fff; color:red",
    "rgb(1,2,3)",
    null,
  ])
    assert.throws(() => normalizeHex(value));
  assert.throws(() => getTheme("forest"));
  assert.deepEqual(getTheme().palette, defaultColors);
});
test("light, dark, vivid and matching colors retain all three values with readable text", () => {
  for (const palette of [
    defaultColors,
    { primary: "#ffffff", secondary: "#ffffff", tertiary: "#ffffff" },
    { primary: "#000000", secondary: "#000000", tertiary: "#000000" },
    { primary: "#777777", secondary: "#123456", tertiary: "#ffff00" },
    { primary: "#ff0000", secondary: "#00ff00", tertiary: "#0000ff" },
  ]) {
    const theme = getTheme(palette);
    assert.deepEqual(theme.palette, palette);
    for (const value of Object.values(theme.colors))
      assert.match(value, /^#[0-9a-f]{6}$/);
    for (const role of ["primary", "secondary", "tertiary", "story"])
      assert.ok(
        contrastRatio(theme.colors[role], theme.colors[role + "-foreground"]) >=
          4.5,
        role + " text contrast",
      );
    assert.ok(contrastRatio(theme.colors.link, theme.colors.surface) >= 4.5);
    assert.ok(
      contrastRatio(theme.colors["story-accent"], theme.colors.story) >= 4.5,
    );
    for (const role of ["primary", "secondary", "tertiary"])
      assert.equal(theme.colors[role], palette[role]);
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
        "--primary",
        "#dbe6de",
        "--secondary",
        "#123456",
        "--tertiary",
        "#fedcba",
        "--author",
        "Test Author",
        "--description",
        "A sample workspace.",
        "--yes",
      ],
      { cwd: here, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /primary #dbe6de, secondary #123456, tertiary #fedcba/,
    );
    const config = JSON.parse(
      readFileSync(path.join(directory, "cli-sample/app.config.json"), "utf8"),
    );
    assert.equal(config.author, "Test Author");
    assert.equal(config.description, "A sample workspace.");
    assert.deepEqual(config.theme, {
      primary: "#dbe6de",
      secondary: "#123456",
      tertiary: "#fedcba",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
