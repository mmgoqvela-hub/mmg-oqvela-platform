import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("POS page inline JavaScript parses without syntax errors",()=>{
  const html=fs.readFileSync(new URL("../../frontend/pos.html",import.meta.url),"utf8");
  const start=html.indexOf("<script>")+8;
  const end=html.indexOf("</script>",start);
  assert.ok(start>=8&&end>start,"POS inline script exists");
  new vm.Script(html.slice(start,end));
});
