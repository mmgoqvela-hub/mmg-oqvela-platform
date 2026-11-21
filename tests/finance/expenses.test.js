import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handleFinance} from "../../backend/routes/finance.js";

const TOKEN="f".repeat(43);
function makeDb(options={}){
 const calls=[];
 return {calls,prepare(sql){return {sql,bind(...values){return {sql,values,
  async first(){
   calls.push({sql,values});
   if(sql.includes("FROM auth_sessions"))return options.session===null?null:{session_id:"s1",user_id:"u1",expires_at:"2099-01-01",user_status:"active"};
   if(sql.includes("GROUP_CONCAT"))return options.access??{store_status:"active",account_status:"active",account_role:"member",permissions:"finance.expenses.read,finance.expenses.manage,finance.cashbox.read,finance.cashbox.manage"};
   if(sql.includes("FROM store_expenses WHERE store_id=? AND idempotency_key=?"))return options.priorExpense??null;
   if(sql.includes("FROM pos_cash_movements WHERE store_id=? AND idempotency_key=?"))return options.priorMovement??null;
   if(sql.includes("FROM pos_cash_sessions"))return options.cashSession??{id:"cs1",currency:"USD",status:"open"};
   return null;
  },
  async all(){calls.push({sql,values});return {results:options.rows||[]};},
  async run(){calls.push({sql,values});return {meta:{changes:1}};}
 };}};}};
}
function req(path,method="GET",body,token=true){
 const headers={Origin:"https://example.test"};
 if(token)headers.Cookie="mmg_session="+TOKEN;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request("https://example.test"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const base="/api/stores/store-1/finance";
const expense={idempotency_key:"expense-key-123456",category:"Supplies",description:"Flour purchase",amount:12.5,currency:"USD",payment_method:"cash",cash_session_id:"cs1"};

test("Finance endpoints require authentication",async()=>{
 const response=await handleFinance(req(base+"/expenses","GET",undefined,false),{DB:makeDb({session:null})});
 assert.equal(response.status,401);
});
test("Expense management requires its explicit permission",async()=>{
 const response=await handleFinance(req(base+"/expenses","POST",expense),{DB:makeDb({access:{store_status:"active",account_status:"active",account_role:"member",permissions:"finance.expenses.read"}})});
 assert.equal(response.status,403);
});
test("Cash expense requires an open cash session",async()=>{
 const response=await handleFinance(req(base+"/expenses","POST",{...expense,cash_session_id:""}),{DB:makeDb()});
 assert.equal(response.status,400);
});
test("Cash expense is recorded against the matching session and currency",async()=>{
 const database=makeDb();
 const response=await handleFinance(req(base+"/expenses","POST",expense),{DB:database});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.expense.amount,12.5);
 assert.equal(result.expense.cash_session_id,"cs1");
 const insert=database.calls.find(call=>call.sql.includes("INSERT INTO store_expenses"));
 assert.equal(insert.values[6],12.5);
 assert.equal(insert.values[9],null);
 assert.equal(insert.values[10],"cs1");
});
test("Cash expense rejects a closed or mismatched cash session",async()=>{
 const database=makeDb({cashSession:{id:"cs1",currency:"SYP",status:"closed"}});
 const response=await handleFinance(req(base+"/expenses","POST",expense),{DB:database});
 assert.equal(response.status,409);
});
test("Sham Cash expenses require a payment reference",async()=>{
 const response=await handleFinance(req(base+"/expenses","POST",{...expense,payment_method:"shamcash",cash_session_id:null}),{DB:makeDb()});
 assert.equal(response.status,400);
});
test("Expense idempotency returns the original record",async()=>{
 const database=makeDb({priorExpense:{id:"e1",expense_number:"EXP-1",amount:12.5,currency:"USD",payment_method:"cash"}});
 const response=await handleFinance(req(base+"/expenses","POST",expense),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.replayed,true);
 assert.equal(result.expense.id,"e1");
});
test("Cashbox movement requires an open session and is appended",async()=>{
 const database=makeDb();
 const response=await handleFinance(req(base+"/cashbox/movements","POST",{
  idempotency_key:"cash-movement-key-123",cash_session_id:"cs1",direction:"out",amount:20,description:"Owner withdrawal"
 }),{DB:database});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.movement.movement_type,"withdrawal");
 const insert=database.calls.find(call=>call.sql.includes("INSERT INTO pos_cash_movements"));
 assert.equal(insert.values[4],"withdrawal");
 assert.equal(insert.values[5],20);
});
test("Expense list is scoped to the requested store and filters currency",async()=>{
 const database=makeDb({rows:[{id:"e1",currency:"USD"}]});
 const response=await handleFinance(req(base+"/expenses?currency=USD","GET"),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.expenses.length,1);
 const query=database.calls.find(call=>call.sql.includes("FROM store_expenses")&&call.sql.includes("ORDER BY"));
 assert.equal(query.values[0],"store-1");
 assert.equal(query.values[1],"USD");
});
