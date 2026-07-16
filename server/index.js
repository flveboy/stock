import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createClient } from "redis";
import { createStorage } from "./storage.js";
import { validateImport, validateOperation, validateSettings, validateStock } from "./validation.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);
const appPassword = process.env.APP_PASSWORD || "";
const databaseUrl = process.env.DATABASE_URL || "";
const redisUrl = process.env.REDIS_URL || "";
const sessionTtl = Number(process.env.SESSION_TTL_SECONDS || 2592000);

if (appPassword.length < 8) throw new Error("APP_PASSWORD 至少需要 8 个字符");
if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
if (!redisUrl) throw new Error("缺少 REDIS_URL");

const storage = createStorage(databaseUrl);
const redis = createClient({ url: redisUrl });
redis.on("error", (error) => console.error("Redis error:", error.message));

await storage.init();
await redis.connect();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: "2mb" }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const cacheKey = "stock-ledger:bootstrap:v1";
const sessionKey = (token) => `stock-ledger:session:${token}`;
const passwordFingerprint = crypto.createHash("sha256").update(appPassword).digest("hex");

function passwordsMatch(input) {
  const expected = crypto.createHash("sha256").update(appPassword).digest();
  const actual = crypto.createHash("sha256").update(String(input || "")).digest();
  return crypto.timingSafeEqual(expected, actual);
}

async function invalidateCache() {
  await redis.del(cacheKey);
}

async function requireAuth(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token ? await redis.get(sessionKey(token)) : null;
  if (!session || JSON.parse(session).passwordFingerprint !== passwordFingerprint) {
    if (token) await redis.del(sessionKey(token));
    return res.status(401).json({ error: "登录已失效，请重新登录" });
  }
  await redis.expire(sessionKey(token), sessionTtl);
  req.sessionToken = token;
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await Promise.all([storage.health(), redis.ping()]);
  res.json({ status: "ok", database: "postgresql", cache: "redis" });
}));

app.post("/api/auth/login", loginLimiter, asyncRoute(async (req, res) => {
  if (!passwordsMatch(req.body?.password)) return res.status(401).json({ error: "访问密码错误" });
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(sessionKey(token), JSON.stringify({ createdAt: new Date().toISOString(), passwordFingerprint }), { EX: sessionTtl });
  res.json({ token, expiresIn: sessionTtl });
}));

app.post("/api/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  await redis.del(sessionKey(req.sessionToken));
  res.status(204).end();
}));

app.get("/api/bootstrap", requireAuth, asyncRoute(async (_req, res) => {
  const cached = await redis.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));
  const data = await storage.getBootstrap();
  await redis.set(cacheKey, JSON.stringify(data), { EX: 60 });
  res.json(data);
}));

app.put("/api/stocks/:id", requireAuth, asyncRoute(async (req, res) => {
  const stock = validateStock({ ...req.body, id: req.params.id });
  await storage.putStock(stock);
  await invalidateCache();
  res.json(stock);
}));

app.delete("/api/stocks/:id", requireAuth, asyncRoute(async (req, res) => {
  await storage.deleteStock(req.params.id);
  await invalidateCache();
  res.status(204).end();
}));

app.put("/api/operations/:id", requireAuth, asyncRoute(async (req, res) => {
  const operation = validateOperation({ ...req.body, id: req.params.id });
  await storage.putOperation(operation);
  await invalidateCache();
  res.json(operation);
}));

app.delete("/api/operations/:id", requireAuth, asyncRoute(async (req, res) => {
  await storage.deleteOperation(req.params.id);
  await invalidateCache();
  res.status(204).end();
}));

app.put("/api/settings/:key", requireAuth, asyncRoute(async (req, res) => {
  if (req.params.key !== "fees") return res.status(400).json({ error: "不支持的设置项" });
  const value = validateSettings(req.body?.value);
  await storage.putSetting(req.params.key, value);
  await invalidateCache();
  res.json({ key: req.params.key, value });
}));

app.post("/api/import", requireAuth, asyncRoute(async (req, res) => {
  const payload = validateImport(req.body);
  await storage.importAll(payload);
  await invalidateCache();
  res.status(204).end();
}));

app.get("/", (_req, res) => res.sendFile(path.join(root, "index.html")));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(root, "styles.css")));
app.use("/js", express.static(path.join(root, "js"), { fallthrough: false, maxAge: "1h" }));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || (error.code === "23503" ? 400 : 500);
  const message = status === 500 ? "服务器处理失败" : (error.code === "23503" ? "关联的股票不存在" : error.message);
  res.status(status).json({ error: message });
});

const server = app.listen(port, "0.0.0.0", () => console.log(`Stock ledger listening on :${port}`));

async function shutdown() {
  server.close();
  await Promise.allSettled([storage.close(), redis.quit()]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
