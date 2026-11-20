import test from "node:test";
import assert from "node:assert/strict";
import { handlePublicServiceRequests } from "../../backend/routes/service_requests.js";

function makeRequest(body, origin = "https://example.com") {
  return new Request("https://example.com/api/service-requests", {
    method: "POST",
    headers: {"Content-Type":"application/json",Origin:origin},
    body: JSON.stringify(body)
  });
}

function createDb() {
  const calls=[];
  let rateCount=0;
  return {
    calls,
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          return {
            sql,values,
            async first() {
              if (sql.includes("public_service_request_rate_limits")) {
                rateCount += 1;
                return rateCount <= 5 ? {request_count:rateCount} : null;
              }
              return null;
            },
            async run(){calls.push({sql,values});return {meta:{changes:1}};}
          };
        }
      };
    }
  };
}

const valid = {
  request_type:"website_design",
  full_name:"Test Person",
  email:"person@example.com",
  phone:"",
  message:"I would like to request a website design service.",
  language:"en"
};

test("Public service request is validated and stored",async()=>{
  const DB=createDb();
  const response=await handlePublicServiceRequests(makeRequest(valid),{DB});
  const body=await response.json();
  assert.equal(response.status,201);
  assert.equal(body.status,"ok");
  assert.equal(DB.calls.length,1);
  assert.match(DB.calls[0].sql,/INSERT INTO platform_service_requests/);
  assert.equal(DB.calls[0].values[1],"website_design");
  assert.equal(DB.calls[0].values[6],"en");
});

test("Public service request rejects missing contact details",async()=>{
  const DB=createDb();
  const response=await handlePublicServiceRequests(makeRequest({...valid,email:"",phone:""}),{DB});
  assert.equal(response.status,400);
  assert.equal(DB.calls.length,0);
});

test("Public service request rejects unsupported request types",async()=>{
  const DB=createDb();
  const response=await handlePublicServiceRequests(makeRequest({...valid,request_type:"admin_access"}),{DB});
  assert.equal(response.status,400);
  assert.equal(DB.calls.length,0);
});

test("Public service request rejects cross-origin submissions",async()=>{
  const DB=createDb();
  const response=await handlePublicServiceRequests(makeRequest(valid,"https://attacker.example"),{DB});
  assert.equal(response.status,403);
  assert.equal(DB.calls.length,0);
});


test("Public service request submissions are limited to five per client per window",async()=>{
  const DB=createDb();
  let last;
  for(let i=0;i<5;i++) {
    last=await handlePublicServiceRequests(makeRequest(valid),{DB});
    assert.equal(last.status,201);
  }
  const blocked=await handlePublicServiceRequests(makeRequest(valid),{DB});
  assert.equal(blocked.status,429);
  assert.equal(DB.calls.length,5);
});
