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
    'customer_access_token:localStorage.getItem(customerTokenStorageKey) || null',
    'customer_payment_method',
    'fetch("/api/public/stores/" + encodeURIComponent(slug) + "/orders"',
    'function submitOrder(event)',
    'cash_on_delivery',
    'shamcash',
    'id="customerOrdersSection"',
    'function renderCustomerQr()',
    'customerPortalTimer=setInterval',
    'X-Customer-Token'
  ]) assert.ok(html.includes(marker), "missing checkout behavior: " + marker);
  assert.ok(!html.includes('id="transactionReference"'), "Sham Cash transfer details must not be requested before handover");
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


test("Frontend API requests have a finite timeout and show a retryable message", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /new AbortController\(\)/);
  assert.match(html, /setTimeout\(\(\) => controller\.abort\(\), 12000\)/);
  assert.match(html, /clearTimeout\(timeoutId\)/);
  assert.match(html, /انتهت مهلة الاتصال بالخادم/);
});


test("Language translation disconnects its mutation observer during DOM updates", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  const start = html.indexOf("function applyLanguage()");
  const end = html.indexOf("\n  const languageObserver", start);
  assert.ok(start >= 0 && end > start);
  const applyLanguage = html.slice(start, end);
  assert.match(applyLanguage, /languageObserver\.disconnect\(\)/);
  assert.match(applyLanguage, /languageObserver\.observe\(document\.body/);
  assert.ok(applyLanguage.indexOf("languageObserver.disconnect()") < applyLanguage.indexOf("languageObserver.observe("));
});


test("Admin dashboard is full-width and readable on mobile", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /\.dashboard\{width:100%;min-width:0\}/);
  assert.match(html, /\.admin-panel\{width:100%;max-width:100%;min-width:0/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /ar-EG-u-nu-latn/);
  assert.match(html, /activity-details/);
  assert.match(html, /Changed fields/);
});


test("Language switching translates dynamic text in both directions", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /const translated = translateText\(sourceText\)/);
  assert.doesNotMatch(html, /currentLanguage === "en" \? translateText\(sourceText\) : sourceText/);
  assert.match(html, /return "\\u2068" \+ formatted \+ "\\u2069"/);
});


test("Platform footer exposes company, support, advertising and service request entry points", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  for (const label of ["من نحن","تواصل معنا","مركز الدعم","طلب إنشاء متجر","طلب تصميم موقع","طلب إعلان على مواقعنا"]) {
    assert.ok(html.includes(label), "Missing footer entry: " + label);
  }
  assert.match(html, /id="publicServiceRequestForm"/);
  assert.match(html, /id="serviceRequestModal"/);
  assert.match(html, /id="aboutModal"/);
});

test("Admin dashboard includes service request review and update UI", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /id="platformServiceRequests"/);
  assert.match(html, /api\/admin\/service-requests/);
  assert.match(html, /api\/service-requests/);
});

test("Language switching translates original input attributes in both directions", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /const value = translateText\(originals\[attr\]\)/);
  assert.doesNotMatch(html, /currentLanguage === "en" \? translateText\(originals\[attr\]\) : originals\[attr\]/);
});


test("Merchant portal is a separate store-only interface", async () => {
  const html = await readFile(new URL("../../frontend/merchant.html", import.meta.url), "utf8");
  assert.match(html, /دخول صاحب المتجر/);
  assert.match(html, /الطلبات/);
  assert.match(html, /المنتجات/);
  assert.match(html, /سجل الزبائن/);
  assert.match(html, /\/api\/auth\/me/);
  assert.match(html, /\/api\/stores\//);
  assert.doesNotMatch(html, /\/api\/admin\//);
  assert.match(html, /data-decision="accepted"/);
  assert.match(html, /data-decision="rejected"/);
  assert.match(html, /complete_delivery:true/);
  assert.match(html, /data-complete-delivery/);
  assert.match(html, /setInterval\(\(\)=>\{if\(activeStore\)\{loadOrders\(\);loadNotifications\(\);\}\},10000\)/);
  assert.doesNotMatch(html, /data-pay(?:=|")|payment_status:"paid"|سجّل استلام المبلغ أولاً قبل إكمال الطلب/);
  assert.match(html, /requestedStoreSlug/);
  assert.match(html, /stores\.find\(s=>s\.slug===requestedStoreSlug/);
  assert.match(html, /requestedStoreSlug==="omaya"&&s\.slug==="omaya-pastries"/);
  assert.doesNotMatch(html, /storePickerWrap|storePicker/);
  assert.match(html, /id="productForm"/);
  assert.match(html, /data-edit-product/);
  assert.match(html, /data-archive-product/);
  assert.match(html, /method:"PUT"/);
  assert.match(html, /method:"POST"/);
  assert.match(html, /value="piece">قطعة/);
  assert.match(html, /value="kg">كيلو/);
  assert.match(html, /id="productImageUrl"/);
  assert.match(html, /products.*images/);
  assert.match(html, /alt_text:body.name/);



  assert.doesNotMatch(html, /id="adminPanel"|id="accountGrid"|إدارة المنصة المركزية/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "merchant portal script must exist");
  for (const match of scripts) {
    assert.doesNotThrow(() => new vm.Script(match[1]), "merchant JavaScript must parse");
  }
});
