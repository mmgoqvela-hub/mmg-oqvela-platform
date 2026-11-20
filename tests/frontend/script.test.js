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


test("Storefront renders centrally managed announcements safely and in both languages",async()=>{
 const html=await readFile(new URL("../../frontend/storefront.html",import.meta.url),"utf8");
 assert.match(html,/platformAnnouncements/);
 assert.match(html,/textContent=language==="en"\?announcement\.title_en:announcement\.title_ar/);
 assert.match(html,/message\.textContent=language==="en"\?announcement\.message_en:announcement\.message_ar/);
 assert.match(html,/announcement_type/);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
 for(const match of scripts) assert.doesNotThrow(()=>new vm.Script(match[1]));
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

test("Public storefront page JavaScript parses and defines all five templates", async () => {
  const html = await readFile(new URL("../../frontend/storefront.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start + 8);
  assert.ok(start >= 0 && end > start, "storefront script must exist");
  assert.doesNotThrow(() => new vm.Script(html.slice(start + 8, end)), "storefront JavaScript must parse");
  for (const template of ["modern","classic","minimal","boutique","tech"]) {
    assert.ok(html.includes(`data-template="${template}"`) || html.includes(`"${template}"`), "missing template: " + template);
  }
  assert.ok(html.includes("/api/public/stores/"));
  assert.ok(html.includes("document.documentElement.dir"));
});


test("Store subscription panel displays trial expiry and renewal notices", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /sub\.expires_at && \["active", "expired"\]\.includes\(sub\.subscription_status\)/);
  assert.match(html, /sub\.is_trial\s*\? "انتهت الفترة التجريبية/);
  assert.match(html, /remainingDays <= 0 \|\| sub\.subscription_status === "expired"/);
  assert.match(html, /تنبيه: بقي /);
  assert.match(html, /أصبح المتجر مخفياً للزوار/);
  assert.match(html, /إعادة تفعيله بعد موافقة الإدارة/);
  assert.match(html, /The free trial has ended/);
});


test("Store subscription panel warns before and after paid subscription expiry", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /sub\.expires_at && \["active", "expired"\]\.includes\(sub\.subscription_status\)/);
  assert.match(html, /sub\.is_trial\s*\? "انتهت الفترة التجريبية[\s\S]*?: "انتهى الاشتراك المدفوع/);
  assert.match(html, /انتهى الاشتراك المدفوع\. أصبح المتجر مخفياً للزوار/);
  assert.match(html, /يوم على انتهاء الاشتراك المدفوع/);
  assert.match(html, /Your paid subscription has expired/);
});


test("Store dashboard loads period-based reports and renders report values as text",async()=>{
 const html=await readFile(new URL("../../frontend/index.html",import.meta.url),"utf8");
 assert.match(html,/\/reports\?period=/);
 assert.match(html,/function loadReport\(\)/);
 assert.match(html,/revenueTitle\.textContent="الإيرادات المؤكدة حسب العملة"/);
 assert.match(html,/line\.textContent=product\.product_name/);
 assert.match(html,/reportPeriod = "30d"/);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
 for(const match of scripts) assert.doesNotThrow(()=>new vm.Script(match[1]));
});

test("Storefront safely renders central WhatsApp support contact",async()=>{
 const html=await readFile(new URL("../../frontend/storefront.html",import.meta.url),"utf8");
 assert.match(html,/id="platformSupportContact"/);
 assert.match(html,/platform_support_whatsapp/);
 assert.match(html,/https:\/\/wa\.me\/" \+ supportPhone/);
 assert.match(html,/platformSupport:"Contact platform support"/);
});

test("Public storefront supports persistent cart, variant selection, stock limits and safe rendering", async () => {
  const html = await readFile(new URL("../../frontend/storefront.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start + 8);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new vm.Script(html.slice(start + 8, end)));
  for (const marker of [
    'id="cartItems"',
    'id="cartCount"',
    'localStorage.getItem(cartStorageKey)',
    'localStorage.setItem(cartStorageKey',
    'function addToCart(product,variant,quantity)',
    'product.variants.find(option => option.id === variantSelect.value)',
    'next > stock',
    'totals.entries()',
    'cartNote'
  ]) {
    assert.ok(html.includes(marker), "missing storefront cart behavior: " + marker);
  }
  assert.match(html, /name\.textContent = product\.name/);
  for (const marker of [
    'id="checkoutForm"',
    'id="paymentMethod"',
    'id="shamcashFields"',
    'id="transactionReference"',
    'fetch("/api/public/stores/" + encodeURIComponent(slug) + "/orders"',
    'function submitOrder(event)',
    'cash_on_delivery',
    'shamcash'
  ]) assert.ok(html.includes(marker), "missing checkout behavior: " + marker);
});


test("Public checkout prevents duplicate submissions and cart mutation while pending",async()=>{
 const html=await readFile(new URL("../../frontend/storefront.html",import.meta.url),"utf8");
 const start=html.indexOf("<script>");
 const end=html.indexOf("</script>",start+8);
 const script=html.slice(start+8,end);
 for(const marker of [
  "let orderSubmitting = false",
  "if (orderSubmitting || !cart.length) return",
  "orderSubmitting = true;",
  'querySelectorAll("button").forEach(control => { control.disabled = true; })',
  "orderSubmitting = false;"
 ]) assert.ok(script.includes(marker),"missing checkout protection: "+marker);
 assert.doesNotThrow(()=>new vm.Script(script));
});
