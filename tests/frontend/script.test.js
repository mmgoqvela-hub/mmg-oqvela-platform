import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("Frontend inline JavaScript parses without syntax errors", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "frontend script must exist");
  for (const match of scripts) {
    assert.doesNotThrow(() => new vm.Script(match[1]), "frontend JavaScript must parse");
  }
});
