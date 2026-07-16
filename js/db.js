const TOKEN_KEY = "stock-ledger-session";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError("无法连接 NAS 服务，请检查容器状态和网络", 0);
  }
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new CustomEvent("auth-required"));
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(payload.error || `请求失败 (${response.status})`, response.status);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const auth = {
  hasSession: () => Boolean(getToken()),
  async login(password) {
    const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
    localStorage.setItem(TOKEN_KEY, result.token);
  },
  async logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      localStorage.removeItem(TOKEN_KEY);
    }
  },
};

export const db = {
  bootstrap: () => request("/api/bootstrap"),
  putStock: (stock) => request(`/api/stocks/${encodeURIComponent(stock.id)}`, { method: "PUT", body: JSON.stringify(stock) }),
  deleteStock: (id) => request(`/api/stocks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  putOperation: (operation) => request(`/api/operations/${encodeURIComponent(operation.id)}`, { method: "PUT", body: JSON.stringify(operation) }),
  deleteOperation: (id) => request(`/api/operations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  putSetting: (key, value) => request(`/api/settings/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) }),
  importAll: (payload) => request("/api/import", { method: "POST", body: JSON.stringify(payload) }),
};
