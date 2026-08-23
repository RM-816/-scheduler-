const crypto = require("crypto");

const MAX_DATA_BYTES = 256 * 1024;
const BODY_LIMIT_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

module.exports = async (req, res) => {
  try {
    const storage = getStorageConfig();
    if (!storage) {
      return sendJson(res, 503, { error: "storage_not_configured" });
    }

    if (req.method === "GET") {
      return handleGet(req, res, storage);
    }

    if (req.method !== "POST") {
      return sendJson(res, 400, { error: "bad_request" });
    }

    const body = await readJsonBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendJson(res, 400, { error: "bad_request" });
    }

    if (body.action === "create") {
      return handleCreate(res, storage, body);
    }
    if (body.action === "put") {
      return handlePut(res, storage, body);
    }

    return sendJson(res, 400, { error: "bad_request" });
  } catch (error) {
    return sendJson(res, 500, { error: "server_error" });
  }
};

async function handleCreate(res, storage, body) {
  const dataText = stringifyData(body.data);
  if (dataText === null) {
    return sendJson(res, 400, { error: "bad_request" });
  }
  if (byteLength(dataText) > MAX_DATA_BYTES) {
    return sendJson(res, 413, { error: "data_too_large" });
  }

  const id = randomToken();
  const key = randomToken();
  const record = {
    key,
    data: body.data,
    rev: 1,
    updatedAt: new Date().toISOString()
  };
  await setRecord(storage, id, record);
  return sendJson(res, 200, { id, key, rev: 1 });
}

async function handleGet(req, res, storage) {
  const url = new URL(req.url, "http://localhost");
  const id = url.searchParams.get("id") || "";
  const key = url.searchParams.get("key") || "";
  if (!isValidToken(id) || !isValidToken(key)) {
    return sendJson(res, 400, { error: "bad_request" });
  }

  const record = await getRecord(storage, id);
  if (!record) {
    return sendJson(res, 404, { error: "not_found" });
  }
  if (record.key !== key) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  return sendJson(res, 200, { data: record.data, rev: record.rev });
}

async function handlePut(res, storage, body) {
  const id = typeof body.id === "string" ? body.id : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (!isValidToken(id) || !isValidToken(key) || !Number.isInteger(body.rev)) {
    return sendJson(res, 400, { error: "bad_request" });
  }

  const dataText = stringifyData(body.data);
  if (dataText === null) {
    return sendJson(res, 400, { error: "bad_request" });
  }
  if (byteLength(dataText) > MAX_DATA_BYTES) {
    return sendJson(res, 413, { error: "data_too_large" });
  }

  const record = await getRecord(storage, id);
  if (!record) {
    return sendJson(res, 404, { error: "not_found" });
  }
  if (record.key !== key) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  if (record.rev !== body.rev) {
    return sendJson(res, 409, { rev: record.rev });
  }

  const nextRev = record.rev + 1;
  await setRecord(storage, id, {
    key,
    data: body.data,
    rev: nextRev,
    updatedAt: new Date().toISOString()
  });
  return sendJson(res, 200, { rev: nextRev });
}

function getStorageConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) {
    return null;
  }
  return {
    url: url.replace(/\/+$/, ""),
    token
  };
}

async function getRecord(storage, id) {
  const result = await upstash(storage, `/get/${encodeURIComponent(redisKey(id))}`, {
    method: "GET"
  });
  if (!result || result.result === null || result.result === undefined) {
    return null;
  }
  const value = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
  const record = JSON.parse(value);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  return record;
}

async function setRecord(storage, id, record) {
  await upstash(storage, `/set/${encodeURIComponent(redisKey(id))}`, {
    method: "POST",
    body: JSON.stringify(record),
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

async function upstash(storage, path, options) {
  const response = await fetch(`${storage.url}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${storage.token}`,
      ...(options.headers || {})
    },
    body: options.body
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error("upstash_request_failed");
  }
  return payload;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString("utf8"));
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (byteLength(raw) > BODY_LIMIT_BYTES) {
      throw new Error("request_body_too_large");
    }
  }
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function stringifyData(data) {
  const text = JSON.stringify(data);
  return typeof text === "string" ? text : null;
}

function randomToken() {
  return crypto.randomBytes(16).toString("base64url");
}

function redisKey(id) {
  return `sync:${id}`;
}

function isValidToken(value) {
  return TOKEN_PATTERN.test(value);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
