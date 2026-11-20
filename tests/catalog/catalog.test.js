import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { handleCatalog } from "../../backend/routes/catalog.js";

const TOKEN = "a".repeat(43);
const SESSION = {
  session_id: "session-001",
  user_id: "user-001",
  expires_at: "2099-01-01 00:00:00",
  full_name: "Test User",
  email: "test@example.com",
  user_status: "active"
};
const OWNER = { id:"store-001", store_status:"active", account_status:"active", account_role:"owner" };
const MEMBER = { ...OWNER, account_role:"member", store_member_id:"member-001", permissions:"catalog.read,inventory.read" };

function createDb(options = {}) {
  const calls = [];
  return {
    calls,
    async batch(statements) {
      calls.push(...statements.map(statement => ({sql:statement.sql, values:statement.values})));
      return (options.batchResults || statements.map(() => ({meta:{changes:1}})));
    },
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          return {
            sql, values,
            async first() {
              if (sql.includes("FROM auth_sessions")) return options.session === undefined ? SESSION : options.session;
              if (sql.includes("FROM stores s")) return options.access === undefined ? OWNER : options.access;
              if (sql.includes("FROM categories")) return options.category || null;
              if (sql.includes("FROM products")) return options.product || null;
              if (sql.includes("FROM product_variants")) return options.variant || null;
              return null;
            },
            async all() {
              calls.push({sql, values});
              return {results: options.rows || []};
            },
            async run() {
              if (!sql.includes("UPDATE auth_sessions")) calls.push({sql, values});
              return {meta:{changes:options.runChanges ?? 1}};
            }
          };
        }
      };
    }
  };
}

function makeRequest(path, method = "GET", body, options = {}) {
  const headers = {Origin:"https://example.com"};
  if (options.auth !== false) headers.Cookie = "mmg_session=" + TOKEN;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request("https://example.com/api/stores/store-001/" + path, {
    method,
    headers,
    body:body === undefined ? undefined : JSON.stringify(body)
  });
}

test("Catalog endpoints require an authenticated account member", async () => {
  const db = createDb({session:null});
  const response = await handleCatalog(makeRequest("products", "GET", undefined, {auth:false}), {DB:db});
  assert.equal(response.status, 401);
});

test("Users cannot read catalog data from another tenant", async () => {
  const db = createDb({access:null});
  const response = await handleCatalog(makeRequest("products"), {DB:db});
  assert.equal(response.status, 404);
  assert.equal(db.calls.length, 0);
});

test("Account members can read store categories", async () => {
  const db = createDb({access:MEMBER, rows:[{id:"cat-1",name:"Category"}]});
  const response = await handleCatalog(makeRequest("categories"), {DB:db});
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.categories.length, 1);
  assert.ok(db.calls.some(call => call.sql.includes("WHERE store_id = ?")));
});

test("Account members cannot create categories or products", async () => {
  const db = createDb({access:MEMBER});
  const category = await handleCatalog(makeRequest("categories","POST",{name:"New category"}),{DB:db});
  const product = await handleCatalog(makeRequest("products","POST",{
    name:"New product",base_price:10
  }),{DB:db});
  assert.equal(category.status,403);
  assert.equal(product.status,403);
  assert.equal(db.calls.length,0);
});

test("A category cannot use a parent from another store", async () => {
  const db = createDb({category:null});
  const response = await handleCatalog(makeRequest("categories","POST",{
    name:"Child category",parent_id:"foreign-category"
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.length,0);
});

test("Products cannot reference a category from another store", async () => {
  const db = createDb({category:null});
  const response = await handleCatalog(makeRequest("products","POST",{
    name:"Test product",base_price:10,category_id:"foreign-category"
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.length,0);
});

test("Product creation records initial stock in the same database batch", async () => {
  const db = createDb();
  const response = await handleCatalog(makeRequest("products","POST",{
    name:"Test product",base_price:12.5,currency:"USD",
    product_type:"physical",status:"draft",stock_quantity:7
  }),{DB:db});
  const result = await response.json();
  assert.equal(response.status,201);
  assert.equal(result.product.stock_quantity,7);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls[0].sql.includes("INSERT INTO products"));
  assert.ok(db.calls[1].sql.includes("INSERT INTO inventory_movements"));
});

test("Product listing is scoped to the selected store", async () => {
  const db = createDb({access:MEMBER,rows:[{id:"product-1",name:"Tenant product"}]});
  const response = await handleCatalog(makeRequest("products?q=Tenant"),{DB:db});
  const result = await response.json();
  assert.equal(response.status,200);
  assert.equal(result.products.length,1);
  assert.match(db.calls[0].sql,/p\.store_id = \?/);
});

test("Inventory cannot be reduced below zero", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1,stock_quantity:2}});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"sale",quantity_change:-3
  }),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.length,0);
});

test("Inventory movement is rejected when variant belongs to another store or product", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1,stock_quantity:10},variant:null});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",variant_id:"foreign-variant",
    movement_type:"sale",quantity_change:-1
  }),{DB:db});
  assert.equal(response.status,404);
  assert.equal(db.calls.length,0);
});

test("Valid inventory movements update stock and create a movement record atomically", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1,stock_quantity:5}});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"purchase",quantity_change:4,
    notes:"Restock"
  }),{DB:db});
  const result = await response.json();
  assert.equal(response.status,200);
  assert.equal(result.stock_quantity,9);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls[0].sql.includes("UPDATE products"));
  assert.ok(db.calls[1].sql.includes("INSERT INTO inventory_movements"));
});


test("Account members cannot create product variants", async () => {
  const db = createDb({access:MEMBER,product:{id:"product-1",track_inventory:1}});
  const response = await handleCatalog(makeRequest("products/product-1/variants","POST",{
    name:"Large",price:15
  }),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test("Product variant creation records initial variant stock", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1}});
  const response = await handleCatalog(makeRequest("products/product-1/variants","POST",{
    name:"Large",sku:"LARGE-1",price:15,stock_quantity:3,
    attributes:{size:"L",color:"Blue"}
  }),{DB:db});
  const result = await response.json();
  assert.equal(response.status,201);
  assert.equal(result.variant.stock_quantity,3);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls[0].sql.includes("INSERT INTO product_variants"));
  assert.ok(db.calls[1].sql.includes("INSERT INTO inventory_movements"));
});

test("A product variant with remaining stock cannot be deactivated", async () => {
  const db = createDb({
    product:{id:"product-1",track_inventory:1},
    variant:{id:"variant-1",stock_quantity:4,status:"active"}
  });
  const response = await handleCatalog(makeRequest("products/product-1/variants/variant-1","DELETE"),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE product_variants")),false);
});

test("Variant routes cannot cross product or store boundaries", async () => {
  const db = createDb({access:null});
  const response = await handleCatalog(makeRequest("products/foreign-product/variants","POST",{
    name:"Variant",price:1
  }),{DB:db});
  assert.equal(response.status,404);
});


test("Store members without catalog permission cannot read catalog data", async () => {
  const db = createDb({access:{...MEMBER,permissions:"inventory.read"}});
  const response = await handleCatalog(makeRequest("products"),{DB:db});
  assert.equal(response.status,403);
});

test("Store members with inventory read permission can view stock history", async () => {
  const db = createDb({access:MEMBER,rows:[{id:"movement-1",quantity_change:2}]});
  const response = await handleCatalog(makeRequest("inventory"),{DB:db});
  assert.equal(response.status,200);
});

test("Store members without inventory management permission cannot change stock", async () => {
  const db = createDb({access:MEMBER,product:{id:"product-1",track_inventory:1,stock_quantity:5}});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"purchase",quantity_change:1
  }),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

