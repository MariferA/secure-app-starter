import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createApp, appSlug } from "../create-app.mjs";
test("safe slugs reject paths and control characters", () => {
  assert.equal(appSlug("Moto Trail"), "moto-trail");
  assert.equal(appSlug('A \"quoted\" app'), "a-quoted-app");
  assert.throws(() => appSlug("a".repeat(49)));
  assert.throws(() => appSlug("../outside"));
  assert.throws(() => appSlug("bad\nname"));
  assert.throws(() => appSlug("!!!"));
});
test("new projects have isolated keys, settings and Git history; existing files are preserved", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "starter-generator-"));
  try {
    const a = await createApp("First App", { directory }),
      b = await createApp("Second App", { directory });
    assert.notEqual(a.webPort, b.webPort);
    assert.notEqual(a.apiPort, b.apiPort);
    assert.notEqual(
      readFileSync(path.join(a.target, ".secrets/data-key"), "utf8"),
      readFileSync(path.join(b.target, ".secrets/data-key"), "utf8"),
    );
    assert.ok(
      readFileSync(path.join(a.target, ".env"), "utf8").includes(
        "MONGODB_URI=\n",
      ),
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(a.target, "app.config.json"), "utf8"))
        .name,
      "First App",
    );
    assert.equal(statSync(path.join(a.target, ".env")).mode & 0o777, 0o600);
    assert.ok(!existsSync(path.join(a.target, "apps/phone")));
    assert.ok(!existsSync(path.join(a.target, "deploy/releases")));
    assert.equal(
      spawnSync("git", ["remote", "-v"], { cwd: a.target, encoding: "utf8" })
        .stdout,
      "",
    );
    assert.equal(
      spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: a.target,
        encoding: "utf8",
      }).status,
      128,
    );
    writeFileSync(path.join(a.target, "keep.txt"), "keep");
    await assert.rejects(
      createApp("First App", { directory }),
      /already exists/,
    );
    assert.equal(readFileSync(path.join(a.target, "keep.txt"), "utf8"), "keep");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
