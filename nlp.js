(function (root) {
  "use strict";

  var WEEKDAY = { "日": 0, "月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6 };
  var RANGE_SEPARATORS = /^(?:から|〜|~|-|－|ー|–|—|～)$/;
  var CIRCLED_NUMBERS = {
    "⓪": "0",
    "①": "1",
    "②": "2",
    "③": "3",
    "④": "4",
    "⑤": "5",
    "⑥": "6",
    "⑦": "7",
    "⑧": "8",
    "⑨": "9",
    "⑩": "10",
    "⑪": "11",
    "⑫": "12",
    "⑬": "13",
    "⑭": "14",
    "⑮": "15",
    "⑯": "16",
    "⑰": "17",
    "⑱": "18",
    "⑲": "19",
    "⑳": "20"
  };

  function stripLineNoise(text) {
    return String(text)
      .split(/\r?\n/)
      .map(function (line) {
        return line
          .replace(/^\s*(?:[・･●○〇◆◇■□▪▫▶▷✓✔]\s*|[-*＊]+\s*)+/, "")
          .replace(/[。．.]+$/g, "")
          .trim();
      })
      .join("\n")
      .trim();
  }

  function normalizeText(text) {
    return stripLineNoise(String(text == null ? "" : text)
      .replace(/[⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, function (ch) {
        return CIRCLED_NUMBERS[ch] || ch;
      })
      .replace(/[０-９]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      })
      .replace(/[：]/g, ":")
      .replace(/[／]/g, "/")
      .replace(/[　]/g, " ")
      .replace(/[－]/g, "-"));
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function formatDate(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function formatTime(hour, minute) {
    return pad2(hour) + ":" + pad2(minute);
  }

  function makeValidDate(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function isBeforeLocalDay(a, b) {
    return startOfLocalDay(a).getTime() < startOfLocalDay(b).getTime();
  }

  function sameLocalDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function timeMinutes(time) {
    if (!time) return null;
    return time.hour * 60 + time.minute;
  }

  function isTimePastOnBase(base, time) {
    var minutes = timeMinutes(time);
    if (minutes == null) return false;
    return minutes < base.getHours() * 60 + base.getMinutes();
  }

  function dateByMonthDayFromBase(base, month, day) {
    var year = base.getFullYear();
    var date = makeValidDate(year, month, day);
    if (!date) return null;
    if (isBeforeLocalDay(date, base)) {
      date = makeValidDate(year + 1, month, day);
    }
    return date;
  }

  function nextDayOfMonth(base, day, firstOffset) {
    var offset = firstOffset || 0;
    var year = base.getFullYear();
    var month = base.getMonth();
    var i;

    for (i = offset; i < offset + 36; i += 1) {
      var candidate = makeValidDate(year + Math.floor((month + i) / 12), ((month + i) % 12) + 1, day);
      if (candidate && !isBeforeLocalDay(candidate, base)) return candidate;
    }
    return null;
  }

  function nextStandaloneWeekday(base, weekday) {
    var diff = (weekday - base.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(base, diff);
  }

  function weekStartMonday(base) {
    var baseStart = startOfLocalDay(base);
    var day = baseStart.getDay();
    var mondayOffset = day === 0 ? -6 : 1 - day;
    return addDays(baseStart, mondayOffset);
  }

  function prefixedWeekdayDate(base, prefix, weekday) {
    var weeksAhead = prefix === "今週" ? 0 : prefix === "来週" ? 1 : 2;
    var start = weekStartMonday(base);
    var targetOffset = weekday === 0 ? 6 : weekday - 1;
    return addDays(start, weeksAhead * 7 + targetOffset);
  }

  function hasOverlap(ranges, start, end) {
    var i;
    for (i = 0; i < ranges.length; i += 1) {
      if (start < ranges[i].end && end > ranges[i].start) return true;
    }
    return false;
  }

  function addRange(ranges, start, end) {
    if (start == null || end == null || start >= end) return;
    ranges.push({ start: start, end: end });
  }

  function parseNumericTime(ampm, rawHour, rawMinute, hasHalf, hadColon) {
    var originalHour = parseInt(rawHour, 10);
    var minute = hasHalf ? 30 : rawMinute == null || rawMinute === "" ? 0 : parseInt(rawMinute, 10);
    var hour = originalHour;

    if (isNaN(hour) || isNaN(minute) || minute < 0 || minute > 59) return null;

    if (ampm === "午前") {
      if (hour === 12) hour = 0;
    } else if (ampm === "午後") {
      if (hour >= 1 && hour <= 11) hour += 12;
    } else if (!hadColon || originalHour <= 11) {
      if (hour >= 1 && hour <= 6) hour += 12;
    }

    if (hour < 0 || hour > 23) return null;

    return {
      hour: hour,
      minute: minute,
      originalHour: originalHour,
      hasExplicitAmPm: !!ampm
    };
  }

  function parseKeywordTime(word) {
    if (word === "朝") return { hour: 9, minute: 0, originalHour: null, hasExplicitAmPm: false };
    if (word === "昼" || word === "正午") return { hour: 12, minute: 0, originalHour: null, hasExplicitAmPm: false };
    if (word === "夕方") return { hour: 17, minute: 0, originalHour: null, hasExplicitAmPm: false };
    if (word === "夜" || word === "晩") return { hour: 19, minute: 0, originalHour: null, hasExplicitAmPm: false };
    return null;
  }

  function findTimeExpressions(text) {
    var results = [];
    var regex = /(午前|午後)?\s*(?:(\d{1,2})(?:時(?:(半)|(\d{1,2})分?)?|:(\d{1,2}))|(朝|昼|正午|夕方|夜|晩))/g;
    var match;

    while ((match = regex.exec(text)) !== null) {
      var info;
      if (match[6]) {
        info = parseKeywordTime(match[6]);
      } else {
        info = parseNumericTime(match[1], match[2], match[4] || match[5], !!match[3], !!match[5]);
      }
      if (info) {
        results.push({
          start: match.index,
          end: match.index + match[0].length,
          raw: match[0],
          hour: info.hour,
          minute: info.minute,
          originalHour: info.originalHour,
          hasExplicitAmPm: info.hasExplicitAmPm
        });
      }
    }
    return results;
  }

  function parseTimes(text, ranges) {
    var times = findTimeExpressions(text);
    var i;
    var chosen = null;
    var rangeIndexes = {};

    for (i = 0; i < times.length - 1; i += 1) {
      var between = text.slice(times[i].end, times[i + 1].start).replace(/\s+/g, "");
      if (RANGE_SEPARATORS.test(between)) {
        var endTime = {
          hour: times[i + 1].hour,
          minute: times[i + 1].minute,
          originalHour: times[i + 1].originalHour,
          hasExplicitAmPm: times[i + 1].hasExplicitAmPm
        };

        if (
          !endTime.hasExplicitAmPm &&
          endTime.originalHour != null &&
          endTime.originalHour >= 1 &&
          endTime.originalHour <= 11 &&
          endTime.hour <= times[i].hour &&
          endTime.hour + 12 <= 23
        ) {
          endTime.hour += 12;
        }

        chosen = {
          startTime: { hour: times[i].hour, minute: times[i].minute },
          endTime: { hour: endTime.hour, minute: endTime.minute }
        };
        addRange(ranges, times[i].start, times[i + 1].end);
        rangeIndexes[i] = true;
        rangeIndexes[i + 1] = true;
        break;
      }
    }

    for (i = 0; i < times.length; i += 1) {
      if (!rangeIndexes[i]) addRange(ranges, times[i].start, times[i].end);
    }

    if (!chosen && times.length > 0) {
      chosen = {
        startTime: { hour: times[0].hour, minute: times[0].minute },
        endTime: null
      };
    }

    return chosen;
  }

  function parseRecurrence(text, ranges) {
    var matches = [];
    var match;
    var daily = /毎日/g;
    var weekly = /毎週の?([日月火水木金土])曜(?:日)?/g;
    var monthly = /毎月(\d{1,2})日/g;

    while ((match = daily.exec(text)) !== null) {
      matches.push({
        index: match.index,
        end: match.index + match[0].length,
        recurrence: { freq: "daily" }
      });
    }
    while ((match = weekly.exec(text)) !== null) {
      matches.push({
        index: match.index,
        end: match.index + match[0].length,
        recurrence: { freq: "weekly", weekday: WEEKDAY[match[1]] }
      });
    }
    while ((match = monthly.exec(text)) !== null) {
      var day = parseInt(match[1], 10);
      if (day >= 1 && day <= 31) {
        matches.push({
          index: match.index,
          end: match.index + match[0].length,
          recurrence: { freq: "monthly", day: day }
        });
      }
    }

    if (matches.length === 0) return null;

    matches.sort(function (a, b) {
      return a.index - b.index;
    });

    var i;
    for (i = 0; i < matches.length; i += 1) {
      addRange(ranges, matches[i].index, matches[i].end);
    }

    return matches[0].recurrence;
  }

  function addDateCandidate(candidates, ranges, start, end, date) {
    if (!date || hasOverlap(ranges, start, end)) return;
    candidates.push({ index: start, date: date });
    addRange(ranges, start, end);
  }

  function dateEndWithWeekdayAnnotation(text, end) {
    var match = /^\s*[（(]\s*[日月火水木金土]\s*[）)]/.exec(text.slice(end));
    return match ? end + match[0].length : end;
  }

  function parseDates(text, base, ranges) {
    var candidates = [];
    var match;
    var regex;

    regex = /(\d{4})-(\d{1,2})-(\d{1,2})/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        dateEndWithWeekdayAnnotation(text, match.index + match[0].length),
        makeValidDate(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10))
      );
    }

    regex = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        dateEndWithWeekdayAnnotation(text, match.index + match[0].length),
        makeValidDate(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10))
      );
    }

    regex = /来月(\d{1,2})日/g;
    while ((match = regex.exec(text)) !== null) {
      var nextMonth = base.getMonth() + 1;
      var nextYear = base.getFullYear() + Math.floor(nextMonth / 12);
      var monthNumber = (nextMonth % 12) + 1;
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        dateEndWithWeekdayAnnotation(text, match.index + match[0].length),
        makeValidDate(nextYear, monthNumber, parseInt(match[1], 10))
      );
    }

    regex = /(\d{1,2})月(\d{1,2})日/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        dateEndWithWeekdayAnnotation(text, match.index + match[0].length),
        dateByMonthDayFromBase(base, parseInt(match[1], 10), parseInt(match[2], 10))
      );
    }

    regex = /(\d{1,2})\/(\d{1,2})/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        dateEndWithWeekdayAnnotation(text, match.index + match[0].length),
        dateByMonthDayFromBase(base, parseInt(match[1], 10), parseInt(match[2], 10))
      );
    }

    regex = /(\d{1,3})日後/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        match.index + match[0].length,
        addDays(base, parseInt(match[1], 10))
      );
    }

    regex = /明々後日|明明後日|しあさって|明後日|あさって|明日|あした|あす|今日|きょう/g;
    while ((match = regex.exec(text)) !== null) {
      var offset = 0;
      if (match[0] === "明日" || match[0] === "あした" || match[0] === "あす") offset = 1;
      if (match[0] === "明後日" || match[0] === "あさって") offset = 2;
      if (match[0] === "明々後日" || match[0] === "明明後日" || match[0] === "しあさって") offset = 3;
      addDateCandidate(candidates, ranges, match.index, match.index + match[0].length, addDays(base, offset));
    }

    regex = /(今週|来週|再来週)の?([日月火水木金土])曜(?:日)?/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        match.index + match[0].length,
        prefixedWeekdayDate(base, match[1], WEEKDAY[match[2]])
      );
    }

    regex = /([日月火水木金土])曜(?:日)?/g;
    while ((match = regex.exec(text)) !== null) {
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        match.index + match[0].length,
        nextStandaloneWeekday(base, WEEKDAY[match[1]])
      );
    }

    regex = /(\d{1,2})日/g;
    while ((match = regex.exec(text)) !== null) {
      var day = parseInt(match[1], 10);
      var firstOffset = day >= base.getDate() ? 0 : 1;
      addDateCandidate(
        candidates,
        ranges,
        match.index,
        dateEndWithWeekdayAnnotation(text, match.index + match[0].length),
        nextDayOfMonth(base, day, firstOffset)
      );
    }

    if (candidates.length === 0) return null;

    candidates.sort(function (a, b) {
      return a.index - b.index;
    });
    return candidates[0].date;
  }

  function recurrenceDate(base, recurrence, startTime) {
    var date;
    var diff;

    if (recurrence.freq === "daily") {
      date = startOfLocalDay(base);
      if (startTime && isTimePastOnBase(base, startTime)) date = addDays(date, 1);
      return date;
    }

    if (recurrence.freq === "weekly") {
      diff = (recurrence.weekday - base.getDay() + 7) % 7;
      date = addDays(base, diff);
      if (diff === 0 && startTime && isTimePastOnBase(base, startTime)) date = addDays(date, 7);
      return date;
    }

    if (recurrence.freq === "monthly") {
      var i;
      for (i = 0; i < 36; i += 1) {
        var year = base.getFullYear() + Math.floor((base.getMonth() + i) / 12);
        var month = ((base.getMonth() + i) % 12) + 1;
        date = makeValidDate(year, month, recurrence.day);
        if (!date || isBeforeLocalDay(date, base)) continue;
        if (sameLocalDay(date, base) && startTime && isTimePastOnBase(base, startTime)) continue;
        return date;
      }
    }

    return startOfLocalDay(base);
  }

  function extendRemovalEnd(text, end) {
    var pos = end;
    var moved = true;

    while (moved) {
      moved = false;
      while (pos < text.length && /\s/.test(text.charAt(pos))) {
        pos += 1;
        moved = true;
      }
      if (text.slice(pos, pos + 2) === "から" || text.slice(pos, pos + 2) === "まで" || text.slice(pos, pos + 2) === "より") {
        pos += 2;
        moved = true;
      } else if ("にはでへをのがもと".indexOf(text.charAt(pos)) !== -1) {
        pos += 1;
        moved = true;
      }
    }

    return pos;
  }

  function cleanTitle(text, ranges) {
    var sorted = ranges.slice().sort(function (a, b) {
      return a.start - b.start || a.end - b.end;
    });
    var merged = [];
    var i;

    for (i = 0; i < sorted.length; i += 1) {
      var start = sorted[i].start;
      var end = extendRemovalEnd(text, sorted[i].end);
      if (merged.length && start <= merged[merged.length - 1].end) {
        if (end > merged[merged.length - 1].end) merged[merged.length - 1].end = end;
      } else {
        merged.push({ start: start, end: end });
      }
    }

    var title = "";
    var cursor = 0;
    for (i = 0; i < merged.length; i += 1) {
      title += text.slice(cursor, merged[i].start) + " ";
      cursor = merged[i].end;
    }
    title += text.slice(cursor);

    title = title
      .replace(/^[\s,、。．.・:;；／\/〜~\-ー]+/, "")
      .replace(/[\s,、。．.・:;；／\/〜~\-ー]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    return title || "予定";
  }

  function parseScheduleText(text, baseDate) {
    var base = baseDate instanceof Date && !isNaN(baseDate.getTime()) ? new Date(baseDate.getTime()) : new Date();
    var normalized = normalizeText(text);
    var ranges = [];
    var recurrence = parseRecurrence(normalized, ranges);
    var date = parseDates(normalized, base, ranges);
    var time = parseTimes(normalized, ranges);
    var foundAny = !!recurrence || !!date || !!time;
    var finalDate;
    var startTime = time ? time.startTime : null;
    var endTime = time ? time.endTime : null;

    if (!foundAny) return null;

    if (recurrence) {
      finalDate = recurrenceDate(base, recurrence, startTime);
    } else if (date) {
      finalDate = date;
    } else if (startTime) {
      finalDate = startOfLocalDay(base);
      if (isTimePastOnBase(base, startTime)) finalDate = addDays(finalDate, 1);
    } else {
      finalDate = startOfLocalDay(base);
    }

    return {
      title: cleanTitle(normalized, ranges),
      date: formatDate(finalDate),
      startTime: startTime ? formatTime(startTime.hour, startTime.minute) : null,
      endTime: endTime ? formatTime(endTime.hour, endTime.minute) : null,
      recurrence: recurrence
    };
  }

  function sameResult(actual, expected) {
    if (actual === null || expected === null) return actual === expected;
    if (!actual || !expected) return false;
    if (
      actual.title !== expected.title ||
      actual.date !== expected.date ||
      actual.startTime !== expected.startTime ||
      actual.endTime !== expected.endTime
    ) {
      return false;
    }
    if (actual.recurrence === null || expected.recurrence === null) {
      return actual.recurrence === expected.recurrence;
    }
    return (
      actual.recurrence.freq === expected.recurrence.freq &&
      actual.recurrence.weekday === expected.recurrence.weekday &&
      actual.recurrence.day === expected.recurrence.day
    );
  }

  function __nlpSelfTest() {
    var base = new Date(2026, 7, 22, 10, 0, 0);
    var cases = [
      {
        text: "来週月曜昼会議",
        expected: { title: "会議", date: "2026-08-24", startTime: "12:00", endTime: null, recurrence: null }
      },
      {
        text: "明日9時半 歯医者",
        expected: { title: "歯医者", date: "2026-08-23", startTime: "09:30", endTime: null, recurrence: null }
      },
      {
        text: "毎週金曜19時 ジム",
        expected: { title: "ジム", date: "2026-08-28", startTime: "19:00", endTime: null, recurrence: { freq: "weekly", weekday: 5 } }
      },
      {
        text: "9/1 13時から14時 打ち合わせ",
        expected: { title: "打ち合わせ", date: "2026-09-01", startTime: "13:00", endTime: "14:00", recurrence: null }
      },
      {
        text: "9月1日(火) 10:00 始業式",
        expected: { title: "始業式", date: "2026-09-01", startTime: "10:00", endTime: null, recurrence: null }
      },
      {
        text: "⑨月①日(火) ⑩:00 始業式",
        expected: { title: "始業式", date: "2026-09-01", startTime: "10:00", endTime: null, recurrence: null }
      },
      {
        text: "9/1（火）始業式",
        expected: { title: "始業式", date: "2026-09-01", startTime: null, endTime: null, recurrence: null }
      },
      {
        text: "・9月1日(火) 10:00 始業式。",
        expected: { title: "始業式", date: "2026-09-01", startTime: "10:00", endTime: null, recurrence: null }
      },
      {
        text: "- 9/2（水）9:00〜 身体測定。",
        expected: { title: "身体測定", date: "2026-09-02", startTime: "09:00", endTime: null, recurrence: null }
      },
      {
        text: "● 9月3日(木) 9時〜 給食開始",
        expected: { title: "給食開始", date: "2026-09-03", startTime: "09:00", endTime: null, recurrence: null }
      },
      {
        text: "✓ 9/4（金） PTA Meeting 10:00〜",
        expected: { title: "PTA Meeting", date: "2026-09-04", startTime: "10:00", endTime: null, recurrence: null }
      },
      {
        text: "10月3日 旅行",
        expected: { title: "旅行", date: "2026-10-03", startTime: null, endTime: null, recurrence: null }
      },
      {
        text: "買い物",
        expected: null
      },
      {
        text: "今日 午後3時 電話",
        expected: { title: "電話", date: "2026-08-22", startTime: "15:00", endTime: null, recurrence: null }
      },
      {
        text: "あさって朝 散歩",
        expected: { title: "散歩", date: "2026-08-24", startTime: "09:00", endTime: null, recurrence: null }
      },
      {
        text: "明々後日夜 映画",
        expected: { title: "映画", date: "2026-08-25", startTime: "19:00", endTime: null, recurrence: null }
      },
      {
        text: "3日後 18:30 レポート提出",
        expected: { title: "レポート提出", date: "2026-08-25", startTime: "18:30", endTime: null, recurrence: null }
      },
      {
        text: "火曜日7時 ミーティング",
        expected: { title: "ミーティング", date: "2026-08-25", startTime: "07:00", endTime: null, recurrence: null }
      },
      {
        text: "来月15日に支払い",
        expected: { title: "支払い", date: "2026-09-15", startTime: null, endTime: null, recurrence: null }
      },
      {
        text: "2026年12月31日正午 忘年会",
        expected: { title: "忘年会", date: "2026-12-31", startTime: "12:00", endTime: null, recurrence: null }
      },
      {
        text: "25日 午前6時 ランニング",
        expected: { title: "ランニング", date: "2026-08-25", startTime: "06:00", endTime: null, recurrence: null }
      },
      {
        text: "毎日7時 体操",
        expected: { title: "体操", date: "2026-08-23", startTime: "07:00", endTime: null, recurrence: { freq: "daily" } }
      },
      {
        text: "毎月31日23:15 請求確認",
        expected: { title: "請求確認", date: "2026-08-31", startTime: "23:15", endTime: null, recurrence: { freq: "monthly", day: 31 } }
      },
      {
        text: "９／１　１３：００－１５：００　面談",
        expected: { title: "面談", date: "2026-09-01", startTime: "13:00", endTime: "15:00", recurrence: null }
      },
      {
        text: "明日午後1時から3時 面談",
        expected: { title: "面談", date: "2026-08-23", startTime: "13:00", endTime: "15:00", recurrence: null }
      },
      {
        text: "再来週火曜 1時 作業",
        expected: { title: "作業", date: "2026-09-01", startTime: "13:00", endTime: null, recurrence: null }
      },
      {
        text: "15時に電話",
        expected: { title: "電話", date: "2026-08-22", startTime: "15:00", endTime: null, recurrence: null }
      },
      {
        text: "9時に電話",
        expected: { title: "電話", date: "2026-08-23", startTime: "09:00", endTime: null, recurrence: null }
      }
    ];
    var pass = 0;
    var i;

    for (i = 0; i < cases.length; i += 1) {
      var actual = parseScheduleText(cases[i].text, base);
      var ok = sameResult(actual, cases[i].expected);
      if (ok) pass += 1;
      if (root.console && root.console.log) {
        root.console.log(
          (ok ? "PASS" : "FAIL") +
            " [" +
            (i + 1) +
            "/" +
            cases.length +
            "] " +
            cases[i].text,
          { actual: actual, expected: cases[i].expected }
        );
      }
    }

    if (root.console && root.console.log) {
      root.console.log("nlp.js self test: " + pass + "/" + cases.length + " passed");
    }

    return { passed: pass, total: cases.length };
  }

  root.parseScheduleText = parseScheduleText;
  root.__nlpSelfTest = __nlpSelfTest;
})(typeof window !== "undefined" ? window : this);
