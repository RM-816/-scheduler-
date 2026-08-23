const LINE_LOGIN_CHANNEL_ID = "2011214257";
const BODY_LIMIT_BYTES = 64 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const LINK_INDEX_KEY = "line:links";
const LINK_INDEX_FALLBACK_KEY = "line:link:index";

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 400, { error: "bad_request" });
    }

    const storage = getStorageConfig();
    if (!storage) {
      return sendJson(res, 503, { error: "line_not_configured" });
    }

    const body = await readJsonBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendJson(res, 400, { error: "bad_request" });
    }

    const action = typeof body.action === "string" ? body.action : "";
    if (!["link", "unlink", "status"].includes(action)) {
      return sendJson(res, 400, { error: "bad_request" });
    }

    const lineUserId = await verifyLineIdToken(body.idToken);
    if (!lineUserId) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    if (action === "status") {
      return handleStatus(res, storage, lineUserId);
    }
    if (action === "unlink") {
      return handleUnlink(res, storage, lineUserId);
    }
    return handleLink(res, storage, lineUserId, body);
  } catch (error) {
    if (error && error.code === "line_verify_failed") {
      return sendJson(res, 502, { error: "line_verify_failed" });
    }
    return sendJson(res, 500, { error: "server_error" });
  }
};

async function handleLink(res, storage, lineUserId, body) {
  const syncId = typeof body.syncId === "string" ? body.syncId : "";
  const syncKey = typeof body.syncKey === "string" ? body.syncKey : "";
  if (!isValidToken(syncId) || !isValidToken(syncKey)) {
    return sendJson(res, 400, { error: "bad_request" });
  }

  const record = await getJson(storage, syncRedisKey(syncId));
  if (!record) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  if (record.key !== syncKey) {
    return sendJson(res, 403, { error: "forbidden" });
  }

  await setJson(storage, linkRedisKey(lineUserId), {
    syncId,
    syncKey,
    linkedAt: new Date().toISOString()
  });
  await addLinkIndex(storage, lineUserId);
  return sendJson(res, 200, { ok: true });
}

async function handleUnlink(res, storage, lineUserId) {
  await upstashCommand(storage, ["DEL", linkRedisKey(lineUserId)]);
  await removeLinkIndex(storage, lineUserId);
  return sendJson(res, 200, { ok: true });
}

async function handleStatus(res, storage, lineUserId) {
  const link = await getJson(storage, linkRedisKey(lineUserId));
  if (!isValidLinkRecord(link)) {
    return sendJson(res, 200, { ok: true, linked: false });
  }
  return sendJson(res, 200, {
    ok: true,
    linked: true,
    syncIdPrefix: link.syncId.slice(0, 6)
  });
}

async function verifyLineIdToken(idToken) {
  if (typeof idToken !== "string" || !idToken.trim()) {
    return null;
  }

  const form = new URLSearchParams();
  form.set("id_token", idToken);
  form.set("client_id", LINE_LOGIN_CHANNEL_ID);

  let response;
  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
  } catch (error) {
    const verifyError = new Error("line_verify_failed");
    verifyError.code = "line_verify_failed";
    throw verifyError;
  }

  if (!response.ok) {
    return null;
  }
  const payload = await response.json().catch(() => null);
  return payload && typeof payload.sub === "string" && payload.sub ? payload.sub : null;
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

async function getJson(storage, key) {
  const result = await upstashCommand(storage, ["GET", key]);
  if (!result || result.result === null || result.result === undefined) {
    return null;
  }
  if (typeof result.result === "string") {
    return JSON.parse(result.result);
  }
  return result.result;
}

async function setJson(storage, key, value) {
  await upstashCommand(storage, ["SET", key, JSON.stringify(value)]);
}

async function addLinkIndex(storage, lineUserId) {
  try {
    await upstashCommand(storage, ["SADD", LINK_INDEX_KEY, lineUserId]);
    return;
  } catch (error) {
    await updateFallbackIndex(storage, (ids) => (
      ids.includes(lineUserId) ? ids : ids.concat(lineUserId)
    ));
  }
}

async function removeLinkIndex(storage, lineUserId) {
  try {
    await upstashCommand(storage, ["SREM", LINK_INDEX_KEY, lineUserId]);
  } catch (error) {
    // Fall through to the JSON fallback index.
  }
  await updateFallbackIndex(storage, (ids) => ids.filter((id) => id !== lineUserId));
}

async function updateFallbackIndex(storage, updater) {
  const current = await getJson(storage, LINK_INDEX_FALLBACK_KEY).catch(() => []);
  const ids = Array.isArray(current) ? current.filter((id) => typeof id === "string" && id) : [];
  const next = Array.from(new Set(updater(ids)));
  await setJson(storage, LINK_INDEX_FALLBACK_KEY, next);
}

async function upstashCommand(storage, command) {
  const response = await fetch(storage.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storage.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || (payload && payload.error)) {
    throw new Error("upstash_request_failed");
  }
  return payload;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
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
    if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT_BYTES) {
      throw new Error("request_body_too_large");
    }
  }
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function syncRedisKey(syncId) {
  return `sync:${syncId}`;
}

function linkRedisKey(lineUserId) {
  return `line:link:${lineUserId}`;
}

function isValidLinkRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isValidToken(value.syncId) &&
    isValidToken(value.syncKey)
  );
}

function isValidToken(value) {
  return TOKEN_PATTERN.test(value);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
