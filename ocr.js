(function (root) {
  "use strict";

  // ワーカー内のimportScripts/fetchはワーカーの場所を基準に相対パスを解決するため、
  // ページ基準の絶対URLに変換して渡す必要がある
  var BASE_URL = (root.location && /^https?:$/.test(root.location.protocol))
    ? new root.URL(".", root.location.href).href
    : "";
  var SCRIPT_PATH = BASE_URL + "vendor/tesseract/tesseract.min.js";
  var WORKER_PATH = BASE_URL + "vendor/tesseract/worker.min.js";
  var CORE_PATH = BASE_URL + "vendor/tesseract/core";
  var LANG_PATH = BASE_URL + "vendor/tesseract/lang";
  var LANG = "jpn";
  var PSM = "11";
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

  var scriptPromise = null;
  var workerPromise = null;
  var worker = null;
  var activeProgress = null;
  var lastProgress = 0;

  function available() {
    var protocol = root.location && root.location.protocol;
    return (
      (protocol === "http:" || protocol === "https:") &&
      typeof root.Worker === "function"
    );
  }

  function callProgress(onProgress, percent, phase) {
    if (typeof onProgress !== "function") return;
    try {
      var nextProgress = Math.max(0, Math.min(100, Math.round(percent)));
      nextProgress = Math.max(lastProgress, nextProgress);
      lastProgress = nextProgress;
      onProgress(nextProgress, phase);
    } catch (error) {
      // Progress callbacks are observational and should not break OCR.
    }
  }

  function progressInRange(progress, start, end) {
    var boundedProgress = Math.max(0, Math.min(1, progress || 0));
    return start + (end - start) * boundedProgress;
  }

  function overallProgress(status, progress) {
    if (status === "loading language traineddata") {
      return progressInRange(progress, 40, 70);
    }
    if (status === "recognizing text") {
      return progressInRange(progress, 70, 100);
    }
    if (status === "initializing api") {
      return 70;
    }
    return progressInRange(progress, 0, 40);
  }

  function phaseLabel(status) {
    if (status === "loading tesseract core") return "OCRエンジン読み込み";
    if (status === "initializing tesseract") return "OCRエンジン初期化";
    if (status === "loading language traineddata") return "日本語データ読み込み";
    if (status === "initializing api") return "日本語OCR初期化";
    if (status === "recognizing text") return "文字認識中";
    return status || "処理中";
  }

  function loadScript(onProgress) {
    if (root.Tesseract && typeof root.Tesseract.createWorker === "function") {
      return Promise.resolve();
    }
    if (scriptPromise) return scriptPromise;

    callProgress(activeProgress || onProgress, 0, "OCRライブラリ読み込み");
    scriptPromise = new Promise(function (resolve, reject) {
      var script = root.document.createElement("script");
      script.src = SCRIPT_PATH;
      script.async = true;
      script.onload = function () {
        if (root.Tesseract && typeof root.Tesseract.createWorker === "function") {
          callProgress(activeProgress || onProgress, 5, "OCRライブラリ読み込み完了");
          resolve();
        } else {
          reject(new Error("OCRライブラリを読み込めませんでした。"));
        }
      };
      script.onerror = function () {
        reject(new Error("OCRライブラリを読み込めませんでした。vendor/tesseract を確認してください。"));
      };
      root.document.head.appendChild(script);
    });

    return scriptPromise;
  }

  function createWorker(onProgress) {
    if (worker) return Promise.resolve(worker);
    if (workerPromise) return workerPromise;

    workerPromise = loadScript(onProgress)
      .then(function () {
        callProgress(activeProgress || onProgress, 5, "OCRワーカー準備");
        return root.Tesseract.createWorker(LANG, 1, {
          workerPath: WORKER_PATH,
          corePath: CORE_PATH,
          langPath: LANG_PATH,
          workerBlobURL: false,
          logger: function (message) {
            if (!message || typeof message.progress !== "number") return;
            callProgress(activeProgress || onProgress, overallProgress(message.status, message.progress), phaseLabel(message.status));
          }
        });
      })
      .then(function (createdWorker) {
        worker = createdWorker;
        return worker.setParameters({
          tessedit_pageseg_mode: PSM,
          preserve_interword_spaces: "1"
        }).then(function () {
          callProgress(activeProgress || onProgress, 70, "OCRワーカー準備完了");
          return worker;
        });
      })
      .catch(function (error) {
        workerPromise = null;
        if (worker && typeof worker.terminate === "function") {
          try {
            worker.terminate();
          } catch (terminateError) {
            // Ignore cleanup errors; the caller receives the original failure.
          }
        }
        worker = null;
        throw error;
      });

    return workerPromise;
  }

  function normalizeJapaneseOcrSpaces(text) {
    var japanese = "ぁ-んァ-ヶー一-龠々〆〤";
    var dateTimeUnits = "年月日時分秒";
    var result = String(text == null ? "" : text)
      .replace(/[⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, function (ch) {
        return CIRCLED_NUMBERS[ch] || ch;
      })
      .replace(/\r\n?/g, "\n");
    var previous;

    do {
      previous = result;
      result = result
        .replace(new RegExp("([" + japanese + "])[\t ]+(?=[" + japanese + "])", "g"), "$1")
        .replace(new RegExp("(\\d)[\t ]+(?=[" + dateTimeUnits + "])", "g"), "$1")
        .replace(new RegExp("([" + dateTimeUnits + "])[\t ]+(?=\\d)", "g"), "$1");
    } while (result !== previous);

    return result
      .replace(/\s*([:：／\/〜~\-－ー–—～])\s*/g, "$1")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .trim();
  }

  function splitLines(text) {
    return text
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
  }

  function friendlyError(error) {
    var message = error && error.message ? error.message : String(error || "");
    if (!available()) {
      return new Error("OCRはHTTPまたはHTTPSで開いたときだけ利用できます。ローカルサーバーから起動してください。");
    }
    if (/fetch|network|load|traineddata|worker|wasm|core/i.test(message)) {
      return new Error("OCRに必要なローカルファイルを読み込めませんでした。vendor/tesseract の配置を確認してください。");
    }
    return new Error("画像の文字認識に失敗しました。画像を明るく撮り直すか、文字部分が大きく写るようにしてください。");
  }

  function recognize(fileOrBlob, onProgress) {
    activeProgress = onProgress;
    lastProgress = 0;
    if (!available()) {
      return Promise.reject(new Error("OCRはHTTPまたはHTTPSで開いたときだけ利用できます。ローカルサーバーから起動してください。"));
    }
    if (!fileOrBlob) {
      return Promise.reject(new Error("OCRする画像ファイルが指定されていません。"));
    }

    callProgress(onProgress, 0, "OCR準備");
    return createWorker(onProgress)
      .then(function (activeWorker) {
        callProgress(onProgress, 70, "文字認識開始");
        return activeWorker.recognize(fileOrBlob, {}, { text: true });
      })
      .then(function (result) {
        var data = result && result.data ? result.data : {};
        var text = normalizeJapaneseOcrSpaces(data.text || "");
        callProgress(onProgress, 100, "文字認識完了");
        return {
          text: text,
          lines: splitLines(text)
        };
      })
      .catch(function (error) {
        throw friendlyError(error);
      });
  }

  root.SchedulerOCR = {
    available: available,
    recognize: recognize
  };
})(typeof window !== "undefined" ? window : this);
