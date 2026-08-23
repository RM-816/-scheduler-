(function exposeLinePush(root) {
  "use strict";

  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
  const LINK_INDEX_KEY = "line:links";
  const LINK_INDEX_FALLBACK_KEY = "line:link:index";
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const NOTIFICATION_WINDOW_MS = 10 * 60 * 1000;
  const NOTIFIED_KEEP_DAYS = 3;
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  async function handler(req, res) {
    try {
      // GET: 手動確認・cron-job.org等 / POST: QStash等のスケジューラ
      if (req.method !== "GET" && req.method !== "POST") {
        return sendJson(res, 400, { error: "bad_request" });
      }

      const cronSecret = process.env.CRON_SECRET || "";
      if (!cronSecret) {
        return sendJson(res, 503, { error: "line_not_configured" });
      }

      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("key") !== cronSecret) {
        return sendJson(res, 403, { error: "forbidden" });
      }

      const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
      const storage = getStorageConfig();
      if (!channelAccessToken || !storage) {
        return sendJson(res, 503, { error: "line_not_configured" });
      }

      const userIds = await getAllLinkedUserIds(storage);
      const now = new Date();
      let pushed = 0;

      for (const userId of userIds) {
        try {
          const result = await processLinkedUser(storage, channelAccessToken, userId, now);
          if (result && result.pushed) {
            pushed += 1;
          }
        } catch (error) {
          console.warn("LINE reminder processing failed:", userId, error && error.message ? error.message : error);
        }
      }

      return sendJson(res, 200, { ok: true, users: userIds.length, pushed });
    } catch (error) {
      console.warn("LINE push cron failed:", error && error.message ? error.message : error);
      return sendJson(res, 500, { error: "server_error" });
    }
  }

  async function processLinkedUser(storage, channelAccessToken, userId, now) {
    const link = await getJson(storage, linkRedisKey(userId));
    if (!isValidLinkRecord(link)) {
      return { pushed: false };
    }

    const syncRecord = await getJson(storage, syncRedisKey(link.syncId));
    if (!syncRecord || syncRecord.key !== link.syncKey) {
      return { pushed: false };
    }

    const events = syncRecord.data && Array.isArray(syncRecord.data.events)
      ? syncRecord.data.events
      : [];
    const notifiedKey = notifiedRedisKey(userId);
    const notified = pruneNotifiedMap(await getJson(storage, notifiedKey).catch(() => ({})), now);
    const due = collectDueNotifications(events, notified, now);
    if (due.length === 0) {
      await setJsonIfChanged(storage, notifiedKey, notified, await getJson(storage, notifiedKey).catch(() => ({})));
      return { pushed: false };
    }

    const messageText = formatPushMessage(due);
    const pushResult = await pushLineMessage(channelAccessToken, userId, messageText);
    if (pushResult.ok || (pushResult.status >= 400 && pushResult.status < 500)) {
      const sentAt = now.toISOString();
      due.forEach((item) => {
        notified[item.notificationKey] = sentAt;
      });
      await setJson(storage, notifiedKey, notified);
    }

    return { pushed: pushResult.ok };
  }

  function collectDueNotifications(events, notified, nowInput) {
    const now = toDate(nowInput);
    if (!now) {
      return [];
    }
    const notifiedMap = isPlainObject(notified) ? notified : {};
    const nowMs = now.getTime();
    const today = jstDateString(now);
    const tomorrow = addDaysToDateString(today, 1);
    const occurrences = expandOccurrences(events, [today, tomorrow]);

    return occurrences
      .map((occurrence) => {
        const reminder = normalizeReminder(occurrence.reminder);
        if (reminder === null || !isValidTimeString(occurrence.startTime)) {
          return null;
        }
        const startMs = jstDateTimeToUtcMs(occurrence.occurrenceDate, occurrence.startTime);
        if (!Number.isFinite(startMs)) {
          return null;
        }
        const notificationMs = startMs - reminder * 60000;
        const notificationKey = `${occurrence.occurrenceDate}|${occurrence.id}|${reminder}`;
        if (notifiedMap[notificationKey]) {
          return null;
        }
        if (notificationMs <= nowMs - NOTIFICATION_WINDOW_MS || notificationMs > nowMs) {
          return null;
        }
        return {
          ...occurrence,
          reminder,
          notificationKey,
          notificationAt: new Date(notificationMs).toISOString()
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const timeDiff = a.notificationAt.localeCompare(b.notificationAt);
        if (timeDiff !== 0) {
          return timeDiff;
        }
        const startDiff = String(a.startTime || "").localeCompare(String(b.startTime || ""));
        if (startDiff !== 0) {
          return startDiff;
        }
        return String(a.title || "").localeCompare(String(b.title || ""), "ja");
      });
  }

  function expandOccurrences(events, dateStrings) {
    if (!Array.isArray(events) || !Array.isArray(dateStrings)) {
      return [];
    }
    const validDates = dateStrings.filter(isValidDateString);
    const occurrences = [];
    events.forEach((event) => {
      if (!event || typeof event !== "object") {
        return;
      }
      validDates.forEach((dateStr) => {
        if (!eventOccursOn(event, dateStr)) {
          return;
        }
        occurrences.push({
          ...event,
          occurrenceDate: dateStr,
          occurrenceKey: `${String(event.id || "")}|${dateStr}`
        });
      });
    });
    return occurrences;
  }

  function eventOccursOn(event, dateStr) {
    if (!isValidDateString(dateStr) || !isValidDateString(event.date)) {
      return false;
    }
    if (sanitizeExceptions(event.exceptions).includes(dateStr)) {
      return false;
    }
    if (!isPlainObject(event.recurrence)) {
      return event.date === dateStr;
    }
    if (compareDateStrings(dateStr, event.date) < 0) {
      return false;
    }

    const recurrence = event.recurrence;
    if (recurrence.freq === "daily") {
      return true;
    }
    if (recurrence.freq === "weekly") {
      const weekday = validWeekday(recurrence.weekday)
        ? recurrence.weekday
        : weekdayOfDate(event.date);
      return weekdayOfDate(dateStr) === weekday;
    }
    if (recurrence.freq === "monthly") {
      const start = parseDateParts(event.date);
      const target = parseDateParts(dateStr);
      if (!start || !target) {
        return false;
      }
      const day = validMonthDay(recurrence.day) ? recurrence.day : start.day;
      const clippedDay = Math.min(day, daysInMonth(target.year, target.month));
      return target.day === clippedDay;
    }
    return false;
  }

  function formatPushMessage(items) {
    const list = Array.isArray(items) ? items : [];
    const visible = list.slice(0, 5);
    const blocks = visible.map(formatReminderBlock);
    if (list.length > visible.length) {
      blocks.push(`他${list.length - visible.length}件`);
    }
    return blocks.join("\n\n");
  }

  function formatReminderBlock(item) {
    return [
      `🔔 ${reminderLabel(item.reminder)}リマインド`,
      sanitizeMessageLine(item.title) || "無題",
      formatOccurrenceTimeLine(item)
    ].join("\n");
  }

  function formatOccurrenceTimeLine(item) {
    const parts = parseDateParts(item.occurrenceDate);
    if (!parts || !isValidTimeString(item.startTime)) {
      return "";
    }
    const weekday = WEEKDAYS[weekdayOfDate(item.occurrenceDate)] || "";
    const end = isValidTimeString(item.endTime) ? item.endTime : "";
    return `${parts.month}/${parts.day}(${weekday}) ${item.startTime}〜${end}`;
  }

  function reminderLabel(minutes) {
    const value = normalizeReminder(minutes);
    if (value === 0) {
      return "定刻";
    }
    if (value !== null && value % 1440 === 0) {
      const days = value / 1440;
      return days === 1 ? "1日前" : `${days}日前`;
    }
    if (value !== null && value % 60 === 0) {
      return `${value / 60}時間前`;
    }
    return `${value || 0}分前`;
  }

  function pruneNotifiedMap(notified, nowInput) {
    const source = isPlainObject(notified) ? notified : {};
    const now = toDate(nowInput) || new Date();
    const cutoff = addDaysToDateString(jstDateString(now), -NOTIFIED_KEEP_DAYS);
    const next = {};
    Object.keys(source).forEach((key) => {
      const datePart = key.slice(0, 10);
      if (isValidDateString(datePart) && datePart >= cutoff && typeof source[key] === "string") {
        next[key] = source[key];
      }
    });
    return next;
  }

  async function pushLineMessage(channelAccessToken, userId, text) {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: userId,
        messages: [
          {
            type: "text",
            text
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("LINE push failed:", response.status, body.slice(0, 200));
    }
    return { ok: response.ok, status: response.status };
  }

  async function getAllLinkedUserIds(storage) {
    const ids = new Set();
    try {
      const setPayload = await upstashCommand(storage, ["SMEMBERS", LINK_INDEX_KEY]);
      if (setPayload && Array.isArray(setPayload.result)) {
        setPayload.result.forEach((id) => {
          if (typeof id === "string" && id) {
            ids.add(id);
          }
        });
      }
    } catch (error) {
      // The JSON fallback below supports environments without set commands.
    }

    const fallback = await getJson(storage, LINK_INDEX_FALLBACK_KEY).catch(() => []);
    if (Array.isArray(fallback)) {
      fallback.forEach((id) => {
        if (typeof id === "string" && id) {
          ids.add(id);
        }
      });
    }

    return Array.from(ids);
  }

  async function getJson(storage, key) {
    const payload = await upstashCommand(storage, ["GET", key]);
    if (!payload || payload.result === null || payload.result === undefined) {
      return null;
    }
    if (typeof payload.result === "string") {
      return JSON.parse(payload.result);
    }
    return payload.result;
  }

  async function setJson(storage, key, value) {
    await upstashCommand(storage, ["SET", key, JSON.stringify(value)]);
  }

  async function setJsonIfChanged(storage, key, next, previous) {
    if (JSON.stringify(next) === JSON.stringify(previous || {})) {
      return;
    }
    await setJson(storage, key, next);
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

  function syncRedisKey(syncId) {
    return `sync:${syncId}`;
  }

  function linkRedisKey(lineUserId) {
    return `line:link:${lineUserId}`;
  }

  function notifiedRedisKey(lineUserId) {
    return `line:notified:${lineUserId}`;
  }

  function isValidLinkRecord(value) {
    return Boolean(
      isPlainObject(value) &&
      isValidToken(value.syncId) &&
      isValidToken(value.syncKey)
    );
  }

  function isValidToken(value) {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
  }

  function sanitizeExceptions(exceptions) {
    if (!Array.isArray(exceptions)) {
      return [];
    }
    return Array.from(new Set(exceptions.filter(isValidDateString))).sort();
  }

  function normalizeReminder(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(number) && number >= 0 && number <= 10080) {
      return number;
    }
    return null;
  }

  function sanitizeMessageLine(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function jstDateString(dateInput) {
    const date = toDate(dateInput);
    if (!date) {
      return "";
    }
    const shifted = new Date(date.getTime() + JST_OFFSET_MS);
    return formatDateParts({
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate()
    });
  }

  function jstDateTimeToUtcMs(dateStr, timeStr) {
    const parts = parseDateParts(dateStr);
    const time = parseTimeParts(timeStr);
    if (!parts || !time) {
      return NaN;
    }
    return Date.UTC(parts.year, parts.month - 1, parts.day, time.hour, time.minute, 0, 0) - JST_OFFSET_MS;
  }

  function addDaysToDateString(dateStr, days) {
    const parts = parseDateParts(dateStr);
    if (!parts || !Number.isInteger(days)) {
      return "";
    }
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return formatDateParts({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    });
  }

  function weekdayOfDate(dateStr) {
    const parts = parseDateParts(dateStr);
    if (!parts) {
      return 0;
    }
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  }

  function parseDateParts(value) {
    if (typeof value !== "string") {
      return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (
      formatDateParts(parts) !== value ||
      date.getUTCFullYear() !== parts.year ||
      date.getUTCMonth() + 1 !== parts.month ||
      date.getUTCDate() !== parts.day
    ) {
      return null;
    }
    return parts;
  }

  function formatDateParts(parts) {
    const year = String(parts.year).padStart(4, "0");
    const month = String(parts.month).padStart(2, "0");
    const day = String(parts.day).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseTimeParts(value) {
    if (!isValidTimeString(value)) {
      return null;
    }
    return {
      hour: Number(value.slice(0, 2)),
      minute: Number(value.slice(3, 5))
    };
  }

  function isValidDateString(value) {
    return Boolean(parseDateParts(value));
  }

  function isValidTimeString(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function compareDateStrings(left, right) {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function validWeekday(value) {
    return Number.isInteger(value) && value >= 0 && value <= 6;
  }

  function validMonthDay(value) {
    return Number.isInteger(value) && value >= 1 && value <= 31;
  }

  function toDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }

  const internals = {
    collectDueNotifications,
    expandOccurrences,
    eventOccursOn,
    formatPushMessage,
    formatReminderBlock,
    formatOccurrenceTimeLine,
    reminderLabel,
    pruneNotifiedMap,
    jstDateString,
    jstDateTimeToUtcMs,
    addDaysToDateString
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = handler;
    module.exports._internals = internals;
  } else {
    root.SchedulerLinePushInternals = internals;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
