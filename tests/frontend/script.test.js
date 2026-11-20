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


test("Arabic visible interface text has English translations", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  const dictionary = html.match(/const translations = \{([\s\S]*?)\n  \};/);
  assert.ok(dictionary, "translation dictionary must exist");
  const keys = new Set([...dictionary[1].matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm)].map(match => match[1]));
  const visibleHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const visibleArabic = [...visibleHtml.matchAll(/>([^<>]+)</g)]
    .map(match => match[1].replace(/\s+/g, " ").trim())
    .filter(value => /[\u0600-\u06FF]/.test(value) && value !== "العربية" && value !== "MMG OQVELA | منصة الأعمال الذكية");
  const missing = visibleArabic.filter(value => !keys.has(value));
  assert.deepEqual(missing, [], "every visible Arabic text node must have an English translation");
});

test("Language selection persists and updates document direction", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /id="languageToggle"/);
  assert.match(html, /localStorage\.getItem\("mmg_language"\)/);
  assert.match(html, /localStorage\.setItem\("mmg_language", currentLanguage\)/);
  assert.match(html, /document\.documentElement\.dir = currentLanguage === "ar" \? "rtl" : "ltr"/);
});

test("Arabic UI includes localized backend validation and authentication errors", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /const englishMessagesToArabic = \{/);
  for (const message of [
    "Invalid email or password",
    "Authentication required",
    "Too many login attempts. Try again in 15 minutes.",
    "Invalid settings data",
    "Account not found",
    "Unable to process subscription request"
  ]) {
    assert.ok(html.includes(JSON.stringify(message)), "missing Arabic translation for: " + message);
  }
});
