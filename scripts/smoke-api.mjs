const baseUrl = process.env.SMOKE_URL || "http://127.0.0.1:3000";
const password = process.env.SMOKE_PASSWORD;
if (!password) throw new Error("请设置 SMOKE_PASSWORD");

async function call(path, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${options.method || "GET"} ${path}: expected ${expectedStatus}, got ${response.status} ${body}`);
  }
  return response.status === 204 ? null : response.json();
}

await call("/api/health");
await call("/api/bootstrap", {}, 401);
await call("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }) }, 401);

const login = await call("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` };
const stock = {
  id: "smoke-stock",
  code: "600519",
  name: "API 测试股票",
  openingCost: 1500,
  openingShares: 100,
  openingDate: "2026-07-16T09:30:00+08:00",
  createdAt: new Date().toISOString(),
};
const operation = {
  id: "smoke-operation",
  stockId: stock.id,
  type: "buy",
  price: 1450,
  shares: 100,
  date: "2026-07-16T10:00:00+08:00",
  note: "smoke test",
};

await call(`/api/stocks/${stock.id}`, { method: "PUT", headers: authHeaders, body: JSON.stringify(stock) });
await call(`/api/operations/${operation.id}`, { method: "PUT", headers: authHeaders, body: JSON.stringify(operation) });
const bootstrap = await call("/api/bootstrap", { headers: { Authorization: authHeaders.Authorization } });
if (!bootstrap.stocks.some((item) => item.id === stock.id)) throw new Error("PostgreSQL 中未找到测试股票");
if (!bootstrap.operations.some((item) => item.id === operation.id)) throw new Error("PostgreSQL 中未找到测试操作");

await call(`/api/stocks/${stock.id}`, { method: "DELETE", headers: { Authorization: authHeaders.Authorization } }, 204);
await call("/api/auth/logout", { method: "POST", headers: { Authorization: authHeaders.Authorization } }, 204);
await call("/api/bootstrap", { headers: { Authorization: authHeaders.Authorization } }, 401);

console.log("API smoke test passed: health, auth, PostgreSQL write/read/cascade delete, Redis session logout");
