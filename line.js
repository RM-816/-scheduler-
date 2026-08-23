(function () {
  "use strict";

  const LIFF_SDK_URL = "https://static.line-scdn.net/liff/edge/2/sdk.js";
  let initPromise = null;
  let sdkPromise = null;
  let status = { enabled: false, inClient: false };

  function getLiffId() {
    const config = window.LINE_CONFIG;
    return config && typeof config.liffId === "string" ? config.liffId.trim() : "";
  }

  function canLoadSdk() {
    return (
      typeof window !== "undefined" &&
      typeof document !== "undefined" &&
      (location.protocol === "http:" || location.protocol === "https:")
    );
  }

  function loadLiffSdk() {
    if (window.liff) {
      return Promise.resolve(window.liff);
    }
    if (sdkPromise) {
      return sdkPromise;
    }

    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIFF_SDK_URL;
      script.async = true;
      script.onload = () => {
        if (window.liff) {
          resolve(window.liff);
          return;
        }
        reject(new Error("LIFF SDK loaded without window.liff"));
      };
      script.onerror = () => reject(new Error("LIFF SDK load failed"));
      document.head.appendChild(script);
    });

    return sdkPromise;
  }

  async function init() {
    const liffId = getLiffId();
    if (!liffId || !canLoadSdk()) {
      status = { enabled: false, inClient: false };
      return { ...status };
    }
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      try {
        const liff = await loadLiffSdk();
        if (!liff || typeof liff.init !== "function") {
          throw new Error("LIFF SDK is unavailable");
        }
        await liff.init({ liffId });
        status = {
          enabled: true,
          inClient: Boolean(typeof liff.isInClient === "function" && liff.isInClient())
        };
        return { ...status };
      } catch (error) {
        console.warn("LINE LIFF initialization failed:", error);
        status = { enabled: false, inClient: false };
        return { ...status };
      }
    })();

    return initPromise;
  }

  function isInClient() {
    return Boolean(
      status.enabled &&
      status.inClient &&
      window.liff &&
      typeof window.liff.isInClient === "function" &&
      window.liff.isInClient()
    );
  }

  async function getProfileName() {
    if (!status.enabled || !window.liff) {
      return null;
    }
    try {
      if (typeof window.liff.isLoggedIn === "function" && !window.liff.isLoggedIn()) {
        return null;
      }
      if (typeof window.liff.getProfile !== "function") {
        return null;
      }
      const profile = await window.liff.getProfile();
      return profile && typeof profile.displayName === "string" && profile.displayName
        ? profile.displayName
        : null;
    } catch (error) {
      return null;
    }
  }

  async function shareText(text) {
    if (!isInClient() || !window.liff) {
      return { status: "unavailable" };
    }
    if (typeof window.liff.isApiAvailable === "function" && !window.liff.isApiAvailable("shareTargetPicker")) {
      return { status: "unavailable" };
    }
    if (typeof window.liff.shareTargetPicker !== "function") {
      return { status: "unavailable" };
    }

    try {
      const result = await window.liff.shareTargetPicker([
        { type: "text", text: String(text || "") }
      ]);
      if (result === null || result === false || (result && result.status === "cancel")) {
        return { status: "cancelled" };
      }
      return { status: "success", result };
    } catch (error) {
      console.warn("LINE shareTargetPicker failed:", error);
      return { status: "failed", error };
    }
  }

  window.SchedulerLine = {
    init,
    isInClient,
    getProfileName,
    shareText
  };
})();
