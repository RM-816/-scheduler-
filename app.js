(function () {
  "use strict";

  const STORAGE_KEYS = {
    events: "scheduler.events",
    todos: "scheduler.todos",
    settings: "scheduler.settings",
    tombstones: "scheduler.tombstones",
    sync: "scheduler.sync"
  };

  const DEFAULT_CATEGORIES = [
    { key: "work", label: "仕事", color: "#3B82F6" },
    { key: "study", label: "勉強", color: "#8B5CF6" },
    { key: "private", label: "プライベート", color: "#22C55E" },
    { key: "exercise", label: "運動", color: "#F97316" }
  ];
  const LEGACY_OPTIONAL_CATEGORIES = {
    important: { key: "important", label: "大事", color: "#EF4444" },
    other: { key: "other", label: "その他", color: "#6B7280" }
  };
  const CATEGORY_PALETTE = ["#3B82F6", "#8B5CF6", "#22C55E", "#F97316", "#EF4444", "#EC4899", "#14B8A6", "#6B7280"];
  const CATEGORY_MAX_COUNT = 8;
  const CATEGORY_LABEL_MAX_LENGTH = 10;
  const CATEGORY_MIGRATION_FLAG = "categoriesMigrated";
  const CATEGORY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
  const VALID_RECURRENCES = new Set(["daily", "weekly", "monthly"]);
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const HOUR_START = 7;
  const HOUR_END = 24;
  const HOUR_HEIGHT = 48;
  const NOTIFICATION_CATCH_UP_LIMIT_MINUTES = 30;
  const DEFAULT_REMINDER_MINUTES = 10;
  const REMINDER_CUSTOM_MAX_MINUTES = 10080;
  const REMINDER_PRESET_VALUES = [0, 5, 10, 15, 30, 60, 120, 1440];
  const VALID_TIME_MODES = new Set(["timed", "allday", "am", "pm"]);
  const SHARE_VERSION = 1;
  const SHARE_HASH_PREFIX = "#share=";
  const SHARE_MAX_EVENTS = 30;
  const SHARE_MAX_HASH_LENGTH = 60000;
  const SHARE_TITLE_MAX_LENGTH = 80;
  const SHARE_MEMO_MAX_LENGTH = 300;
  const SHARE_CATEGORY_LABEL_MAX_LENGTH = CATEGORY_LABEL_MAX_LENGTH;
  const SHARE_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const SYNC_HASH_PREFIX = "#sync=";
  const SYNC_API_PATH = "/api/sync";
  const SYNC_DEBOUNCE_MS = 2500;
  const SYNC_INTERVAL_MS = 60000;
  const SYNC_TOMBSTONE_MAX = 500;
  const SYNC_TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const SYNC_DATA_LIMIT_BYTES = 256 * 1024;
  const SYNC_EPOCH = "1970-01-01T00:00:00.000Z";
  const PERIOD_TIME_MODE_RANGES = {
    am: { startTime: "09:00", endTime: "12:00" },
    pm: { startTime: "13:00", endTime: "17:00" }
  };
  const TIME_MODE_LABELS = {
    allday: "終日",
    am: "午前",
    pm: "午後"
  };

  const state = {
    view: "month",
    currentMonth: startOfMonth(new Date()),
    currentWeekStart: startOfWeek(new Date()),
    selectedDate: formatDate(new Date()),
    editing: null,
    events: [],
    todos: [],
    tombstones: { events: [], todos: [] },
    settings: defaultSettings(),
    syncState: null,
    syncServerStatus: "unknown",
    categoryPaletteFor: null,
    syncLinkUrl: "",
    notificationTimer: null,
    lastNotificationCheckAt: null,
    importCandidates: [],
    importImageUrl: null,
    voiceRecognition: null,
    voiceListening: false,
    voiceStopping: false,
    voiceBaseText: "",
    voiceFinalText: "",
    choiceCancelAction: null,
    pendingSharedEvents: []
  };

  const els = {};
  const MONTH_RESIZE_DEBOUNCE_MS = 120;
  const MONTH_FIT_EPSILON = 0.5;
  const WIDE_LAYOUT_QUERY = "(min-width: 900px)";
  const DESKTOP_MONTH_EVENT_CHIP_LIMIT = 6;
  const SWIPE_MIN_DISTANCE = 48;
  const SWIPE_HORIZONTAL_RATIO = 1.5;
  const CALENDAR_SLIDE_MS = 180;
  let monthResizeTimer = null;
  let wideLayoutMedia = null;
  const syncRuntime = {
    debounceTimer: null,
    intervalTimer: null,
    inFlight: false,
    suppressLocalChange: false
  };
  const calendarSlideTimers = new WeakMap();

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    state.syncState = loadSyncState();
    state.tombstones = loadTombstones();
    state.settings = loadSettings();
    state.events = loadEvents();
    state.todos = loadTodos();
    pruneAndSaveTombstones({ skipSync: true });
    migrateCategoriesIfNeeded();
    setupOptionalIcon();
    setupWideDayPanelLayout();
    bindEvents();
    renderAll();
    startNotificationTimer();
    setupSyncEngine();
    handleIncomingSyncHash();
    handleIncomingShareHash();
  }

  function cacheElements() {
    els.dateSubtitle = byId("dateSubtitle");
    els.notificationBannerArea = byId("notificationBannerArea");
    els.toastArea = byId("toastArea");
    els.appIcon = byId("appIcon");
    els.iconFallback = byId("iconFallback");
    els.favicon = byId("appFavicon");

    els.monthView = byId("monthView");
    els.weekView = byId("weekView");
    els.todoView = byId("todoView");
    els.settingsView = byId("settingsView");
    els.tabButtons = Array.from(document.querySelectorAll(".tab-button"));

    els.prevMonth = byId("prevMonth");
    els.nextMonth = byId("nextMonth");
    els.todayMonth = byId("todayMonth");
    els.monthHeading = byId("monthHeading");
    els.monthGrid = byId("monthGrid");
    els.welcomeCard = byId("welcomeCard");
    els.closeWelcomeCard = byId("closeWelcomeCard");
    els.welcomeHelpLink = byId("welcomeHelpLink");

    els.prevWeek = byId("prevWeek");
    els.nextWeek = byId("nextWeek");
    els.weekHeading = byId("weekHeading");
    els.weekCard = document.querySelector(".week-card");
    els.weekAllDay = byId("weekAllDay");
    els.weekTimeline = byId("weekTimeline");

    els.todoForm = byId("todoForm");
    els.todoInput = byId("todoInput");
    els.todoCountText = byId("todoCountText");
    els.todoList = byId("todoList");
    els.todoBadge = byId("todoBadge");

    els.notificationToggle = byId("notificationToggle");
    els.defaultReminderSelect = byId("defaultReminderSelect");
    els.defaultReminderCustom = byId("defaultReminderCustom");
    els.categorySettingsList = byId("categorySettingsList");
    els.addCategoryButton = byId("addCategoryButton");
    els.clearDataButton = byId("clearDataButton");
    els.openHelpButton = byId("openHelpButton");
    els.syncStatusText = byId("syncStatusText");
    els.syncDescription = byId("syncDescription");
    els.syncUnavailable = byId("syncUnavailable");
    els.startSyncButton = byId("startSyncButton");
    els.addSyncDeviceButton = byId("addSyncDeviceButton");
    els.disconnectSyncButton = byId("disconnectSyncButton");

    els.importButton = byId("importButton");
    els.chatBar = byId("chatBar");
    els.voiceButton = byId("voiceButton");
    els.chatInput = byId("chatInput");
    els.addEventFab = byId("addEventFab");

    els.desktopDaySidebar = byId("desktopDaySidebar");
    els.dayPanelBackdrop = byId("dayPanelBackdrop");
    els.dayPanel = document.querySelector(".day-panel");
    els.selectedDayTitle = byId("selectedDayTitle");
    els.selectedDayHoliday = byId("selectedDayHoliday");
    els.selectedDayEvents = byId("selectedDayEvents");
    els.closeDayPanel = byId("closeDayPanel");
    els.addForDayButton = byId("addForDayButton");
    els.shareDayButton = byId("shareDayButton");

    els.eventModal = byId("eventModal");
    els.eventModalTitle = byId("eventModalTitle");
    els.eventModalHint = byId("eventModalHint");
    els.closeEventModal = byId("closeEventModal");
    els.eventForm = byId("eventForm");
    els.eventFormBody = document.querySelector(".event-form-body");
    els.eventTitle = byId("eventTitle");
    els.eventDate = byId("eventDate");
    els.eventTimeModeGroup = byId("eventTimeModeGroup");
    els.eventTimeModeButtons = Array.from(document.querySelectorAll("[data-time-mode]"));
    els.eventTimeFields = byId("eventTimeFields");
    els.eventStart = byId("eventStart");
    els.eventEnd = byId("eventEnd");
    els.eventColor = byId("eventColor");
    els.eventRecurrence = byId("eventRecurrence");
    els.eventReminder = byId("eventReminder");
    els.eventReminderCustom = byId("eventReminderCustom");
    els.eventReminderUnavailable = byId("eventReminderUnavailable");
    els.eventMemo = byId("eventMemo");
    els.formError = byId("formError");
    els.deleteEventButton = byId("deleteEventButton");
    els.shareEventButton = byId("shareEventButton");
    els.cancelEventButton = byId("cancelEventButton");
    els.colorOptions = byId("colorOptions");
    els.openCategoryEditorButton = byId("openCategoryEditorButton");
    els.eventCategoryEditorModal = byId("eventCategoryEditorModal");
    els.closeCategoryEditorButton = byId("closeCategoryEditorButton");
    els.eventCategoryEditorBody = document.querySelector(".category-editor-body");
    els.eventCategorySettingsList = byId("eventCategorySettingsList");
    els.eventAddCategoryButton = byId("eventAddCategoryButton");

    els.helpModal = byId("helpModal");
    els.helpContent = byId("helpContent");
    els.closeHelpModal = byId("closeHelpModal");

    els.choiceModal = byId("choiceModal");
    els.choiceTitle = byId("choiceTitle");
    els.choiceMessage = byId("choiceMessage");
    els.choiceActions = byId("choiceActions");

    els.shareLinkModal = byId("shareLinkModal");
    els.shareLinkText = byId("shareLinkText");
    els.closeShareLinkModal = byId("closeShareLinkModal");
    els.closeShareLinkButton = byId("closeShareLinkButton");
    els.syncLinkModal = byId("syncLinkModal");
    els.syncLinkText = byId("syncLinkText");
    els.closeSyncLinkModal = byId("closeSyncLinkModal");
    els.copySyncLinkButton = byId("copySyncLinkButton");
    els.shareSyncLinkButton = byId("shareSyncLinkButton");
    els.closeSyncLinkButton = byId("closeSyncLinkButton");
    els.sharedEventsModal = byId("sharedEventsModal");
    els.sharedEventsList = byId("sharedEventsList");
    els.sharedEventsSummary = byId("sharedEventsSummary");
    els.addSharedEventsButton = byId("addSharedEventsButton");
    els.cancelSharedEventsButton = byId("cancelSharedEventsButton");
    els.closeSharedEventsModal = byId("closeSharedEventsModal");

    els.importModal = byId("importModal");
    els.closeImportModal = byId("closeImportModal");
    els.importBody = document.querySelector(".import-body");
    els.importText = byId("importText");
    els.ocrPhotoArea = byId("ocrPhotoArea");
    els.ocrUnavailableNotice = byId("ocrUnavailableNotice");
    els.ocrControls = byId("ocrControls");
    els.chooseImageButton = byId("chooseImageButton");
    els.importImageInput = byId("importImageInput");
    els.ocrThumbnail = byId("ocrThumbnail");
    els.ocrProgress = byId("ocrProgress");
    els.ocrProgressPhase = byId("ocrProgressPhase");
    els.ocrProgressPercent = byId("ocrProgressPercent");
    els.ocrProgressBar = byId("ocrProgressBar");
    els.parseImportButton = byId("parseImportButton");
    els.registerImportButton = byId("registerImportButton");
    els.importCandidateSummary = byId("importCandidateSummary");
    els.importCandidateList = byId("importCandidateList");
  }

  function bindEvents() {
    els.tabButtons.forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });

    els.prevMonth.addEventListener("click", () => {
      navigateMonth(-1);
    });

    els.nextMonth.addEventListener("click", () => {
      navigateMonth(1);
    });

    els.todayMonth.addEventListener("click", () => {
      const today = new Date();
      state.currentMonth = startOfMonth(today);
      state.selectedDate = formatDate(today);
      renderMonth();
      renderDayPanelIfVisible();
    });
    els.closeWelcomeCard.addEventListener("click", dismissWelcomeCard);
    els.welcomeHelpLink.addEventListener("click", openHelpModal);

    els.prevWeek.addEventListener("click", () => {
      navigateWeek(-1);
    });

    els.nextWeek.addEventListener("click", () => {
      navigateWeek(1);
    });

    setupCalendarSwipeNavigation();

    els.addEventFab.addEventListener("click", () => {
      openEventForm({ date: defaultDateForAdd() });
    });

    els.importButton.addEventListener("click", openImportModal);
    els.chatBar.addEventListener("submit", handleChatSubmit);
    setupVoiceInput();

    els.closeDayPanel.addEventListener("click", closeDayPanel);
    els.dayPanelBackdrop.addEventListener("click", (event) => {
      if (event.target === els.dayPanelBackdrop) {
        closeDayPanel();
      }
    });
    els.addForDayButton.addEventListener("click", () => {
      openEventForm({ date: state.selectedDate });
    });
    els.shareDayButton.addEventListener("click", handleShareSelectedDay);

    els.closeEventModal.addEventListener("click", closeEventModal);
    els.cancelEventButton.addEventListener("click", closeEventModal);
    els.eventModal.addEventListener("click", (event) => {
      if (event.target === els.eventModal) {
        closeEventModal();
      }
    });
    els.eventForm.addEventListener("submit", handleEventSubmit);
    els.deleteEventButton.addEventListener("click", handleDeleteEvent);
    els.shareEventButton.addEventListener("click", handleShareCurrentEvent);
    els.colorOptions.addEventListener("click", handleEventCategoryClick);
    els.openCategoryEditorButton.addEventListener("click", openEventCategoryEditor);
    els.closeCategoryEditorButton.addEventListener("click", closeEventCategoryEditor);
    els.eventCategoryEditorModal.addEventListener("click", (event) => {
      if (event.target === els.eventCategoryEditorModal) {
        closeEventCategoryEditor();
      }
    });
    els.eventCategorySettingsList.addEventListener("click", handleCategorySettingsClick);
    els.eventCategorySettingsList.addEventListener("input", handleCategoryNameInput);
    els.eventCategorySettingsList.addEventListener("focusin", handleCategoryNameFocus);
    els.eventCategorySettingsList.addEventListener("focusout", handleCategoryNameBlur);
    els.eventAddCategoryButton.addEventListener("click", handleAddCategory);
    els.eventTimeModeGroup.addEventListener("click", handleEventTimeModeClick);
    els.eventStart.addEventListener("input", updateEventReminderAvailability);
    els.eventStart.addEventListener("change", updateEventReminderAvailability);
    els.eventReminder.addEventListener("change", handleEventReminderChange);

    els.todoForm.addEventListener("submit", handleTodoSubmit);
    els.notificationToggle.addEventListener("change", handleNotificationToggle);
    els.defaultReminderSelect.addEventListener("change", handleDefaultReminderChange);
    els.defaultReminderCustom.addEventListener("input", handleDefaultReminderCustomInput);
    els.defaultReminderCustom.addEventListener("change", handleDefaultReminderCustomInput);
    els.categorySettingsList.addEventListener("click", handleCategorySettingsClick);
    els.categorySettingsList.addEventListener("input", handleCategoryNameInput);
    els.categorySettingsList.addEventListener("focusin", handleCategoryNameFocus);
    els.categorySettingsList.addEventListener("focusout", handleCategoryNameBlur);
    els.addCategoryButton.addEventListener("click", handleAddCategory);
    els.clearDataButton.addEventListener("click", handleClearData);
    els.openHelpButton.addEventListener("click", openHelpModal);
    els.startSyncButton.addEventListener("click", handleStartSync);
    els.addSyncDeviceButton.addEventListener("click", openSyncLinkModal);
    els.disconnectSyncButton.addEventListener("click", handleDisconnectSync);

    els.closeHelpModal.addEventListener("click", closeHelpModal);
    els.helpModal.addEventListener("click", (event) => {
      if (event.target === els.helpModal) {
        closeHelpModal();
      }
    });

    els.choiceModal.addEventListener("click", (event) => {
      if (event.target === els.choiceModal) {
        closeChoiceModal({ runCancel: true });
      }
    });

    els.closeShareLinkModal.addEventListener("click", closeShareLinkModal);
    els.closeShareLinkButton.addEventListener("click", closeShareLinkModal);
    els.shareLinkModal.addEventListener("click", (event) => {
      if (event.target === els.shareLinkModal) {
        closeShareLinkModal();
      }
    });
    els.closeSyncLinkModal.addEventListener("click", closeSyncLinkModal);
    els.copySyncLinkButton.addEventListener("click", copySyncLink);
    els.shareSyncLinkButton.addEventListener("click", shareSyncLink);
    els.closeSyncLinkButton.addEventListener("click", closeSyncLinkModal);
    els.syncLinkModal.addEventListener("click", (event) => {
      if (event.target === els.syncLinkModal) {
        closeSyncLinkModal();
      }
    });
    els.cancelSharedEventsButton.addEventListener("click", cancelSharedEvents);
    els.closeSharedEventsModal.addEventListener("click", cancelSharedEvents);
    els.addSharedEventsButton.addEventListener("click", addCheckedSharedEvents);
    els.sharedEventsList.addEventListener("change", updateSharedEventsAddButton);
    els.sharedEventsModal.addEventListener("click", (event) => {
      if (event.target === els.sharedEventsModal) {
        cancelSharedEvents();
      }
    });

    els.closeImportModal.addEventListener("click", closeImportModal);
    els.importModal.addEventListener("click", (event) => {
      if (event.target === els.importModal) {
        closeImportModal();
      }
    });
    els.chooseImageButton.addEventListener("click", () => {
      els.importImageInput.click();
    });
    els.importImageInput.addEventListener("change", handleImportImageSelect);
    els.parseImportButton.addEventListener("click", handleParseImport);
    els.registerImportButton.addEventListener("click", handleRegisterImport);
    els.importCandidateList.addEventListener("change", handleImportCandidateToggle);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!els.eventCategoryEditorModal.hidden) {
        closeEventCategoryEditor();
      } else if (!els.helpModal.hidden) {
        closeHelpModal();
      } else if (!els.sharedEventsModal.hidden) {
        cancelSharedEvents();
      } else if (!els.shareLinkModal.hidden) {
        closeShareLinkModal();
      } else if (!els.syncLinkModal.hidden) {
        closeSyncLinkModal();
      } else if (!els.choiceModal.hidden) {
        closeChoiceModal({ runCancel: true });
      } else if (!els.importModal.hidden) {
        closeImportModal();
      } else if (!els.eventModal.hidden) {
        closeEventModal();
      } else if (!els.dayPanelBackdrop.hidden) {
        closeDayPanel();
      }
    });

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("resize", scheduleMonthResizeRender);
    window.addEventListener("orientationchange", scheduleMonthResizeRender);
  }

  function setupWideDayPanelLayout() {
    if (typeof window.matchMedia === "function") {
      wideLayoutMedia = window.matchMedia(WIDE_LAYOUT_QUERY);
      if (typeof wideLayoutMedia.addEventListener === "function") {
        wideLayoutMedia.addEventListener("change", handleWideLayoutChange);
      } else if (typeof wideLayoutMedia.addListener === "function") {
        wideLayoutMedia.addListener(handleWideLayoutChange);
      }
    }
    syncDayPanelLayout();
  }

  function handleWideLayoutChange() {
    syncDayPanelLayout();
    renderMonth();
    renderDayPanelIfVisible();
  }

  function isWideLayout() {
    if (wideLayoutMedia) {
      return wideLayoutMedia.matches;
    }
    return window.innerWidth >= 900;
  }

  function syncDayPanelLayout() {
    if (!els.dayPanel || !els.dayPanelBackdrop || !els.desktopDaySidebar) {
      return;
    }

    if (isWideLayout()) {
      els.dayPanelBackdrop.hidden = true;
      if (els.dayPanel.parentElement !== els.desktopDaySidebar) {
        els.desktopDaySidebar.appendChild(els.dayPanel);
      }
      return;
    }

    if (els.dayPanel.parentElement !== els.dayPanelBackdrop) {
      els.dayPanelBackdrop.appendChild(els.dayPanel);
    }
    els.dayPanelBackdrop.hidden = true;
  }

  function renderAll() {
    renderHeader();
    renderTabs();
    renderMonth();
    renderWeek();
    renderTodos();
    renderEventColorOptions();
    renderSettings();
    renderDayPanelIfVisible();
  }

  function renderHeader() {
    els.dateSubtitle.textContent = formatLongDate(formatDate(new Date()));
  }

  function renderTabs() {
    document.body.dataset.view = state.view;
    const viewMap = {
      month: els.monthView,
      week: els.weekView,
      todo: els.todoView,
      settings: els.settingsView
    };

    Object.keys(viewMap).forEach((view) => {
      const isActive = view === state.view;
      viewMap[view].hidden = !isActive;
      viewMap[view].classList.toggle("is-active", isActive);
    });

    els.tabButtons.forEach((button) => {
      const isActive = button.dataset.view === state.view;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function switchView(view) {
    if (!["month", "week", "todo", "settings"].includes(view)) {
      return;
    }
    state.view = view;
    renderAll();
  }

  function navigateMonth(offset) {
    state.currentMonth = addMonths(state.currentMonth, offset);
    renderMonth();
    animateCalendarSurface(els.monthGrid, offset);
  }

  function navigateWeek(offset) {
    state.currentWeekStart = addDays(state.currentWeekStart, offset * 7);
    renderWeek();
    animateCalendarSurface(els.weekCard, offset);
  }

  function setupCalendarSwipeNavigation() {
    setupSwipeNavigation(els.monthGrid, (direction) => navigateMonth(direction));
    setupSwipeNavigation(els.weekAllDay, (direction) => navigateWeek(direction));
  }

  function setupSwipeNavigation(surface, onNavigate) {
    if (!surface) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let tracking = false;
    let suppressClickUntil = 0;

    surface.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      currentY = startY;
      tracking = true;
    }, { passive: true });

    surface.addEventListener("touchmove", (event) => {
      if (!tracking || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      currentX = touch.clientX;
      currentY = touch.clientY;
      if (isCalendarSwipe(currentX - startX, currentY - startY)) {
        event.preventDefault();
      }
    }, { passive: false });

    surface.addEventListener("touchend", (event) => {
      if (!tracking) {
        return;
      }
      const touch = event.changedTouches[0];
      if (touch) {
        currentX = touch.clientX;
        currentY = touch.clientY;
      }
      const dx = currentX - startX;
      const dy = currentY - startY;
      tracking = false;

      if (!isCalendarSwipe(dx, dy)) {
        return;
      }

      suppressClickUntil = performance.now() + 350;
      event.preventDefault();
      event.stopPropagation();
      onNavigate(dx < 0 ? 1 : -1);
    }, { passive: false });

    surface.addEventListener("touchcancel", () => {
      tracking = false;
    }, { passive: true });

    surface.addEventListener("click", (event) => {
      if (performance.now() > suppressClickUntil) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function isCalendarSwipe(dx, dy) {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    return absX >= SWIPE_MIN_DISTANCE && absX > absY * SWIPE_HORIZONTAL_RATIO;
  }

  function animateCalendarSurface(surface, direction) {
    if (!surface) {
      return;
    }
    const className = direction > 0 ? "is-slide-forward" : "is-slide-backward";
    const existingTimer = calendarSlideTimers.get(surface);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    surface.classList.remove("is-slide-forward", "is-slide-backward");
    void surface.offsetWidth;
    surface.classList.add(className);
    const timer = window.setTimeout(() => {
      surface.classList.remove(className);
      calendarSlideTimers.delete(surface);
    }, CALENDAR_SLIDE_MS);
    calendarSlideTimers.set(surface, timer);
  }

  function renderMonth() {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();
    els.monthHeading.textContent = `${year}年${month + 1}月`;
    renderWelcomeCard();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const gridStart = startOfWeek(firstDay);
    const gridEnd = addDays(lastDay, 6 - lastDay.getDay());
    const cellCount = Math.max(35, Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1);
    const weekCount = cellCount / 7;
    const todayStr = formatDate(new Date());
    const nodes = [];

    els.monthGrid.style.setProperty("--month-week-count", String(weekCount));

    for (let index = 0; index < cellCount; index += 1) {
      const date = addDays(gridStart, index);
      const dateStr = formatDate(date);
      const holidayName = getHolidayName(dateStr);
      const weekday = date.getDay();
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";
      cell.setAttribute("aria-label", formatLongDate(dateStr));

      if (date.getMonth() !== month) {
        cell.classList.add("is-outside");
      }
      if (dateStr === todayStr) {
        cell.classList.add("is-today");
      }
      if (dateStr === state.selectedDate) {
        cell.classList.add("is-selected");
      }
      if (weekday === 0) {
        cell.classList.add("is-sunday");
      }
      if (weekday === 6) {
        cell.classList.add("is-saturday");
      }
      if (holidayName) {
        cell.classList.add("is-holiday");
      }

      const top = document.createElement("div");
      top.className = "day-top";
      const number = document.createElement("span");
      number.className = "day-number";
      number.textContent = String(date.getDate());
      top.appendChild(number);

      if (holidayName) {
        const holiday = document.createElement("span");
        holiday.className = "holiday-name";
        holiday.textContent = holidayName;
        top.appendChild(holiday);
      }

      const stack = document.createElement("div");
      stack.className = "event-stack";
      const occurrences = getOccurrencesForDate(dateStr).sort(sortOccurrences);
      occurrences.forEach((occurrence) => {
        stack.appendChild(createMonthEventChip(occurrence));
      });
      if (occurrences.length > 0) {
        stack.appendChild(createMonthMoreChip(occurrences.length));
      }

      cell.append(top, stack);
      cell.addEventListener("click", () => openDayPanel(dateStr));
      nodes.push(cell);
    }

    els.monthGrid.replaceChildren(...nodes);
    trimMonthEventStacks();
  }

  function shouldShowWelcomeCard() {
    return state.events.length === 0 && !state.settings.welcomeDismissed;
  }

  function renderWelcomeCard() {
    els.welcomeCard.hidden = !shouldShowWelcomeCard();
  }

  function dismissWelcomeCard() {
    state.settings.welcomeDismissed = true;
    saveSettings();
    renderMonth();
  }

  function openHelpModal() {
    els.helpModal.hidden = false;
    els.helpContent.scrollTop = 0;
    window.setTimeout(() => {
      els.helpContent.scrollTop = 0;
      els.closeHelpModal.focus();
    }, 0);
  }

  function closeHelpModal() {
    els.helpModal.hidden = true;
  }

  function scrollModalBodyToTop(element) {
    if (element) {
      element.scrollTop = 0;
    }
  }

  function scheduleMonthResizeRender() {
    if (monthResizeTimer !== null) {
      window.clearTimeout(monthResizeTimer);
    }
    monthResizeTimer = window.setTimeout(() => {
      monthResizeTimer = null;
      if (state.view === "month") {
        renderMonth();
      }
    }, MONTH_RESIZE_DEBOUNCE_MS);
  }

  function trimMonthEventStacks() {
    if (!els.monthGrid) {
      return;
    }

    const measurements = Array.from(els.monthGrid.querySelectorAll(".event-stack"))
      .map(measureMonthEventStack)
      .filter(Boolean);

    measurements.forEach(applyMonthEventStackTrim);
  }

  function measureMonthEventStack(stack) {
    const chips = Array.from(stack.querySelectorAll(".event-chip"));
    const more = stack.querySelector(".more-chip");
    if (chips.length === 0 || !more) {
      return null;
    }

    const availableHeight = stack.getBoundingClientRect().height;
    const chipHeights = chips.map((chip) => chip.getBoundingClientRect().height);
    const moreHeight = more.getBoundingClientRect().height;
    const gap = measureMonthStackGap(stack, chips, more);
    const fittedVisibleCount = fitMonthVisibleEventCount(chipHeights, moreHeight, gap, availableHeight);
    const visibleCount = Math.min(fittedVisibleCount, monthEventChipLimit());

    return {
      chips,
      hiddenCount: chips.length - visibleCount,
      more,
      stack,
      visibleCount
    };
  }

  function measureMonthStackGap(stack, chips, more) {
    const items = [...chips, more];
    if (items.length >= 2) {
      const firstRect = items[0].getBoundingClientRect();
      const secondRect = items[1].getBoundingClientRect();
      const measuredGap = secondRect.top - firstRect.bottom;
      if (Number.isFinite(measuredGap) && measuredGap >= 0) {
        return measuredGap;
      }
    }

    const styles = window.getComputedStyle(stack);
    const gap = Number.parseFloat(styles.rowGap || styles.gap);
    return Number.isFinite(gap) ? gap : 0;
  }

  function fitMonthVisibleEventCount(chipHeights, moreHeight, gap, availableHeight) {
    if (chipHeights.length === 0) {
      return 0;
    }

    const available = Math.max(0, availableHeight);
    const allChipHeight = stackItemsHeight(chipHeights, chipHeights.length, gap);
    if (allChipHeight <= available + MONTH_FIT_EPSILON) {
      return chipHeights.length;
    }

    for (let visibleCount = chipHeights.length - 1; visibleCount >= 0; visibleCount -= 1) {
      const visibleChipsHeight = stackItemsHeight(chipHeights, visibleCount, gap);
      const heightWithMore = visibleChipsHeight + moreHeight + (visibleCount > 0 ? gap : 0);
      if (heightWithMore <= available + MONTH_FIT_EPSILON) {
        return visibleCount;
      }
    }

    return 0;
  }

  function monthEventChipLimit() {
    return isWideLayout() ? DESKTOP_MONTH_EVENT_CHIP_LIMIT : Number.POSITIVE_INFINITY;
  }

  function stackItemsHeight(itemHeights, count, gap) {
    if (count <= 0) {
      return 0;
    }
    return itemHeights.slice(0, count).reduce((sum, height) => sum + height, 0) + gap * (count - 1);
  }

  function applyMonthEventStackTrim(measurement) {
    const { chips, hiddenCount, more, stack, visibleCount } = measurement;

    chips.forEach((chip, index) => {
      if (index >= visibleCount) {
        chip.remove();
      }
    });

    if (hiddenCount > 0) {
      stack.classList.add("has-more");
      more.textContent = `他${hiddenCount}件`;
    } else {
      stack.classList.remove("has-more");
      more.remove();
    }
  }

  function renderWeek() {
    const start = state.currentWeekStart;
    const end = addDays(start, 6);
    els.weekHeading.textContent = formatWeekRange(start, end);
    renderWeekAllDay(start);
    renderWeekTimeline(start);
  }

  function renderWeekAllDay(start) {
    const nodes = [];
    const label = document.createElement("div");
    label.className = "all-day-label";
    label.textContent = "終日";
    nodes.push(label);

    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(start, offset);
      const dateStr = formatDate(date);
      const cell = document.createElement("div");
      cell.className = "all-day-cell";

      const dayLabel = document.createElement("div");
      dayLabel.className = "week-day-label";
      dayLabel.textContent = `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
      if (dateStr === formatDate(new Date())) {
        dayLabel.classList.add("is-today");
      }
      if (date.getDay() === 0) {
        dayLabel.classList.add("is-sunday");
      }
      if (date.getDay() === 6) {
        dayLabel.classList.add("is-saturday");
      }
      if (getHolidayName(dateStr)) {
        dayLabel.classList.add("is-holiday");
      }
      cell.appendChild(dayLabel);

      const eventList = document.createElement("div");
      eventList.className = "all-day-events";
      getOccurrencesForDate(dateStr)
        .filter((occurrence) => !occurrence.startTime)
        .sort(sortOccurrences)
        .forEach((occurrence) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "all-day-chip";
          applyCategoryColor(chip, occurrence.color);
          chip.textContent = normalizeTimeMode(occurrence.timeMode) === "allday"
            ? `終日 ${occurrence.title}`
            : occurrence.title;
          chip.addEventListener("click", () => openEventForm({
            eventId: occurrence.id,
            occurrenceDate: occurrence.occurrenceDate
          }));
          eventList.appendChild(chip);
        });
      cell.appendChild(eventList);
      nodes.push(cell);
    }

    els.weekAllDay.replaceChildren(...nodes);
  }

  function renderWeekTimeline(start) {
    const nodes = [];
    const axis = document.createElement("div");
    axis.className = "time-axis";
    const timelineHeight = `${(HOUR_END - HOUR_START) * HOUR_HEIGHT}px`;
    axis.style.height = timelineHeight;

    for (let hour = HOUR_START; hour < HOUR_END; hour += 1) {
      const label = document.createElement("span");
      label.className = "time-label";
      label.style.top = `${((hour - HOUR_START) / (HOUR_END - HOUR_START)) * 100}%`;
      label.textContent = `${String(hour).padStart(2, "0")}:00`;
      axis.appendChild(label);
    }
    nodes.push(axis);

    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(start, offset);
      const dateStr = formatDate(date);
      const column = document.createElement("div");
      column.className = "week-column";
      column.style.height = timelineHeight;
      const timed = getOccurrencesForDate(dateStr)
        .filter((occurrence) => occurrence.startTime)
        .sort(sortOccurrences)
        .map((occurrence) => {
          const placement = getEventPlacement(occurrence);
          if (!placement) {
            return null;
          }
          return { occurrence, placement };
        })
        .filter(Boolean);

      assignLanes(timed);
      timed.forEach(({ occurrence, placement }) => {
        const eventButton = document.createElement("button");
        eventButton.type = "button";
        eventButton.className = "timed-event";
        applyCategoryColor(eventButton, occurrence.color);
        eventButton.style.top = `${placement.top}px`;
        eventButton.style.height = `${placement.height}px`;
        if (placement.laneCount > 1) {
          eventButton.style.left = `calc(${(placement.lane / placement.laneCount) * 100}% + 3px)`;
          eventButton.style.width = `calc(${100 / placement.laneCount}% - 6px)`;
          eventButton.style.right = "auto";
        }

        const title = document.createElement("span");
        title.textContent = occurrence.title;
        const time = document.createElement("small");
        time.textContent = eventTimeLabel(occurrence);
        eventButton.append(title, time);
        eventButton.addEventListener("click", () => openEventForm({
          eventId: occurrence.id,
          occurrenceDate: occurrence.occurrenceDate
        }));
        column.appendChild(eventButton);
      });
      nodes.push(column);
    }

    els.weekTimeline.replaceChildren(...nodes);
  }

  function renderTodos() {
    const undoneCount = state.todos.filter((todo) => !todo.done).length;
    els.todoBadge.hidden = undoneCount === 0;
    els.todoBadge.textContent = String(undoneCount);
    els.todoCountText.textContent = undoneCount === 0 ? "未完了のタスクはありません" : `未完了 ${undoneCount}件`;

    if (state.todos.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "タスクはまだありません";
      els.todoList.replaceChildren(empty);
      return;
    }

    const sorted = [...state.todos].sort((a, b) => {
      if (a.done !== b.done) {
        return Number(a.done) - Number(b.done);
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    const nodes = sorted.map((todo) => {
      const row = document.createElement("div");
      row.className = "todo-row";
      row.classList.toggle("is-done", todo.done);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = todo.done;
      checkbox.setAttribute("aria-label", "完了");
      checkbox.addEventListener("change", () => {
        todo.done = checkbox.checked;
        todo.updatedAt = new Date().toISOString();
        saveTodos();
        renderTodos();
      });

      const title = document.createElement("div");
      title.className = "todo-title";
      title.textContent = todo.title;

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "tiny-delete";
      deleteButton.setAttribute("aria-label", "削除");
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => {
        addTombstone("todos", todo.id);
        state.todos = state.todos.filter((item) => item.id !== todo.id);
        saveTodos();
        renderTodos();
      });

      row.append(checkbox, title, deleteButton);
      return row;
    });

    els.todoList.replaceChildren(...nodes);
  }

  function renderSettings() {
    els.notificationToggle.checked = Boolean(state.settings.notifications);
    setReminderControlValue(els.defaultReminderSelect, els.defaultReminderCustom, state.settings.defaultReminder);
    setDefaultReminderDisabled(!state.settings.notifications);
    renderSyncSettings();
    renderCategorySettings();
  }

  function renderSyncSettings() {
    const configured = Boolean(state.syncState && state.syncState.id && state.syncState.key);
    const unavailable = state.syncServerStatus === "unavailable" || !isSyncTransportUsable();
    els.syncUnavailable.hidden = !unavailable;

    if (configured) {
      const lastSyncText = formatSyncLastSyncAt(state.syncState.lastSyncAt);
      els.syncStatusText.textContent = `同期中 ✓${lastSyncText ? `（最終同期 ${lastSyncText}）` : ""}`;
      els.syncDescription.textContent = "別の端末を追加すると、この端末の予定・ToDo・カテゴリと自動で統合されます。";
      els.startSyncButton.hidden = true;
      els.addSyncDeviceButton.hidden = false;
      els.disconnectSyncButton.hidden = false;
      els.addSyncDeviceButton.disabled = unavailable;
      els.disconnectSyncButton.disabled = false;
      return;
    }

    els.syncStatusText.textContent = "";
    els.syncDescription.textContent = "同期コードを作ると、ほかの端末と予定・ToDo・カテゴリを自動で同期できます";
    els.startSyncButton.hidden = false;
    els.addSyncDeviceButton.hidden = true;
    els.disconnectSyncButton.hidden = true;
    els.startSyncButton.disabled = unavailable || state.syncServerStatus === "unknown";
  }

  function formatSyncLastSyncAt(value) {
    if (!isValidIsoDate(value)) {
      return "";
    }
    const date = new Date(value);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function renderEventColorOptions() {
    const selectedKey = isKnownCategoryKey(els.eventColor.value) ? els.eventColor.value : firstCategoryKey();
    const buttons = getCategories().map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-option";
      button.dataset.categoryKey = category.key;
      button.classList.toggle("is-selected", category.key === selectedKey);

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      applyRawColor(swatch, category.color);

      const label = document.createElement("span");
      label.className = "color-option-label";
      label.textContent = category.label;

      button.append(swatch, label);
      return button;
    });

    els.colorOptions.replaceChildren(...buttons);
    setSelectedColor(selectedKey);
  }

  function renderCategorySettings(focusKey) {
    renderCategoryEditorList(els.categorySettingsList, els.addCategoryButton, focusKey);
  }

  function renderEventCategoryEditor(focusKey) {
    renderCategoryEditorList(els.eventCategorySettingsList, els.eventAddCategoryButton, focusKey);
  }

  function renderCategoryEditors(focusKey) {
    const focusEventEditor = focusKey && !els.eventCategoryEditorModal.hidden;
    renderCategoryEditorList(els.categorySettingsList, els.addCategoryButton, focusEventEditor ? null : focusKey);
    renderCategoryEditorList(els.eventCategorySettingsList, els.eventAddCategoryButton, focusEventEditor ? focusKey : null);
  }

  function renderCategoryEditorList(listElement, addButton, focusKey) {
    const categories = getCategories();
    const rows = categories.map((category) => {
      const row = document.createElement("div");
      row.className = "category-settings-row";
      row.dataset.categoryKey = category.key;

      const colorCell = document.createElement("div");
      colorCell.className = "category-color-cell";

      const colorButton = document.createElement("button");
      colorButton.type = "button";
      colorButton.className = "category-swatch-button";
      colorButton.dataset.categoryKey = category.key;
      colorButton.setAttribute("aria-label", `${category.label}の色を変更`);
      applyRawColor(colorButton, category.color);
      colorCell.appendChild(colorButton);

      if (state.categoryPaletteFor === category.key) {
        colorCell.appendChild(createCategoryPalette(category));
      }

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "category-name-input";
      nameInput.maxLength = CATEGORY_LABEL_MAX_LENGTH;
      nameInput.value = category.label;
      nameInput.dataset.categoryKey = category.key;
      nameInput.setAttribute("aria-label", "カテゴリ名");

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "category-delete-button";
      deleteButton.dataset.categoryKey = category.key;
      deleteButton.disabled = categories.length <= 1;
      deleteButton.setAttribute("aria-label", `${category.label}を削除`);
      deleteButton.textContent = "×";

      row.append(colorCell, nameInput, deleteButton);
      return row;
    });

    listElement.replaceChildren(...rows);
    addButton.disabled = categories.length >= CATEGORY_MAX_COUNT;

    if (focusKey) {
      window.setTimeout(() => {
        const input = listElement.querySelector(`.category-name-input[data-category-key="${cssEscape(focusKey)}"]`);
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    }
  }

  function createCategoryPalette(category) {
    const palette = document.createElement("div");
    palette.className = "category-palette";
    palette.setAttribute("role", "listbox");
    palette.setAttribute("aria-label", `${category.label}の色`);

    CATEGORY_PALETTE.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-color-button";
      button.dataset.categoryKey = category.key;
      button.dataset.color = color;
      button.classList.toggle("is-selected", category.color.toUpperCase() === color);
      button.setAttribute("aria-label", color);
      applyRawColor(button, color);
      palette.appendChild(button);
    });

    return palette;
  }

  function handleEventCategoryClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest(".color-option");
    if (!button || !els.colorOptions.contains(button)) {
      return;
    }
    setSelectedColor(button.dataset.categoryKey);
  }

  function handleEventTimeModeClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("[data-time-mode]");
    if (!button || !els.eventTimeModeGroup.contains(button)) {
      return;
    }
    const nextMode = normalizeTimeMode(button.dataset.timeMode);
    if (nextMode === readEventTimeMode()) {
      return;
    }
    setEventTimeMode(nextMode);
  }

  function handleEventReminderChange() {
    updateEventReminderAvailability();
    if (els.eventReminder.value === "custom") {
      setTimeout(() => els.eventReminderCustom.focus(), 0);
    }
  }

  function handleDefaultReminderChange() {
    updateReminderCustomVisibility(els.defaultReminderSelect, els.defaultReminderCustom);
    const value = readReminderControlValue(els.defaultReminderSelect, els.defaultReminderCustom);
    if (value === undefined) {
      setTimeout(() => els.defaultReminderCustom.focus(), 0);
      return;
    }
    state.settings.defaultReminder = value;
    saveSyncedSettings();
  }

  function handleDefaultReminderCustomInput() {
    if (els.defaultReminderSelect.value !== "custom") {
      return;
    }
    const value = readReminderControlValue(els.defaultReminderSelect, els.defaultReminderCustom);
    if (value === undefined) {
      return;
    }
    state.settings.defaultReminder = value;
    saveSyncedSettings();
  }

  function setDefaultReminderDisabled(disabled) {
    els.defaultReminderSelect.disabled = disabled;
    updateReminderCustomVisibility(els.defaultReminderSelect, els.defaultReminderCustom, disabled);
  }

  function setEventTimeMode(mode, options) {
    const nextMode = normalizeTimeMode(mode);
    const keepTimedValues = Boolean(options && options.keepTimedValues);
    els.eventTimeModeButtons.forEach((button) => {
      const selected = button.dataset.timeMode === nextMode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    const isTimed = nextMode === "timed";
    els.eventTimeFields.hidden = !isTimed;
    els.eventStart.disabled = !isTimed;
    els.eventEnd.disabled = !isTimed;
    if (isTimed) {
      if (!keepTimedValues) {
        els.eventStart.value = "";
        els.eventEnd.value = "";
      }
    } else if (nextMode === "allday") {
      els.eventStart.value = "";
      els.eventEnd.value = "";
    } else {
      const range = PERIOD_TIME_MODE_RANGES[nextMode];
      els.eventStart.value = range.startTime;
      els.eventEnd.value = range.endTime;
    }

    updateEventReminderAvailability();
  }

  function readEventTimeMode() {
    const selected = els.eventTimeModeButtons.find((button) => button.classList.contains("is-selected"));
    return normalizeTimeMode(selected ? selected.dataset.timeMode : "timed");
  }

  function normalizeTimeMode(value) {
    return VALID_TIME_MODES.has(value) ? value : "timed";
  }

  function normalizeTimeSlot(value) {
    return value === "allday" || value === "am" || value === "pm" ? value : null;
  }

  function timeModeFromPreset(preset) {
    if (!preset || typeof preset !== "object") {
      return "timed";
    }
    return normalizeTimeSlot(preset.timeSlot) || normalizeTimeMode(preset.timeMode);
  }

  function eventTimesForMode(timeMode, startTime, endTime) {
    const mode = normalizeTimeMode(timeMode);
    if (mode === "allday") {
      return { startTime: null, endTime: null };
    }
    if (mode === "am" || mode === "pm") {
      return { ...PERIOD_TIME_MODE_RANGES[mode] };
    }
    return {
      startTime,
      endTime
    };
  }

  function periodTimeModeLabel(timeMode) {
    return TIME_MODE_LABELS[normalizeTimeMode(timeMode)] || "";
  }

  function updateEventReminderAvailability() {
    const timeMode = readEventTimeMode();
    const hasStartTime = timeMode !== "allday" && (
      timeMode === "am" ||
      timeMode === "pm" ||
      isValidTimeString(els.eventStart.value)
    );
    els.eventReminder.disabled = !hasStartTime;
    els.eventReminderUnavailable.hidden = hasStartTime;
    if (!hasStartTime) {
      els.eventReminderUnavailable.textContent = timeMode === "allday"
        ? "終日予定は通知対象外です"
        : "時刻を設定すると通知できます";
      els.eventReminderCustom.hidden = true;
      els.eventReminderCustom.disabled = true;
      return;
    }
    updateReminderCustomVisibility(els.eventReminder, els.eventReminderCustom, !hasStartTime);
  }

  function setReminderControlValue(select, customInput, reminder) {
    const normalized = normalizeReminderValue(reminder, DEFAULT_REMINDER_MINUTES);
    if (normalized === null) {
      select.value = "none";
      customInput.value = "";
    } else if (REMINDER_PRESET_VALUES.includes(normalized)) {
      select.value = String(normalized);
      customInput.value = "";
    } else {
      select.value = "custom";
      customInput.value = String(normalized);
    }
    updateReminderCustomVisibility(select, customInput);
  }

  function updateReminderCustomVisibility(select, customInput, disabled) {
    const showCustom = select.value === "custom";
    customInput.hidden = !showCustom;
    customInput.disabled = Boolean(disabled) || !showCustom;
  }

  function readReminderControlValue(select, customInput) {
    if (select.value === "none") {
      return null;
    }
    if (select.value === "custom") {
      const customValue = parseIntegerInput(customInput.value);
      if (customValue === null || customValue < 1 || customValue > REMINDER_CUSTOM_MAX_MINUTES) {
        return undefined;
      }
      return customValue;
    }

    const presetValue = Number(select.value);
    if (REMINDER_PRESET_VALUES.includes(presetValue)) {
      return presetValue;
    }
    return undefined;
  }

  function parseIntegerInput(value) {
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  }

  function normalizeReminderValue(value, fallback) {
    if (value === null) {
      return null;
    }
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(number) && number >= 0 && number <= REMINDER_CUSTOM_MAX_MINUTES) {
      return number;
    }
    return fallback;
  }

  function categoryEditorListForTarget(target) {
    if (els.categorySettingsList.contains(target)) {
      return els.categorySettingsList;
    }
    if (els.eventCategorySettingsList.contains(target)) {
      return els.eventCategorySettingsList;
    }
    return null;
  }

  function handleCategorySettingsClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const listElement = categoryEditorListForTarget(target);
    if (!listElement) {
      return;
    }

    const paletteButton = target.closest(".palette-color-button");
    if (paletteButton && listElement.contains(paletteButton)) {
      const category = findCategory(paletteButton.dataset.categoryKey);
      const color = normalizeHexColor(paletteButton.dataset.color);
      if (category && color && category.color !== color) {
        category.color = color;
        saveSyncedSettings();
        renderCategoryDependents();
      }
      state.categoryPaletteFor = null;
      renderCategoryEditors();
      return;
    }

    const swatchButton = target.closest(".category-swatch-button");
    if (swatchButton && listElement.contains(swatchButton)) {
      const key = swatchButton.dataset.categoryKey;
      state.categoryPaletteFor = state.categoryPaletteFor === key ? null : key;
      renderCategoryEditors();
      return;
    }

    const deleteButton = target.closest(".category-delete-button");
    if (deleteButton && listElement.contains(deleteButton)) {
      deleteCategory(deleteButton.dataset.categoryKey);
    }
  }

  function handleCategoryNameFocus(event) {
    const input = categoryNameInputFromEvent(event);
    if (!input) {
      return;
    }
    const category = findCategory(input.dataset.categoryKey);
    input.dataset.previousLabel = category ? category.label : input.value;
  }

  function handleCategoryNameInput(event) {
    const input = categoryNameInputFromEvent(event);
    if (!input) {
      return;
    }
    const category = findCategory(input.dataset.categoryKey);
    if (!category) {
      return;
    }

    const nextLabel = normalizeCategoryLabel(input.value);
    if (!nextLabel) {
      return;
    }
    if (category.label === nextLabel) {
      return;
    }
    category.label = nextLabel;
    saveSyncedSettings();
    renderInactiveCategoryEditors(input);
    renderCategoryDependents();
  }

  function handleCategoryNameBlur(event) {
    const input = categoryNameInputFromEvent(event);
    if (!input) {
      return;
    }
    const category = findCategory(input.dataset.categoryKey);
    if (!category) {
      return;
    }

    const nextLabel = normalizeCategoryLabel(input.value);
    if (!nextLabel) {
      const previousLabel = normalizeCategoryLabel(input.dataset.previousLabel) || category.label;
      if (category.label !== previousLabel) {
        category.label = previousLabel;
        saveSyncedSettings();
        renderInactiveCategoryEditors(input);
        renderCategoryDependents();
      }
      input.value = previousLabel;
      return;
    }

    if (category.label !== nextLabel) {
      category.label = nextLabel;
      saveSyncedSettings();
      renderInactiveCategoryEditors(input);
      renderCategoryDependents();
    }
    input.value = category.label;
  }

  function categoryNameInputFromEvent(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("category-name-input")) {
      return null;
    }
    return target;
  }

  function renderInactiveCategoryEditors(activeInput) {
    if (!els.categorySettingsList.contains(activeInput)) {
      renderCategorySettings();
    }
    if (!els.eventCategoryEditorModal.hidden && !els.eventCategorySettingsList.contains(activeInput)) {
      renderEventCategoryEditor();
    }
  }

  function handleAddCategory() {
    const categories = getCategories();
    if (categories.length >= CATEGORY_MAX_COUNT) {
      return;
    }

    const category = {
      key: createCategoryKey(),
      label: "新しいカテゴリ",
      color: firstUnusedCategoryColor()
    };
    categories.push(category);
    state.categoryPaletteFor = null;
    saveSyncedSettings();
    renderCategoryEditors(category.key);
    renderCategoryDependents();
  }

  function deleteCategory(key) {
    const categories = getCategories();
    if (categories.length <= 1 || !isKnownCategoryKey(key)) {
      return;
    }

    const fallback = fallbackCategoryForDelete(key);
    if (!fallback) {
      return;
    }

    const affectedCount = state.events.filter((event) => event.color === key).length;
    if (affectedCount > 0) {
      const confirmed = window.confirm(`${affectedCount}件の予定は『${fallback.label}』に変更されます。削除しますか？`);
      if (!confirmed) {
        return;
      }
    }

    if (affectedCount > 0) {
      state.events.forEach((event) => {
        if (event.color === key) {
          event.color = fallback.key;
          event.updatedAt = new Date().toISOString();
        }
      });
      saveEvents();
    }

    state.settings.categories = categories.filter((category) => category.key !== key);
    state.categoryPaletteFor = null;
    if (els.eventColor.value === key) {
      els.eventColor.value = fallback.key;
    }
    saveSyncedSettings();
    renderCategoryEditors();
    renderCategoryDependents();
  }

  function handleDocumentClick(event) {
    if (!state.categoryPaletteFor) {
      return;
    }
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest(".category-settings-row")) {
      return;
    }
    state.categoryPaletteFor = null;
    renderCategoryEditors();
  }

  function renderCategoryDependents() {
    const selectedKey = els.eventColor.value;
    renderEventColorOptions();
    setSelectedColor(selectedKey);
    renderMonth();
    renderWeek();
    renderDayPanelIfVisible();
  }

  function openDayPanel(dateStr) {
    state.selectedDate = dateStr;
    syncDayPanelLayout();
    renderMonth();
    renderDayPanel();
    if (isWideLayout()) {
      els.dayPanelBackdrop.hidden = true;
      return;
    }
    els.dayPanelBackdrop.hidden = false;
  }

  function renderDayPanelIfVisible() {
    if (isWideLayout() || !els.dayPanelBackdrop.hidden) {
      renderDayPanel();
    }
  }

  function renderDayPanel() {
    const dateStr = state.selectedDate || formatDate(new Date());
    const holidayName = getHolidayName(dateStr);
    const events = getOccurrencesForDate(dateStr).sort(sortOccurrences);

    els.selectedDayTitle.textContent = formatLongDate(dateStr);
    els.selectedDayHoliday.textContent = holidayName || "";
    els.shareDayButton.disabled = events.length === 0;

    if (events.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "この日の予定はありません";
      els.selectedDayEvents.replaceChildren(empty);
      return;
    }

    const nodes = events.map((occurrence) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "day-event-row";

      const dot = document.createElement("span");
      dot.className = "event-dot";
      applyCategoryColor(dot, occurrence.color);

      const content = document.createElement("span");
      const title = document.createElement("span");
      title.className = "day-event-title";
      title.textContent = occurrence.title;
      const meta = document.createElement("span");
      meta.className = "day-event-meta";
      meta.textContent = dayEventMeta(occurrence);

      content.append(title, meta);
      button.append(dot, content);
      button.addEventListener("click", () => openEventForm({
        eventId: occurrence.id,
        occurrenceDate: occurrence.occurrenceDate
      }));
      return button;
    });

    els.selectedDayEvents.replaceChildren(...nodes);
  }

  function closeDayPanel() {
    els.dayPanelBackdrop.hidden = true;
  }

  function openEventForm(options) {
    const config = options || {};
    const existing = config.eventId ? state.events.find((event) => event.id === config.eventId) : null;
    if (config.eventId && !existing) {
      showToast("予定が見つかりませんでした", "error");
      return;
    }

    state.editing = existing ? {
      id: existing.id,
      occurrenceDate: config.occurrenceDate || existing.date
    } : null;

    els.eventForm.reset();
    els.formError.textContent = "";
    els.deleteEventButton.hidden = !existing;
    els.shareEventButton.hidden = !existing;
    els.eventModalTitle.textContent = existing ? "予定を編集" : "予定を追加";
    renderEventColorOptions();

    if (existing) {
      els.eventTitle.value = existing.title;
      els.eventDate.value = existing.date;
      els.eventStart.value = existing.startTime || "";
      els.eventEnd.value = existing.endTime || "";
      setEventTimeMode(existing.timeMode, { keepTimedValues: true });
      els.eventRecurrence.value = existing.recurrence ? existing.recurrence.freq : "none";
      setReminderControlValue(els.eventReminder, els.eventReminderCustom, existing.reminder);
      els.eventMemo.value = existing.memo || "";
      setSelectedColor(existing.color);
      els.eventModalHint.textContent = existing.recurrence
        ? `${formatLongDate(state.editing.occurrenceDate)}の繰り返し予定です。編集はすべての回に反映されます。`
        : "";
    } else {
      const preset = config.preset || {};
      const presetTimeMode = timeModeFromPreset(preset);
      els.eventTitle.value = preset.title || config.title || "";
      els.eventDate.value = isValidDateString(preset.date) ? preset.date : (config.date || "");
      els.eventStart.value = isValidTimeString(preset.startTime) ? preset.startTime : "";
      els.eventEnd.value = isValidTimeString(preset.endTime) ? preset.endTime : "";
      setEventTimeMode(presetTimeMode, { keepTimedValues: true });
      els.eventRecurrence.value = normalizePresetRecurrenceValue(preset.recurrence);
      setReminderControlValue(
        els.eventReminder,
        els.eventReminderCustom,
        Object.prototype.hasOwnProperty.call(preset, "reminder")
          ? preset.reminder
          : (presetTimeMode === "allday" ? null : state.settings.defaultReminder)
      );
      els.eventMemo.value = preset.memo || "";
      setSelectedColor(isKnownCategoryKey(preset.color) ? preset.color : firstCategoryKey());
      els.eventModalHint.textContent = config.hint || "";
    }

    updateEventReminderAvailability();
    els.eventModal.hidden = false;
    scrollModalBodyToTop(els.eventFormBody);
    setTimeout(() => els.eventTitle.focus(), 0);
  }

  function openEventCategoryEditor() {
    state.categoryPaletteFor = null;
    els.eventCategoryEditorModal.hidden = false;
    renderCategoryEditors();
    scrollModalBodyToTop(els.eventCategoryEditorBody);
    setTimeout(() => els.closeCategoryEditorButton.focus(), 0);
  }

  function closeEventCategoryEditor(options) {
    const restoreFocus = !options || options.restoreFocus !== false;
    const wasOpen = !els.eventCategoryEditorModal.hidden;
    els.eventCategoryEditorModal.hidden = true;
    state.categoryPaletteFor = null;
    renderCategoryEditors();
    renderEventColorOptions();
    setSelectedColor(els.eventColor.value);
    if (wasOpen && restoreFocus && !els.eventModal.hidden) {
      setTimeout(() => els.openCategoryEditorButton.focus(), 0);
    }
  }

  function closeEventModal() {
    closeEventCategoryEditor({ restoreFocus: false });
    els.eventModal.hidden = true;
    state.editing = null;
    els.formError.textContent = "";
  }

  function handleShareCurrentEvent() {
    if (!state.editing) {
      return;
    }
    const eventData = readEventForm();
    if (!eventData) {
      return;
    }
    shareEvents([eventData], `「${eventData.title}」の予定`);
  }

  function handleShareSelectedDay() {
    const dateStr = state.selectedDate || formatDate(new Date());
    const events = getOccurrencesForDate(dateStr).sort(sortOccurrences);
    if (events.length === 0) {
      return;
    }
    shareEvents(events, `「${sharedDateLabel(dateStr)}」の予定`);
  }

  async function shareEvents(events, text) {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }
    if (events.length > SHARE_MAX_EVENTS) {
      showToast("共有できる予定は30件までです", "error");
      return;
    }

    let url = "";
    try {
      url = createShareUrl(events);
    } catch (error) {
      showToast("共有リンクを作成できませんでした", "error");
      return;
    }

    if (navigator.share && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "予定の共有",
          text,
          url
        });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") {
          return;
        }
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(url);
        showToast("共有リンクをコピーしました");
        return;
      } catch (error) {
        // Fall through to the selectable link modal.
      }
    }

    openShareLinkModal(url);
  }

  function createShareUrl(events) {
    const payload = {
      v: SHARE_VERSION,
      e: events.map(createSharedEventRecord)
    };
    const encoded = utf8ToBase64Url(JSON.stringify(payload));
    // The schedule payload is stored in location.hash, so it is not sent to the server in the HTTP request.
    return `${pageBaseUrl()}${SHARE_HASH_PREFIX}${encoded}`;
  }

  function createSharedEventRecord(event) {
    const category = findCategory(event.color) || getCategories()[0];
    const record = {
      t: event.title,
      d: event.occurrenceDate || event.date,
      c: category ? category.key : firstCategoryKey(),
      cl: category ? category.label : "",
      co: category ? category.color : categoryColor(firstCategoryKey()),
      r: Object.prototype.hasOwnProperty.call(event, "reminder") ? event.reminder : null,
      tm: normalizeTimeMode(event.timeMode)
    };
    if (event.startTime) {
      record.s = event.startTime;
    }
    if (event.endTime) {
      record.en = event.endTime;
    }
    if (event.memo) {
      record.m = event.memo;
    }
    if (event.recurrence) {
      record.rc = cloneSharedRecurrence(event.recurrence);
    }
    return record;
  }

  function cloneSharedRecurrence(recurrence) {
    return JSON.parse(JSON.stringify(recurrence));
  }

  function openShareLinkModal(url) {
    els.shareLinkText.value = url;
    els.shareLinkModal.hidden = false;
    window.setTimeout(() => {
      els.shareLinkText.focus();
      els.shareLinkText.select();
    }, 0);
  }

  function closeShareLinkModal() {
    els.shareLinkModal.hidden = true;
    els.shareLinkText.value = "";
  }

  function handleIncomingShareHash() {
    if (!location.hash || !location.hash.startsWith(SHARE_HASH_PREFIX)) {
      return;
    }

    try {
      const records = parseSharedPayload(location.hash.slice(SHARE_HASH_PREFIX.length));
      state.pendingSharedEvents = records.map(createSharedImportEntry);
      renderSharedEventsModal();
      els.sharedEventsModal.hidden = false;
    } catch (error) {
      removeShareHash();
      showToast("リンクが正しくありません", "error");
    }
  }

  function parseSharedPayload(encoded) {
    if (
      typeof encoded !== "string" ||
      encoded.length === 0 ||
      encoded.length > SHARE_MAX_HASH_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(encoded) ||
      encoded.length % 4 === 1
    ) {
      throw new Error("invalid share hash");
    }

    const payload = JSON.parse(base64UrlToUtf8(encoded));
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.v !== SHARE_VERSION) {
      throw new Error("invalid share payload");
    }
    if (!Array.isArray(payload.e) || payload.e.length === 0 || payload.e.length > SHARE_MAX_EVENTS) {
      throw new Error("invalid shared event count");
    }
    return payload.e.map(validateSharedEventRecord);
  }

  function validateSharedEventRecord(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid shared event");
    }

    const title = readSharedString(item.t, SHARE_TITLE_MAX_LENGTH, true);
    const date = readSharedDate(item.d);
    const timeMode = item.tm === undefined ? "timed" : readSharedTimeMode(item.tm);
    const rawStartTime = readSharedOptionalTime(item.s);
    const rawEndTime = readSharedOptionalTime(item.en);
    if (rawEndTime && !rawStartTime) {
      throw new Error("invalid shared end time");
    }
    if (rawStartTime && rawEndTime && timeToMinutes(rawEndTime) <= timeToMinutes(rawStartTime)) {
      throw new Error("invalid shared time range");
    }
    if (timeMode === "allday" && (rawStartTime || rawEndTime)) {
      throw new Error("invalid all-day time range");
    }

    const timeRange = eventTimesForMode(timeMode, rawStartTime, rawEndTime);
    const startTime = timeRange.startTime;
    const endTime = timeRange.endTime;
    const reminder = readSharedReminder(item.r);

    return {
      title,
      date,
      timeMode,
      startTime,
      endTime,
      sourceCategoryKey: readSharedCategoryKey(item.c),
      sourceCategoryLabel: readSharedCategoryLabel(item.cl),
      sourceCategoryColor: readSharedCategoryColor(item.co),
      memo: item.m === undefined || item.m === null ? "" : readSharedString(item.m, SHARE_MEMO_MAX_LENGTH, false),
      reminder: startTime ? reminder : null,
      recurrence: item.rc === undefined || item.rc === null ? null : validateSharedRecurrence(item.rc)
    };
  }

  function readSharedString(value, maxLength, required) {
    if (typeof value !== "string") {
      throw new Error("invalid shared string");
    }
    const next = required ? value.trim() : value;
    if ((required && !next) || next.length > maxLength) {
      throw new Error("invalid shared string length");
    }
    return next;
  }

  function readSharedDate(value) {
    if (typeof value !== "string" || !isValidDateString(value)) {
      throw new Error("invalid shared date");
    }
    return value;
  }

  function readSharedTimeMode(value) {
    if (typeof value !== "string" || !VALID_TIME_MODES.has(value)) {
      throw new Error("invalid shared time mode");
    }
    return value;
  }

  function readSharedOptionalTime(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (!isValidTimeString(value)) {
      throw new Error("invalid shared time");
    }
    return value;
  }

  function readSharedReminder(value) {
    if (value === undefined || value === null) {
      return null;
    }
    if (!Number.isInteger(value) || value < 0 || value > REMINDER_CUSTOM_MAX_MINUTES) {
      throw new Error("invalid shared reminder");
    }
    return value;
  }

  function readSharedCategoryKey(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    if (typeof value !== "string" || !CATEGORY_KEY_PATTERN.test(value)) {
      throw new Error("invalid shared category key");
    }
    return value;
  }

  function readSharedCategoryLabel(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    if (typeof value !== "string") {
      throw new Error("invalid shared category label");
    }
    const label = value.trim();
    if (!label || label.length > SHARE_CATEGORY_LABEL_MAX_LENGTH) {
      throw new Error("invalid shared category label");
    }
    return label;
  }

  function readSharedCategoryColor(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    const color = normalizeHexColor(value);
    if (!color) {
      throw new Error("invalid shared category color");
    }
    return color;
  }

  function validateSharedRecurrence(recurrence) {
    if (!recurrence || typeof recurrence !== "object" || Array.isArray(recurrence) || !VALID_RECURRENCES.has(recurrence.freq)) {
      throw new Error("invalid shared recurrence");
    }
    if (recurrence.freq === "daily") {
      return { freq: "daily" };
    }
    if (recurrence.freq === "weekly") {
      if (!validWeekday(recurrence.weekday)) {
        throw new Error("invalid shared weekly recurrence");
      }
      return { freq: "weekly", weekday: recurrence.weekday };
    }
    if (!validMonthDay(recurrence.day)) {
      throw new Error("invalid shared monthly recurrence");
    }
    return { freq: "monthly", day: recurrence.day };
  }

  function createSharedImportEntry(shared) {
    const category = resolveSharedCategory(shared.sourceCategoryKey, shared.sourceCategoryLabel);
    const event = {
      title: shared.title,
      date: shared.date,
      timeMode: shared.timeMode,
      startTime: shared.startTime,
      endTime: shared.endTime,
      color: category.key,
      memo: shared.memo,
      reminder: shared.reminder,
      recurrence: shared.recurrence,
      exceptions: []
    };
    return {
      event,
      duplicate: hasDuplicateSharedEvent(event),
      displayColor: shared.sourceCategoryColor || category.color
    };
  }

  function resolveSharedCategory(key, label) {
    const categories = getCategories();
    const byKey = key ? findCategory(key) : null;
    if (byKey) {
      return byKey;
    }
    if (label) {
      const byLabel = categories.find((category) => category.label === label);
      if (byLabel) {
        return byLabel;
      }
    }
    return categories[0];
  }

  function hasDuplicateSharedEvent(event) {
    return getOccurrencesForDate(event.date).some((occurrence) => (
      occurrence.title === event.title &&
      (occurrence.startTime || null) === (event.startTime || null)
    ));
  }

  function renderSharedEventsModal() {
    const rows = state.pendingSharedEvents.map((entry, index) => {
      const row = document.createElement("label");
      row.className = "shared-event-row";
      row.classList.toggle("is-duplicate", entry.duplicate);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.index = String(index);
      checkbox.checked = !entry.duplicate;

      const dot = document.createElement("span");
      dot.className = "event-dot shared-event-dot";
      applyRawColor(dot, entry.displayColor || categoryColor(entry.event.color));

      const content = document.createElement("span");
      content.className = "shared-event-content";

      const title = document.createElement("span");
      title.className = "shared-event-title";
      title.textContent = sharedEventListLabel(entry.event);
      content.appendChild(title);

      const meta = document.createElement("span");
      meta.className = "shared-event-meta";
      meta.textContent = categoryLabel(entry.event.color);
      content.appendChild(meta);

      if (entry.duplicate) {
        const duplicate = document.createElement("span");
        duplicate.className = "shared-event-status";
        duplicate.textContent = "登録済み";
        content.appendChild(duplicate);
      }

      row.append(checkbox, dot, content);
      return row;
    });

    els.sharedEventsSummary.textContent = `${state.pendingSharedEvents.length}件の予定が共有されています`;
    els.sharedEventsList.replaceChildren(...rows);
    updateSharedEventsAddButton();
  }

  function sharedEventListLabel(event) {
    const dateLabel = sharedDateLabel(event.date);
    const timeLabel = event.startTime || periodTimeModeLabel(event.timeMode) || (event.timeMode === "allday" ? "終日" : "時刻なし");
    return `${dateLabel} ${timeLabel} ${event.title}`;
  }

  function sharedDateLabel(dateStr) {
    const date = parseDate(dateStr);
    if (!date) {
      return dateStr;
    }
    return `${date.getMonth() + 1}/${date.getDate()}(${SHARE_WEEKDAYS[date.getDay()]})`;
  }

  function updateSharedEventsAddButton() {
    const count = selectedSharedEventIndexes().length;
    els.addSharedEventsButton.textContent = `${count}件を追加`;
    els.addSharedEventsButton.disabled = count === 0;
  }

  function selectedSharedEventIndexes() {
    return Array.from(els.sharedEventsList.querySelectorAll("input[type=\"checkbox\"]"))
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => Number(checkbox.dataset.index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < state.pendingSharedEvents.length);
  }

  function addCheckedSharedEvents() {
    const indexes = selectedSharedEventIndexes();
    if (indexes.length === 0) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const additions = indexes.map((index) => ({
      id: createId("evt"),
      ...state.pendingSharedEvents[index].event,
      updatedAt,
      exceptions: []
    }));
    state.events.push(...additions);
    saveEvents();

    const firstDate = parseDate(additions[0].date);
    if (firstDate) {
      state.selectedDate = additions[0].date;
      state.currentMonth = startOfMonth(firstDate);
      state.currentWeekStart = startOfWeek(firstDate);
    }

    closeSharedEventsModal();
    removeShareHash();
    renderAll();
    showToast(`${additions.length}件を追加しました`);
  }

  function cancelSharedEvents() {
    closeSharedEventsModal();
    removeShareHash();
  }

  function closeSharedEventsModal() {
    els.sharedEventsModal.hidden = true;
    state.pendingSharedEvents = [];
    els.sharedEventsList.replaceChildren();
    els.sharedEventsSummary.textContent = "";
  }

  function removeShareHash() {
    if (!location.hash || !location.hash.startsWith(SHARE_HASH_PREFIX)) {
      return;
    }
    try {
      window.history.replaceState(null, "", pageBaseUrl());
    } catch (error) {
      location.hash = "";
    }
  }

  function pageBaseUrl() {
    if (location.origin && location.origin !== "null") {
      return `${location.origin}${location.pathname}`;
    }
    return location.href.split("#")[0].split("?")[0];
  }

  function utf8ToBase64Url(value) {
    const binary = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (match, hex) => (
      String.fromCharCode(Number.parseInt(hex, 16))
    ));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToUtf8(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const encoded = Array.from(binary, (character) => (
      `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`
    )).join("");
    return decodeURIComponent(encoded);
  }

  function handleEventSubmit(event) {
    event.preventDefault();
    const eventData = readEventForm();
    if (!eventData) {
      return;
    }

    const updatedAt = new Date().toISOString();
    if (state.editing) {
      const index = state.events.findIndex((item) => item.id === state.editing.id);
      if (index === -1) {
        showToast("予定が見つかりませんでした", "error");
        closeEventModal();
        return;
      }
      const previous = state.events[index];
      state.events[index] = {
        ...previous,
        ...eventData,
        updatedAt,
        exceptions: eventData.recurrence ? sanitizeExceptions(previous.exceptions) : []
      };
    } else {
      state.events.push({
        id: createId("evt"),
        ...eventData,
        updatedAt,
        exceptions: []
      });
    }

    saveEvents();
    closeEventModal();
    renderAll();
  }

  function readEventForm() {
    const title = els.eventTitle.value.trim();
    const date = els.eventDate.value;
    const timeMode = readEventTimeMode();
    const timeRange = eventTimesForMode(timeMode, els.eventStart.value || null, els.eventEnd.value || null);
    const startTime = timeRange.startTime;
    const endTime = timeRange.endTime;
    const color = isKnownCategoryKey(els.eventColor.value) ? els.eventColor.value : firstCategoryKey();
    const memo = els.eventMemo.value.trim();
    const recurrenceValue = els.eventRecurrence.value;

    if (!title) {
      setFormError("タイトルを入力してください");
      return null;
    }
    if (!isValidDateString(date)) {
      setFormError("日付を選択してください");
      return null;
    }
    if (startTime && !isValidTimeString(startTime)) {
      setFormError("開始時刻を確認してください");
      return null;
    }
    if (endTime && !isValidTimeString(endTime)) {
      setFormError("終了時刻を確認してください");
      return null;
    }
    if (!startTime && endTime) {
      setFormError("終了時刻だけを設定することはできません");
      return null;
    }
    if (startTime && endTime && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      setFormError("終了時刻は開始時刻より後にしてください");
      return null;
    }

    let reminder = null;
    if (startTime) {
      reminder = readReminderControlValue(els.eventReminder, els.eventReminderCustom);
      if (reminder === undefined) {
        setFormError("リマインドの分数は1〜10080で入力してください");
        return null;
      }
    }

    return {
      title,
      date,
      timeMode,
      startTime,
      endTime,
      color,
      memo,
      reminder,
      recurrence: buildRecurrence(recurrenceValue, date)
    };
  }

  function setFormError(message) {
    els.formError.textContent = message;
  }

  function setSelectedColor(color) {
    const nextColor = isKnownCategoryKey(color) ? color : firstCategoryKey();
    els.eventColor.value = nextColor;
    Array.from(els.colorOptions.querySelectorAll(".color-option")).forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.categoryKey === nextColor);
    });
  }

  function handleDeleteEvent() {
    if (!state.editing) {
      return;
    }
    const event = state.events.find((item) => item.id === state.editing.id);
    if (!event) {
      showToast("予定が見つかりませんでした", "error");
      closeEventModal();
      return;
    }

    if (event.recurrence) {
      showChoice({
        title: "繰り返し予定の削除",
        message: "この日だけ削除するか、すべての繰り返し予定を削除するか選んでください。",
        actions: [
          {
            label: "この日だけ削除",
            className: "secondary-button",
            onClick: () => deleteSingleOccurrence(event.id, state.editing.occurrenceDate)
          },
          {
            label: "すべて削除",
            className: "danger-outline-button",
            onClick: () => deleteWholeEvent(event.id)
          }
        ]
      });
      return;
    }

    if (window.confirm("この予定を削除しますか？")) {
      deleteWholeEvent(event.id);
    }
  }

  function deleteSingleOccurrence(eventId, dateStr) {
    const event = state.events.find((item) => item.id === eventId);
    if (!event) {
      return;
    }
    const exceptions = sanitizeExceptions(event.exceptions);
    if (!exceptions.includes(dateStr)) {
      exceptions.push(dateStr);
    }
    event.exceptions = exceptions;
    event.updatedAt = new Date().toISOString();
    saveEvents();
    closeChoiceModal();
    closeEventModal();
    renderAll();
  }

  function deleteWholeEvent(eventId) {
    addTombstone("events", eventId);
    state.events = state.events.filter((item) => item.id !== eventId);
    saveEvents();
    closeChoiceModal();
    closeEventModal();
    renderAll();
  }

  function handleChatSubmit(event) {
    event.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) {
      return;
    }

    let parsed = null;
    if (typeof window.parseScheduleText === "function") {
      try {
        parsed = window.parseScheduleText(text, new Date());
      } catch (error) {
        parsed = null;
      }
    }

    els.chatInput.value = "";

    if (isValidParsedSchedule(parsed)) {
      openEventForm({
        preset: {
          title: parsed.title,
          date: parsed.date,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          timeSlot: parsed.timeSlot,
          recurrence: parsed.recurrence
        },
        hint: "内容を確認して保存してください。"
      });
      return;
    }

    showToast("日時を読み取れませんでした", "error");
    openEventForm({
      preset: {
        title: text,
        date: "",
        startTime: null,
        endTime: null,
        timeSlot: null,
        recurrence: null
      },
      hint: "日時を読み取れませんでした。必要な項目を入力してください。"
    });
  }

  function setupVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof Recognition !== "function") {
      els.voiceButton.hidden = false;
      els.chatBar.classList.add("has-voice");
      els.voiceButton.addEventListener("click", () => {
        showToast("マイクを利用できませんでした", "error");
      });
      return;
    }

    els.voiceButton.hidden = false;
    els.chatBar.classList.add("has-voice");
    els.voiceButton.addEventListener("click", toggleVoiceInput);
  }

  function toggleVoiceInput() {
    if (state.voiceListening) {
      stopVoiceInput();
      return;
    }
    startVoiceInput();
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof Recognition !== "function") {
      els.voiceButton.hidden = true;
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;

    state.voiceRecognition = recognition;
    state.voiceListening = true;
    state.voiceStopping = false;
    state.voiceBaseText = els.chatInput.value.trim();
    state.voiceFinalText = "";
    setVoiceButtonState(true);

    recognition.onresult = handleVoiceResult;
    recognition.onerror = handleVoiceError;
    recognition.onend = finishVoiceInput;

    try {
      recognition.start();
    } catch (error) {
      finishVoiceInput();
      showToast("音声入力を開始できませんでした", "error");
    }
  }

  function stopVoiceInput() {
    if (!state.voiceRecognition) {
      finishVoiceInput();
      return;
    }
    state.voiceStopping = true;
    try {
      state.voiceRecognition.stop();
    } catch (error) {
      finishVoiceInput();
    }
  }

  function handleVoiceResult(event) {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result && result[0] ? result[0].transcript : "";
      if (result && result.isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    if (finalText) {
      state.voiceFinalText += finalText;
    }
    els.chatInput.value = joinVoiceText(state.voiceBaseText, state.voiceFinalText + interimText);
  }

  function handleVoiceError(event) {
    const code = event && event.error ? event.error : "";
    if (state.voiceStopping && code === "aborted") {
      return;
    }
    showToast(voiceErrorMessage(code), "error");
  }

  function finishVoiceInput() {
    state.voiceListening = false;
    state.voiceStopping = false;
    state.voiceRecognition = null;
    setVoiceButtonState(false);
    els.chatInput.focus();
  }

  function setVoiceButtonState(isListening) {
    els.voiceButton.classList.toggle("is-listening", isListening);
    els.voiceButton.setAttribute("aria-pressed", isListening ? "true" : "false");
  }

  function joinVoiceText(baseText, transcript) {
    const cleanedTranscript = transcript.trimStart();
    if (!baseText) {
      return cleanedTranscript;
    }
    if (!cleanedTranscript) {
      return baseText;
    }
    return `${baseText} ${cleanedTranscript}`;
  }

  function voiceErrorMessage(code) {
    if (code === "not-allowed" || code === "service-not-allowed") {
      return "マイクの使用が許可されませんでした";
    }
    if (code === "audio-capture") {
      return "マイクを利用できませんでした";
    }
    if (code === "no-speech") {
      return "音声を認識できませんでした";
    }
    if (code === "network") {
      return "音声認識に失敗しました";
    }
    return "音声入力でエラーが発生しました";
  }

  function openImportModal() {
    resetImportModal();
    updateOcrAvailability();
    els.importModal.hidden = false;
    scrollModalBodyToTop(els.importBody);
    setTimeout(() => els.importText.focus(), 0);
  }

  function closeImportModal() {
    els.importModal.hidden = true;
    resetImportProgress();
  }

  function resetImportModal() {
    state.importCandidates = [];
    clearImportImagePreview();
    els.importImageInput.value = "";
    els.importText.value = "";
    els.importCandidateSummary.textContent = "";
    els.importCandidateList.replaceChildren();
    updateImportRegisterButton();
    resetImportProgress();
  }

  function clearImportImagePreview() {
    if (state.importImageUrl) {
      URL.revokeObjectURL(state.importImageUrl);
      state.importImageUrl = null;
    }
    els.ocrThumbnail.hidden = true;
    els.ocrThumbnail.removeAttribute("src");
  }

  function updateOcrAvailability() {
    const available = hasAvailableOcr();
    els.ocrControls.hidden = !available;
    els.ocrUnavailableNotice.hidden = available;
  }

  function hasAvailableOcr() {
    const ocr = window.SchedulerOCR;
    if (!ocr || typeof ocr.available !== "function" || typeof ocr.recognize !== "function") {
      return false;
    }
    try {
      return Boolean(ocr.available());
    } catch (error) {
      return false;
    }
  }

  async function handleImportImageSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    if (!hasAvailableOcr()) {
      updateOcrAvailability();
      showToast("写真読み取りはローカルサーバー起動時に利用できます", "error");
      return;
    }

    showImportImagePreview(file);
    setImportProgress(0, "OCR準備");
    els.chooseImageButton.disabled = true;

    try {
      const result = await window.SchedulerOCR.recognize(file, setImportProgress);
      const text = result && typeof result.text === "string" ? result.text : "";
      appendImportText(text);
      setImportProgress(100, "文字認識完了");
      showToast("写真からテキストを読み取りました");
    } catch (error) {
      showToast(error && error.message ? error.message : "写真の文字認識に失敗しました", "error");
    } finally {
      els.chooseImageButton.disabled = false;
      els.importImageInput.value = "";
    }
  }

  function showImportImagePreview(file) {
    clearImportImagePreview();
    state.importImageUrl = URL.createObjectURL(file);
    els.ocrThumbnail.src = state.importImageUrl;
    els.ocrThumbnail.hidden = false;
  }

  function appendImportText(text) {
    const nextText = text.trim();
    if (!nextText) {
      return;
    }
    const currentText = els.importText.value.trimEnd();
    els.importText.value = currentText ? `${currentText}\n${nextText}` : nextText;
  }

  function resetImportProgress() {
    els.ocrProgress.hidden = true;
    els.ocrProgressPhase.textContent = "OCR準備";
    els.ocrProgressPercent.textContent = "0%";
    els.ocrProgressBar.style.width = "0%";
    els.chooseImageButton.disabled = false;
  }

  function setImportProgress(percent, phase) {
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    els.ocrProgress.hidden = false;
    els.ocrProgressPhase.textContent = phase || "処理中";
    els.ocrProgressPercent.textContent = `${safePercent}%`;
    els.ocrProgressBar.style.width = `${safePercent}%`;
  }

  function handleParseImport() {
    const lines = els.importText.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      state.importCandidates = [];
      renderImportCandidates();
      showToast("解析するテキストを入力してください", "error");
      return;
    }

    state.importCandidates = lines.map(parseImportLine);
    renderImportCandidates();
  }

  function parseImportLine(line, index) {
    let parsed = null;
    if (typeof window.parseScheduleText === "function") {
      try {
        parsed = window.parseScheduleText(line, new Date());
      } catch (error) {
        parsed = null;
      }
    }

    const valid = isValidParsedSchedule(parsed);
    return {
      id: `candidate-${index}`,
      line,
      parsed: valid ? parsed : null,
      selected: valid,
      valid
    };
  }

  function renderImportCandidates() {
    const nodes = state.importCandidates.map((candidate, index) => {
      const row = document.createElement("label");
      row.className = "import-candidate";
      row.classList.toggle("is-failed", !candidate.valid);

      if (candidate.valid) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = candidate.selected;
        checkbox.dataset.index = String(index);
        row.appendChild(checkbox);
      } else {
        const marker = document.createElement("span");
        marker.className = "candidate-marker";
        marker.setAttribute("aria-hidden", "true");
        row.appendChild(marker);
      }

      const content = document.createElement("span");
      content.className = "candidate-content";
      const title = document.createElement("span");
      title.className = "candidate-title";
      title.textContent = candidate.valid ? formatImportCandidate(candidate.parsed) : candidate.line;
      content.appendChild(title);

      if (!candidate.valid) {
        const note = document.createElement("span");
        note.className = "candidate-note";
        note.textContent = "日時を読み取れず";
        content.appendChild(note);
      }

      row.appendChild(content);
      return row;
    });

    els.importCandidateList.replaceChildren(...nodes);

    const successCount = state.importCandidates.filter((candidate) => candidate.valid).length;
    const failedCount = state.importCandidates.length - successCount;
    if (state.importCandidates.length === 0) {
      els.importCandidateSummary.textContent = "";
    } else {
      els.importCandidateSummary.textContent = `${successCount}件成功 / ${failedCount}件失敗`;
    }
    updateImportRegisterButton();
  }

  function handleImportCandidateToggle(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
      return;
    }
    const index = Number(target.dataset.index);
    const candidate = state.importCandidates[index];
    if (!candidate || !candidate.valid) {
      return;
    }
    candidate.selected = target.checked;
    updateImportRegisterButton();
  }

  function updateImportRegisterButton() {
    const selectedCount = selectedImportCandidates().length;
    els.registerImportButton.disabled = selectedCount === 0;
    els.registerImportButton.textContent = `選択した${selectedCount}件を登録`;
  }

  function selectedImportCandidates() {
    return state.importCandidates.filter((candidate) => candidate.valid && candidate.selected);
  }

  function handleRegisterImport() {
    const selected = selectedImportCandidates();
    if (selected.length === 0) {
      showToast("登録する予定を選択してください", "error");
      return;
    }

    selected.forEach((candidate) => {
      state.events.push(importCandidateToEvent(candidate));
    });
    saveEvents();
    closeImportModal();
    renderAll();
    showToast(`${selected.length}件登録しました`);
  }

  function importCandidateToEvent(candidate) {
    const parsed = candidate.parsed;
    const timeMode = timeModeFromPreset(parsed);
    const timeRange = eventTimesForMode(timeMode, parsed.startTime || null, parsed.endTime || null);
    const startTime = timeRange.startTime;
    return {
      id: createId("evt"),
      title: parsed.title.trim(),
      date: parsed.date,
      timeMode,
      startTime,
      endTime: timeMode === "timed" && !validImportEndTime(startTime, timeRange.endTime) ? null : timeRange.endTime,
      color: firstCategoryKey(),
      memo: "",
      reminder: timeMode !== "allday" && startTime ? state.settings.defaultReminder : null,
      recurrence: normalizeRecurrence(parsed.recurrence, parsed.date),
      updatedAt: new Date().toISOString(),
      exceptions: []
    };
  }

  function validImportEndTime(startTime, endTime) {
    return isValidTimeString(startTime) && isValidTimeString(endTime) && timeToMinutes(endTime) > timeToMinutes(startTime);
  }

  function formatImportCandidate(parsed) {
    const date = parseDate(parsed.date);
    const dateLabel = date ? `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})` : parsed.date;
    const timeSlotLabel = periodTimeModeLabel(normalizeTimeSlot(parsed.timeSlot));
    const timeLabel = timeSlotLabel || (parsed.startTime
      ? (parsed.endTime ? `${parsed.startTime}-${parsed.endTime}` : parsed.startTime)
      : "終日");
    const recurrence = parsed.recurrence ? ` / ${recurrenceLabel(parsed.recurrence.freq)}` : "";
    return `${dateLabel} ${timeLabel} ${parsed.title}${recurrence}`;
  }

  function handleTodoSubmit(event) {
    event.preventDefault();
    const title = els.todoInput.value.trim();
    if (!title) {
      return;
    }
    const now = new Date().toISOString();
    state.todos.push({
      id: createId("todo"),
      title,
      done: false,
      createdAt: now,
      updatedAt: now
    });
    els.todoInput.value = "";
    saveTodos();
    renderTodos();
  }

  async function handleNotificationToggle() {
    const shouldEnable = els.notificationToggle.checked;
    state.settings.notifications = shouldEnable;

    if (shouldEnable && "Notification" in window) {
      try {
        if (window.Notification.permission === "default") {
          await window.Notification.requestPermission();
        }
        if (window.Notification.permission === "denied") {
          showToast("ブラウザ通知が拒否されているため、アプリ内通知で表示します。");
        }
      } catch (error) {
        showToast("ブラウザ通知を使えないため、アプリ内通知で表示します。");
      }
    } else if (shouldEnable) {
      showToast("ブラウザ通知を使えないため、アプリ内通知で表示します。");
    }

    saveSettings();
    startNotificationTimer();
    renderSettings();
  }

  function handleClearData() {
    if (!window.confirm("保存済みの予定、ToDo、設定をすべて削除しますか？")) {
      return;
    }
    const deletedAt = new Date().toISOString();
    state.events.forEach((event) => addTombstone("events", event.id, deletedAt, { skipSave: true }));
    state.todos.forEach((todo) => addTombstone("todos", todo.id, deletedAt, { skipSave: true }));
    state.events = [];
    state.todos = [];
    state.settings = defaultSettings();
    state.settings.categoriesUpdatedAt = deletedAt;
    saveTombstones();
    saveEvents();
    saveTodos();
    saveSyncedSettings({ touchedAt: deletedAt });
    startNotificationTimer();
    closeDayPanel();
    closeEventModal();
    closeChoiceModal();
    renderAll();
    showToast("データを削除しました");
  }

  function setupSyncEngine() {
    if (!isSyncTransportUsable()) {
      state.syncServerStatus = "unavailable";
      renderSyncSettings();
      return;
    }

    probeSyncServerAvailability();
    if (state.syncState) {
      runSyncCycle({ reason: "startup" });
    }
    syncRuntime.intervalTimer = window.setInterval(() => {
      if (state.syncState) {
        runSyncCycle({ reason: "interval" });
      }
    }, SYNC_INTERVAL_MS);
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (state.syncState) {
      runSyncCycle({ reason: "visible" });
    } else if (state.syncServerStatus !== "available") {
      probeSyncServerAvailability();
    }
  }

  function isSyncTransportUsable() {
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      return false;
    }
    if (window.__schedulerAllowLocalSyncApi === true) {
      return true;
    }
    return location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1" &&
      location.hostname !== "::1";
  }

  async function probeSyncServerAvailability() {
    if (!isSyncTransportUsable()) {
      state.syncServerStatus = "unavailable";
      renderSyncSettings();
      return false;
    }

    try {
      const response = await fetch(`${SYNC_API_PATH}?id=__probe__&key=__probe__`, {
        cache: "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      state.syncServerStatus = response.status === 404 && payload && payload.error
        ? "available"
        : (response.ok ? "available" : "unavailable");
      if (response.status === 503 && payload && payload.error === "storage_not_configured") {
        state.syncServerStatus = "unavailable";
      }
    } catch (error) {
      state.syncServerStatus = "unavailable";
    }

    renderSyncSettings();
    return state.syncServerStatus === "available";
  }

  async function ensureSyncServerAvailable() {
    if (!isSyncTransportUsable()) {
      state.syncServerStatus = "unavailable";
      renderSyncSettings();
      return false;
    }
    if (state.syncServerStatus === "available") {
      return true;
    }
    return probeSyncServerAvailability();
  }

  async function handleStartSync() {
    if (!await ensureSyncServerAvailable()) {
      renderSyncSettings();
      return;
    }

    els.startSyncButton.disabled = true;
    try {
      const data = createLocalSyncData();
      if (syncDataByteLength(data) > SYNC_DATA_LIMIT_BYTES) {
        showToast("同期データが大きすぎます", "error");
        return;
      }
      const payload = await syncApiRequest("", {
        method: "POST",
        body: {
          action: "create",
          data
        }
      });
      if (!payload || !isValidSyncToken(payload.id) || !isValidSyncToken(payload.key) || payload.rev !== 1) {
        throw new Error("invalid sync create response");
      }
      state.syncState = {
        id: payload.id,
        key: payload.key,
        lastSyncAt: new Date().toISOString()
      };
      saveSyncState();
      state.syncServerStatus = "available";
      renderSyncSettings();
      showToast("同期を開始しました");
    } catch (error) {
      handleSyncUiError(error, "同期を開始できませんでした");
    } finally {
      renderSyncSettings();
    }
  }

  function openSyncLinkModal() {
    if (!state.syncState) {
      return;
    }
    state.syncLinkUrl = createSyncInviteUrl(state.syncState);
    els.syncLinkText.value = state.syncLinkUrl;
    els.shareSyncLinkButton.disabled = !(navigator.share && typeof navigator.share === "function");
    els.syncLinkModal.hidden = false;
    window.setTimeout(() => {
      els.syncLinkText.focus();
      els.syncLinkText.select();
    }, 0);
  }

  function closeSyncLinkModal() {
    els.syncLinkModal.hidden = true;
    els.syncLinkText.value = "";
    state.syncLinkUrl = "";
  }

  async function copySyncLink() {
    const url = state.syncLinkUrl || els.syncLinkText.value;
    if (!url) {
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(url);
        showToast("同期リンクをコピーしました");
        return;
      } catch (error) {
        // Fall through to selectable text.
      }
    }
    els.syncLinkText.focus();
    els.syncLinkText.select();
    showToast("リンクを選択しました");
  }

  async function shareSyncLink() {
    const url = state.syncLinkUrl || els.syncLinkText.value;
    if (!url || !(navigator.share && typeof navigator.share === "function")) {
      return;
    }
    try {
      await navigator.share({
        title: "schedulerの同期",
        text: "このリンクを開くと、この端末の予定・ToDo・カテゴリと同期できます。",
        url
      });
    } catch (error) {
      if (!error || error.name !== "AbortError") {
        showToast("共有を開始できませんでした", "error");
      }
    }
  }

  function createSyncInviteUrl(syncState) {
    return `${pageBaseUrl()}${SYNC_HASH_PREFIX}${syncState.id}.${syncState.key}`;
  }

  function handleDisconnectSync() {
    if (!state.syncState) {
      return;
    }
    if (!window.confirm("この端末を同期から切り離します。データはこの端末に残ります。")) {
      return;
    }
    state.syncState = null;
    saveSyncState();
    if (syncRuntime.debounceTimer) {
      window.clearTimeout(syncRuntime.debounceTimer);
      syncRuntime.debounceTimer = null;
    }
    renderSyncSettings();
    showToast("同期を解除しました");
  }

  function handleIncomingSyncHash() {
    if (!location.hash || !location.hash.startsWith(SYNC_HASH_PREFIX)) {
      return false;
    }
    const invite = parseSyncInviteHash(location.hash);
    if (!invite) {
      removeCurrentHash();
      showToast("同期リンクが正しくありません", "error");
      return true;
    }

    showChoice({
      title: "同期に参加",
      message: "この端末を同期に参加させますか？この端末の予定と統合されます",
      actions: [
        {
          label: "参加する",
          className: "primary-button",
          onClick: () => {
            closeChoiceModal();
            removeCurrentHash();
            joinSyncFromInvite(invite);
          }
        }
      ],
      onCancel: removeCurrentHash
    });
    return true;
  }

  function parseSyncInviteHash(hash) {
    const value = hash.slice(SYNC_HASH_PREFIX.length);
    const parts = value.split(".");
    if (parts.length !== 2 || !isValidSyncToken(parts[0]) || !isValidSyncToken(parts[1])) {
      return null;
    }
    return {
      id: parts[0],
      key: parts[1]
    };
  }

  async function joinSyncFromInvite(invite) {
    if (!await ensureSyncServerAvailable()) {
      showToast("同期サーバーが未設定のため利用できません", "error");
      renderSyncSettings();
      return;
    }

    try {
      await pullMergePush(invite, { forcePut: true, retryOnce: true });
      state.syncState = {
        id: invite.id,
        key: invite.key,
        lastSyncAt: new Date().toISOString()
      };
      saveSyncState();
      state.syncServerStatus = "available";
      renderAll();
      showToast("同期に参加しました");
    } catch (error) {
      handleSyncUiError(error, "同期に参加できませんでした");
    }
  }

  function scheduleSyncAfterLocalChange(options) {
    if (syncRuntime.suppressLocalChange || (options && options.skipSync)) {
      return;
    }
    if (!state.syncState) {
      return;
    }
    if (syncRuntime.debounceTimer) {
      window.clearTimeout(syncRuntime.debounceTimer);
    }
    syncRuntime.debounceTimer = window.setTimeout(() => {
      syncRuntime.debounceTimer = null;
      runSyncCycle({ reason: "debounce" });
    }, SYNC_DEBOUNCE_MS);
  }

  async function runSyncCycle(options) {
    if (!state.syncState || !isSyncTransportUsable()) {
      return;
    }
    if (syncRuntime.inFlight) {
      return;
    }

    syncRuntime.inFlight = true;
    try {
      await pullMergePush(state.syncState, {
        forcePut: Boolean(options && options.forcePut),
        retryOnce: true
      });
      state.syncState.lastSyncAt = new Date().toISOString();
      saveSyncState();
      state.syncServerStatus = "available";
    } catch (error) {
      handleSyncBackgroundError(error);
    } finally {
      syncRuntime.inFlight = false;
      renderSyncSettings();
    }
  }

  async function pullMergePush(credentials, options) {
    const remote = await getSyncRemoteData(credentials);
    try {
      await mergeRemoteAndMaybePut(credentials, remote, Boolean(options && options.forcePut));
      return;
    } catch (error) {
      if (!error || error.status !== 409 || !(options && options.retryOnce)) {
        throw error;
      }
    }

    const latest = await getSyncRemoteData(credentials);
    await mergeRemoteAndMaybePut(credentials, latest, true);
  }

  async function mergeRemoteAndMaybePut(credentials, remotePayload, forcePut) {
    const localData = createLocalSyncData();
    const remoteData = normalizeSyncData(remotePayload.data);
    const merged = mergeSyncData(localData, remoteData);
    if (!syncDataEqual(localData, merged)) {
      applySyncDataToState(merged);
    }
    if (!forcePut && syncDataEqual(remoteData, merged)) {
      return;
    }
    if (syncDataByteLength(merged) > SYNC_DATA_LIMIT_BYTES) {
      throw new Error("sync data too large");
    }
    await putSyncRemoteData(credentials, merged, remotePayload.rev);
  }

  async function getSyncRemoteData(credentials) {
    const payload = await syncApiRequest(`?id=${encodeURIComponent(credentials.id)}&key=${encodeURIComponent(credentials.key)}`, {
      method: "GET"
    });
    if (!payload || !Number.isInteger(payload.rev)) {
      throw new Error("invalid sync get response");
    }
    return {
      data: normalizeSyncData(payload.data),
      rev: payload.rev
    };
  }

  async function putSyncRemoteData(credentials, data, rev) {
    const payload = await syncApiRequest("", {
      method: "POST",
      body: {
        action: "put",
        id: credentials.id,
        key: credentials.key,
        data,
        rev
      }
    });
    if (!payload || !Number.isInteger(payload.rev)) {
      throw new Error("invalid sync put response");
    }
    return payload;
  }

  async function syncApiRequest(query, options) {
    const requestOptions = {
      method: options.method || "GET",
      cache: "no-store",
      headers: {}
    };
    if (Object.prototype.hasOwnProperty.call(options, "body")) {
      requestOptions.headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${SYNC_API_PATH}${query}`, requestOptions);
    const payload = await readSyncJsonResponse(response);
    if (!response.ok) {
      if (response.status === 503 && payload && payload.error === "storage_not_configured") {
        state.syncServerStatus = "unavailable";
        renderSyncSettings();
      }
      const error = new Error(payload && payload.error ? payload.error : `sync request failed: ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    state.syncServerStatus = "available";
    return payload;
  }

  async function readSyncJsonResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return null;
    }
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function handleSyncUiError(error, fallbackMessage) {
    if (isSyncUnavailableError(error)) {
      state.syncServerStatus = "unavailable";
      renderSyncSettings();
      showToast("同期サーバーが未設定のため利用できません", "error");
      return;
    }
    showToast(fallbackMessage, "error");
    console.warn("Sync failed:", error && error.message ? error.message : error);
  }

  function handleSyncBackgroundError(error) {
    if (isSyncUnavailableError(error)) {
      state.syncServerStatus = "unavailable";
    }
    console.warn("Sync failed:", error && error.message ? error.message : error);
  }

  function isSyncUnavailableError(error) {
    return !error ||
      error.name === "TypeError" ||
      error.status === 503 ||
      (error.payload && error.payload.error === "storage_not_configured");
  }

  function createLocalSyncData() {
    return normalizeSyncData({
      events: state.events,
      todos: state.todos,
      tombstones: state.tombstones,
      settings: {
        categories: state.settings.categories,
        defaultReminder: state.settings.defaultReminder,
        categoriesUpdatedAt: state.settings.categoriesUpdatedAt
      }
    });
  }

  function applySyncDataToState(data) {
    const normalized = normalizeSyncData(data);
    syncRuntime.suppressLocalChange = true;
    try {
      state.events = normalized.events;
      state.todos = normalized.todos;
      state.tombstones = normalized.tombstones;
      state.settings = {
        ...state.settings,
        defaultReminder: normalized.settings.defaultReminder,
        categories: normalized.settings.categories,
        categoriesUpdatedAt: normalized.settings.categoriesUpdatedAt
      };
      saveEvents();
      saveTodos();
      saveTombstones();
      saveSettings();
    } finally {
      syncRuntime.suppressLocalChange = false;
    }
    startNotificationTimer();
    renderAll();
  }

  function mergeSyncData(local, remote) {
    const localData = normalizeSyncData(local);
    const remoteData = normalizeSyncData(remote);
    const tombstones = mergeSyncTombstones(localData.tombstones, remoteData.tombstones);
    const settings = compareIsoDateStrings(localData.settings.categoriesUpdatedAt, remoteData.settings.categoriesUpdatedAt) >= 0
      ? localData.settings
      : remoteData.settings;

    return normalizeSyncData({
      events: mergeSyncRecords(localData.events, remoteData.events, tombstones.events),
      todos: mergeSyncRecords(localData.todos, remoteData.todos, tombstones.todos),
      tombstones,
      settings
    });
  }

  function mergeSyncRecords(localRecords, remoteRecords, tombstones) {
    const byId = new Map();
    localRecords.concat(remoteRecords).forEach((record) => {
      const previous = byId.get(record.id);
      if (!previous || compareIsoDateStrings(record.updatedAt, previous.updatedAt) > 0) {
        byId.set(record.id, record);
      }
    });

    const tombstoneById = new Map(tombstones.map((item) => [item.id, item]));
    return Array.from(byId.values())
      .filter((record) => {
        const tombstone = tombstoneById.get(record.id);
        return !tombstone || compareIsoDateStrings(tombstone.deletedAt, record.updatedAt) <= 0;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function mergeSyncTombstones(localTombstones, remoteTombstones) {
    return {
      events: mergeSyncTombstoneLists(localTombstones.events, remoteTombstones.events),
      todos: mergeSyncTombstoneLists(localTombstones.todos, remoteTombstones.todos)
    };
  }

  function mergeSyncTombstoneLists(localList, remoteList) {
    return normalizeTombstoneList(localList.concat(remoteList));
  }

  function normalizeSyncData(data) {
    const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    return {
      events: normalizeSyncEvents(source.events),
      todos: normalizeSyncTodos(source.todos),
      tombstones: pruneTombstones(source.tombstones),
      settings: normalizeSyncSettings(source.settings)
    };
  }

  function normalizeSyncEvents(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const byId = new Map();
    value.forEach((item) => {
      const event = normalizeEvent(item);
      if (!event) {
        return;
      }
      const previous = byId.get(event.id);
      if (!previous || compareIsoDateStrings(event.updatedAt, previous.updatedAt) >= 0) {
        byId.set(event.id, event);
      }
    });
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  function normalizeSyncTodos(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    const byId = new Map();
    value.forEach((item) => {
      const todo = normalizeTodo(item);
      if (!todo) {
        return;
      }
      const previous = byId.get(todo.id);
      if (!previous || compareIsoDateStrings(todo.updatedAt, previous.updatedAt) >= 0) {
        byId.set(todo.id, todo);
      }
    });
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  function normalizeSyncSettings(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      categories: normalizeCategories(source.categories),
      defaultReminder: normalizeReminderValue(
        Object.prototype.hasOwnProperty.call(source, "defaultReminder") ? source.defaultReminder : undefined,
        DEFAULT_REMINDER_MINUTES
      ),
      categoriesUpdatedAt: isValidIsoDate(source.categoriesUpdatedAt) ? source.categoriesUpdatedAt : SYNC_EPOCH
    };
  }

  function syncDataEqual(left, right) {
    return JSON.stringify(normalizeSyncData(left)) === JSON.stringify(normalizeSyncData(right));
  }

  function syncDataByteLength(data) {
    const json = JSON.stringify(data);
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(json).length;
    }
    return json.length;
  }

  function compareIsoDateStrings(left, right) {
    const a = isValidIsoDate(left) ? left : SYNC_EPOCH;
    const b = isValidIsoDate(right) ? right : SYNC_EPOCH;
    if (a === b) {
      return 0;
    }
    return a > b ? 1 : -1;
  }

  function isValidSyncToken(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
  }

  function removeCurrentHash() {
    try {
      window.history.replaceState(null, "", pageBaseUrl());
    } catch (error) {
      location.hash = "";
    }
  }

  function getOccurrencesForDate(dateStr) {
    return state.events
      .filter((event) => eventOccursOn(event, dateStr))
      .map((event) => ({
        ...event,
        occurrenceDate: dateStr,
        occurrenceKey: `${event.id}|${dateStr}`
      }));
  }

  function eventOccursOn(event, dateStr) {
    if (!isValidDateString(dateStr) || !isValidDateString(event.date)) {
      return false;
    }
    if (sanitizeExceptions(event.exceptions).includes(dateStr)) {
      return false;
    }
    if (!event.recurrence) {
      return event.date === dateStr;
    }
    if (compareDateStrings(dateStr, event.date) < 0) {
      return false;
    }

    const date = parseDate(dateStr);
    const start = parseDate(event.date);
    if (!date || !start) {
      return false;
    }

    if (event.recurrence.freq === "daily") {
      return true;
    }
    if (event.recurrence.freq === "weekly") {
      const weekday = validWeekday(event.recurrence.weekday) ? event.recurrence.weekday : start.getDay();
      return date.getDay() === weekday;
    }
    if (event.recurrence.freq === "monthly") {
      const day = validMonthDay(event.recurrence.day) ? event.recurrence.day : start.getDate();
      const clippedDay = Math.min(day, daysInMonth(date.getFullYear(), date.getMonth()));
      return date.getDate() === clippedDay;
    }
    return false;
  }

  function sortOccurrences(a, b) {
    const aTime = occurrenceSortMinute(a);
    const bTime = occurrenceSortMinute(b);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.title.localeCompare(b.title, "ja");
  }

  function occurrenceSortMinute(occurrence) {
    if (normalizeTimeMode(occurrence.timeMode) === "allday") {
      return -1;
    }
    return isValidTimeString(occurrence.startTime) ? timeToMinutes(occurrence.startTime) : 9999;
  }

  function eventChipText(occurrence) {
    const timeLabel = eventChipTimeLabel(occurrence);
    return timeLabel ? `${timeLabel} ${occurrence.title}` : occurrence.title;
  }

  function createMonthEventChip(occurrence) {
    const chip = document.createElement("div");
    chip.className = "event-chip";
    applyCategoryColor(chip, occurrence.color);

    const title = document.createElement("span");
    title.className = "event-chip-title";
    title.textContent = occurrence.title;
    chip.appendChild(title);

    const timeLabel = eventChipTimeLabel(occurrence);
    if (timeLabel) {
      chip.classList.add("has-time");
      const time = document.createElement("span");
      time.className = "event-chip-time";
      time.textContent = timeLabel;
      chip.appendChild(time);
    }

    return chip;
  }

  function createMonthMoreChip(count) {
    const more = document.createElement("div");
    more.className = "more-chip";
    more.textContent = `他${count}件`;
    return more;
  }

  function eventTimeLabel(occurrence) {
    const periodLabel = periodTimeModeLabel(occurrence.timeMode);
    if (periodLabel) {
      return periodLabel;
    }
    if (!occurrence.startTime) {
      return "時刻なし";
    }
    return occurrence.endTime ? `${occurrence.startTime}-${occurrence.endTime}` : occurrence.startTime;
  }

  function eventChipTimeLabel(occurrence) {
    const periodLabel = periodTimeModeLabel(occurrence.timeMode);
    if (periodLabel) {
      return periodLabel;
    }
    return occurrence.startTime || "";
  }

  function dayEventMeta(occurrence) {
    const category = categoryLabel(occurrence.color);
    const parts = [eventTimeLabel(occurrence), category];
    if (occurrence.recurrence) {
      parts.push(recurrenceLabel(occurrence.recurrence.freq));
    }
    return parts.join(" / ");
  }

  function getEventPlacement(occurrence) {
    if (!occurrence.startTime) {
      return null;
    }
    const start = timeToMinutes(occurrence.startTime);
    let end = occurrence.endTime ? timeToMinutes(occurrence.endTime) : start + 60;
    if (end <= start) {
      end = start + 60;
    }

    const windowStart = HOUR_START * 60;
    const windowEnd = HOUR_END * 60;
    if (end <= windowStart || start >= windowEnd) {
      return null;
    }

    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    const top = ((clippedStart - windowStart) / 60) * HOUR_HEIGHT;
    const rawHeight = ((clippedEnd - clippedStart) / 60) * HOUR_HEIGHT;
    const timelineHeight = ((windowEnd - windowStart) / 60) * HOUR_HEIGHT;
    return {
      start: clippedStart,
      end: clippedEnd,
      top,
      height: Math.min(Math.max(26, rawHeight), Math.max(1, timelineHeight - top)),
      lane: 0,
      laneCount: 1
    };
  }

  function assignLanes(items) {
    if (items.length <= 1) {
      return;
    }

    const sorted = [...items].sort((a, b) => a.placement.start - b.placement.start);
    let cluster = [];
    let clusterEnd = -1;

    sorted.forEach((item) => {
      if (cluster.length === 0 || item.placement.start < clusterEnd) {
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.placement.end);
      } else {
        assignClusterLanes(cluster);
        cluster = [item];
        clusterEnd = item.placement.end;
      }
    });

    assignClusterLanes(cluster);
  }

  function assignClusterLanes(cluster) {
    const laneEnds = [];
    cluster.forEach((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.placement.start);
      if (lane === -1) {
        lane = laneEnds.length;
      }
      laneEnds[lane] = item.placement.end;
      item.placement.lane = lane;
    });

    cluster.forEach((item) => {
      item.placement.laneCount = laneEnds.length || 1;
    });
  }

  function buildRecurrence(value, dateStr) {
    if (!VALID_RECURRENCES.has(value)) {
      return null;
    }
    const date = parseDate(dateStr);
    if (!date) {
      return null;
    }
    if (value === "weekly") {
      return { freq: "weekly", weekday: date.getDay() };
    }
    if (value === "monthly") {
      return { freq: "monthly", day: date.getDate() };
    }
    return { freq: "daily" };
  }

  function recurrenceLabel(freq) {
    if (freq === "daily") {
      return "毎日";
    }
    if (freq === "weekly") {
      return "毎週";
    }
    if (freq === "monthly") {
      return "毎月";
    }
    return "繰り返し";
  }

  function normalizePresetRecurrenceValue(recurrence) {
    if (recurrence && VALID_RECURRENCES.has(recurrence.freq)) {
      return recurrence.freq;
    }
    return "none";
  }

  function isValidParsedSchedule(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return false;
    }
    if (typeof parsed.title !== "string" || parsed.title.trim() === "") {
      return false;
    }
    if (!isValidDateString(parsed.date)) {
      return false;
    }
    if (parsed.timeSlot !== null && parsed.timeSlot !== undefined && !normalizeTimeSlot(parsed.timeSlot)) {
      return false;
    }
    if (parsed.startTime !== null && parsed.startTime !== undefined && !isValidTimeString(parsed.startTime)) {
      return false;
    }
    if (parsed.endTime !== null && parsed.endTime !== undefined && !isValidTimeString(parsed.endTime)) {
      return false;
    }
    if (parsed.recurrence !== null && parsed.recurrence !== undefined) {
      return Boolean(parsed.recurrence.freq && VALID_RECURRENCES.has(parsed.recurrence.freq));
    }
    return true;
  }

  function startNotificationTimer() {
    if (state.notificationTimer) {
      window.clearInterval(state.notificationTimer);
      state.notificationTimer = null;
    }
    if (!state.settings.notifications) {
      state.lastNotificationCheckAt = null;
      return;
    }
    checkNotifications();
    state.notificationTimer = window.setInterval(checkNotifications, 60000);
  }

  function checkNotifications() {
    if (!state.settings.notifications) {
      return;
    }

    const now = new Date();
    const previousCheckTime = state.lastNotificationCheckAt instanceof Date ? state.lastNotificationCheckAt : null;
    const todayStr = formatDate(now);
    const currentDateTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    pruneNotified(todayStr);

    const lookaheadDays = notificationLookaheadDays();
    for (let offset = 0; offset <= lookaheadDays; offset += 1) {
      const dateStr = formatDate(addDays(now, offset));
      getOccurrencesForDate(dateStr)
        .forEach((occurrence) => {
          const reminder = normalizeReminderValue(occurrence.reminder, DEFAULT_REMINDER_MINUTES);
          if (reminder === null || !occurrence.startTime) {
            return;
          }
          const startDateTime = occurrenceStartDateTime(occurrence);
          if (!startDateTime) {
            return;
          }
          const targetTime = new Date(startDateTime.getTime() - reminder * 60000);
          maybeNotify(occurrence, reminder, targetTime, previousCheckTime, currentDateTime);
        });
    }
    state.lastNotificationCheckAt = currentDateTime;
  }

  function notificationLookaheadDays() {
    const maxReminder = state.events.reduce((max, event) => {
      const reminder = normalizeReminderValue(event.reminder, null);
      return reminder === null ? max : Math.max(max, reminder);
    }, 0);
    return Math.max(2, Math.ceil(maxReminder / 1440));
  }

  function occurrenceStartDateTime(occurrence) {
    const date = parseDate(occurrence.occurrenceDate);
    if (!date || !isValidTimeString(occurrence.startTime)) {
      return null;
    }
    const startMinute = timeToMinutes(occurrence.startTime);
    date.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
    return date;
  }

  function maybeNotify(occurrence, reminder, targetTime, previousCheckTime, currentDateTime) {
    const key = `${occurrence.occurrenceDate}|${occurrence.id}|${reminder}`;
    if (state.settings.notified[key]) {
      return;
    }
    if (!shouldProcessNotificationTarget(targetTime, previousCheckTime, currentDateTime)) {
      return;
    }
    if (previousCheckTime && currentDateTime.getTime() - targetTime.getTime() > NOTIFICATION_CATCH_UP_LIMIT_MINUTES * 60000) {
      markNotificationDone(key);
      return;
    }

    const title = `${reminderLabel(reminder)}: ${occurrence.title}`;
    const body = `${formatLongDate(occurrence.occurrenceDate)} ${eventTimeLabel(occurrence)}`;
    sendNotification(title, body, key);
    markNotificationDone(key);
  }

  function reminderLabel(minutes) {
    if (minutes === 0) {
      return "定刻";
    }
    if (minutes % 1440 === 0) {
      const days = minutes / 1440;
      return days === 1 ? "1日前" : `${days}日前`;
    }
    if (minutes % 60 === 0) {
      return `${minutes / 60}時間前`;
    }
    return `${minutes}分前`;
  }

  function shouldProcessNotificationTarget(targetTime, previousCheckTime, currentDateTime) {
    if (!(targetTime instanceof Date) || Number.isNaN(targetTime.getTime())) {
      return false;
    }
    if (!previousCheckTime) {
      return targetTime.getTime() === currentDateTime.getTime();
    }
    return previousCheckTime.getTime() < targetTime.getTime() && targetTime.getTime() <= currentDateTime.getTime();
  }

  function markNotificationDone(key) {
    state.settings.notified[key] = new Date().toISOString();
    saveSettings();
  }

  function sendNotification(title, body, tag) {
    if ("Notification" in window && window.Notification.permission === "granted") {
      try {
        new window.Notification(title, { body, tag: `scheduler-${tag}` });
        return;
      } catch (error) {
        showNotificationBanner(title, body, tag);
        return;
      }
    }
    showNotificationBanner(title, body, tag);
  }

  function showNotificationBanner(title, body, tag) {
    const banner = document.createElement("div");
    banner.className = "notification-banner";
    banner.dataset.tag = tag || "";

    const content = document.createElement("div");
    content.className = "notification-banner-content";

    const titleNode = document.createElement("strong");
    titleNode.className = "notification-banner-title";
    titleNode.textContent = title;

    const bodyNode = document.createElement("span");
    bodyNode.className = "notification-banner-body";
    bodyNode.textContent = body;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "notification-banner-close";
    closeButton.setAttribute("aria-label", "Close notification");
    closeButton.textContent = "\u00d7";
    closeButton.addEventListener("click", () => {
      banner.remove();
    });

    content.append(titleNode, bodyNode);
    banner.append(content, closeButton);
    els.notificationBannerArea.appendChild(banner);
  }

  function pruneNotified(todayStr) {
    const today = parseDate(todayStr);
    if (!today || !state.settings.notified || typeof state.settings.notified !== "object") {
      state.settings.notified = {};
      return;
    }

    const keepAfter = formatDate(addDays(today, -2));
    let changed = false;
    Object.keys(state.settings.notified).forEach((key) => {
      const datePart = key.slice(0, 10);
      if (!isValidDateString(datePart) || datePart < keepAfter) {
        delete state.settings.notified[key];
        changed = true;
      }
    });
    if (changed) {
      saveSettings();
    }
  }

  function showChoice(config) {
    state.choiceCancelAction = typeof config.onCancel === "function" ? config.onCancel : null;
    els.choiceTitle.textContent = config.title;
    els.choiceMessage.textContent = config.message;
    const buttons = config.actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className || "secondary-button";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      return button;
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "キャンセル";
    cancel.addEventListener("click", () => closeChoiceModal({ runCancel: true }));
    buttons.push(cancel);

    els.choiceActions.replaceChildren(...buttons);
    els.choiceModal.hidden = false;
  }

  function closeChoiceModal(options) {
    const cancelAction = state.choiceCancelAction;
    state.choiceCancelAction = null;
    els.choiceModal.hidden = true;
    els.choiceActions.replaceChildren();
    if (options && options.runCancel && cancelAction) {
      cancelAction();
    }
  }

  function showToast(message, type) {
    const toast = document.createElement("div");
    toast.className = "toast";
    if (type === "error") {
      toast.classList.add("is-error");
    }
    toast.textContent = message;
    els.toastArea.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 4200);
  }

  function setupOptionalIcon() {
    const candidates = ["assets/icon.svg"];
    tryIconCandidate(candidates, 0);
  }

  function tryIconCandidate(candidates, index) {
    if (index >= candidates.length) {
      els.appIcon.hidden = true;
      els.iconFallback.hidden = false;
      return;
    }
    const probe = new Image();
    probe.onload = () => {
      const src = candidates[index];
      els.appIcon.src = src;
      els.appIcon.hidden = false;
      els.iconFallback.hidden = true;
      els.favicon.href = "assets/favicon.svg";
      if (src.endsWith(".svg")) {
        els.favicon.type = "image/svg+xml";
      }
    };
    probe.onerror = () => tryIconCandidate(candidates, index + 1);
    probe.src = candidates[index];
  }

  function migrateCategoriesIfNeeded() {
    let settingsChanged = false;
    let eventsChanged = false;
    const normalizedCategories = normalizeCategories(state.settings.categories);
    if (!sameCategories(state.settings.categories, normalizedCategories)) {
      state.settings.categories = normalizedCategories;
      settingsChanged = true;
    }

    if (!state.settings[CATEGORY_MIGRATION_FLAG]) {
      const usedKeys = new Set(state.events.map((event) => event.color));
      ["important", "other"].forEach((key) => {
        if (usedKeys.has(key) && !isKnownCategoryKey(key)) {
          state.settings.categories.push(cloneCategory(LEGACY_OPTIONAL_CATEGORIES[key]));
          settingsChanged = true;
        }
      });

      state.events.forEach((event) => {
        if (event.color === "health") {
          event.color = "exercise";
          event.updatedAt = new Date().toISOString();
          eventsChanged = true;
        }
      });

      state.settings[CATEGORY_MIGRATION_FLAG] = true;
      settingsChanged = true;
    }

    if (ensureEventsUseKnownCategories()) {
      eventsChanged = true;
    }

    if (settingsChanged) {
      saveSyncedSettings();
    }
    if (eventsChanged) {
      saveEvents();
    }
  }

  function ensureEventsUseKnownCategories() {
    let changed = false;
    const fallbackKey = firstCategoryKey();
    state.events.forEach((event) => {
      if (!isKnownCategoryKey(event.color)) {
        event.color = fallbackKey;
        event.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    return changed;
  }

  function getCategories() {
    if (!Array.isArray(state.settings.categories) || state.settings.categories.length === 0) {
      state.settings.categories = cloneDefaultCategories();
    }
    return state.settings.categories;
  }

  function normalizeCategories(value) {
    const source = Array.isArray(value) ? value : DEFAULT_CATEGORIES;
    const categories = [];
    const usedKeys = new Set();

    source.forEach((item) => {
      if (!item || typeof item !== "object") {
        return;
      }
      const key = typeof item.key === "string" ? item.key.trim() : "";
      if (!CATEGORY_KEY_PATTERN.test(key) || usedKeys.has(key)) {
        return;
      }
      const label = normalizeCategoryLabel(item.label) || "カテゴリ";
      const color = normalizeHexColor(item.color) || CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length];
      categories.push({ key, label, color });
      usedKeys.add(key);
    });

    if (categories.length === 0) {
      return cloneDefaultCategories();
    }
    return categories.slice(0, CATEGORY_MAX_COUNT);
  }

  function sameCategories(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((category, index) => {
      const next = right[index];
      return next && category.key === next.key && category.label === next.label && category.color === next.color;
    });
  }

  function cloneDefaultCategories() {
    return DEFAULT_CATEGORIES.map(cloneCategory);
  }

  function cloneCategory(category) {
    return {
      key: category.key,
      label: category.label,
      color: category.color
    };
  }

  function normalizeCategoryLabel(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim().slice(0, CATEGORY_LABEL_MAX_LENGTH);
  }

  function normalizeHexColor(value) {
    if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return "";
    }
    return value.toUpperCase();
  }

  function firstCategoryKey() {
    const category = getCategories()[0];
    return category ? category.key : "work";
  }

  function findCategory(key) {
    if (typeof key !== "string") {
      return null;
    }
    return getCategories().find((category) => category.key === key) || null;
  }

  function isKnownCategoryKey(key) {
    return Boolean(findCategory(key));
  }

  function categoryLabel(key) {
    const category = findCategory(key) || getCategories()[0];
    return category ? category.label : "";
  }

  function categoryColor(key) {
    const category = findCategory(key) || getCategories()[0];
    return category ? category.color : DEFAULT_CATEGORIES[0].color;
  }

  function applyCategoryColor(element, key) {
    const color = categoryColor(key);
    element.style.setProperty("--category-color", color);
    element.style.setProperty("--category-text", readableTextColor(color));
  }

  function applyRawColor(element, color) {
    const normalizedColor = normalizeHexColor(color) || DEFAULT_CATEGORIES[0].color;
    element.style.setProperty("--category-color", normalizedColor);
    element.style.setProperty("--category-text", readableTextColor(normalizedColor));
  }

  function readableTextColor(color) {
    const normalizedColor = normalizeHexColor(color);
    if (!normalizedColor) {
      return "#FFFFFF";
    }
    const red = Number.parseInt(normalizedColor.slice(1, 3), 16) / 255;
    const green = Number.parseInt(normalizedColor.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(normalizedColor.slice(5, 7), 16) / 255;
    const luminance =
      0.2126 * srgbToLinear(red) +
      0.7152 * srgbToLinear(green) +
      0.0722 * srgbToLinear(blue);
    return luminance > 0.58 ? "#111827" : "#FFFFFF";
  }

  function srgbToLinear(value) {
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }

  function firstUnusedCategoryColor() {
    const usedColors = new Set(getCategories().map((category) => category.color.toUpperCase()));
    return CATEGORY_PALETTE.find((color) => !usedColors.has(color)) || CATEGORY_PALETTE[0];
  }

  function createCategoryKey() {
    let key = "";
    do {
      key = `cat_${Math.random().toString(36).slice(2, 8)}`;
    } while (isKnownCategoryKey(key));
    return key;
  }

  function fallbackCategoryForDelete(key) {
    const categories = getCategories();
    if (categories.length <= 1) {
      return null;
    }
    if (categories[0].key !== key) {
      return categories[0];
    }
    return categories.find((category) => category.key !== key) || null;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\\]]/g, "\\$&");
  }

  function loadEvents() {
    const raw = safeReadJson(STORAGE_KEYS.events, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    let changed = false;
    const events = raw.map((item) => {
      if (!item || typeof item !== "object" || !Object.prototype.hasOwnProperty.call(item, "reminder")) {
        changed = true;
      }
      const event = normalizeEvent(item);
      if (event && item && typeof item === "object" && (
        item.timeMode !== event.timeMode ||
        item.startTime !== event.startTime ||
        item.endTime !== event.endTime ||
        item.reminder !== event.reminder ||
        item.updatedAt !== event.updatedAt
      )) {
        changed = true;
      }
      return event;
    }).filter((event) => {
      if (!event) {
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) {
      saveJson(STORAGE_KEYS.events, events);
    }
    return events;
  }

  function normalizeEvent(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const date = typeof item.date === "string" ? item.date : "";
    if (!title || !isValidDateString(date)) {
      return null;
    }

    const timeMode = normalizeTimeMode(item.timeMode);
    const rawStartTime = isValidTimeString(item.startTime) ? item.startTime : null;
    const rawEndTime = isValidTimeString(item.endTime) ? item.endTime : null;
    const timeRange = eventTimesForMode(timeMode, rawStartTime, rawEndTime);
    const startTime = timeRange.startTime;
    const endTime = startTime && timeRange.endTime && timeToMinutes(timeRange.endTime) > timeToMinutes(startTime)
      ? timeRange.endTime
      : null;
    const color = typeof item.color === "string" && item.color.trim() ? item.color.trim() : firstCategoryKey();
    const reminder = startTime
      ? normalizeReminderValue(
        Object.prototype.hasOwnProperty.call(item, "reminder") ? item.reminder : undefined,
        DEFAULT_REMINDER_MINUTES
      )
      : null;

    return {
      id: typeof item.id === "string" && item.id ? item.id : createId("evt"),
      title,
      date,
      timeMode,
      startTime,
      endTime,
      color,
      memo: typeof item.memo === "string" ? item.memo : "",
      reminder,
      recurrence: normalizeRecurrence(item.recurrence, date),
      updatedAt: isValidIsoDate(item.updatedAt) ? item.updatedAt : new Date().toISOString(),
      exceptions: sanitizeExceptions(item.exceptions)
    };
  }

  function normalizeRecurrence(recurrence, dateStr) {
    if (!recurrence || typeof recurrence !== "object" || !VALID_RECURRENCES.has(recurrence.freq)) {
      return null;
    }
    const date = parseDate(dateStr);
    if (!date) {
      return null;
    }
    if (recurrence.freq === "weekly") {
      return {
        freq: "weekly",
        weekday: validWeekday(recurrence.weekday) ? recurrence.weekday : date.getDay()
      };
    }
    if (recurrence.freq === "monthly") {
      return {
        freq: "monthly",
        day: validMonthDay(recurrence.day) ? recurrence.day : date.getDate()
      };
    }
    return { freq: "daily" };
  }

  function sanitizeExceptions(exceptions) {
    if (!Array.isArray(exceptions)) {
      return [];
    }
    return Array.from(new Set(exceptions.filter(isValidDateString))).sort();
  }

  function loadTodos() {
    const raw = safeReadJson(STORAGE_KEYS.todos, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    let changed = false;
    const todos = raw.map((item) => {
      const todo = normalizeTodo(item);
      if (todo && item && typeof item === "object" && item.updatedAt !== todo.updatedAt) {
        changed = true;
      }
      return todo;
    }).filter((todo) => {
      if (!todo) {
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) {
      saveJson(STORAGE_KEYS.todos, todos);
    }
    return todos;
  }

  function normalizeTodo(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) {
      return null;
    }
    return {
      id: typeof item.id === "string" && item.id ? item.id : createId("todo"),
      title,
      done: Boolean(item.done),
      createdAt: isValidIsoDate(item.createdAt) ? item.createdAt : new Date().toISOString(),
      updatedAt: isValidIsoDate(item.updatedAt) ? item.updatedAt : new Date().toISOString()
    };
  }

  function defaultSettings() {
    return {
      notifications: false,
      defaultReminder: DEFAULT_REMINDER_MINUTES,
      welcomeDismissed: false,
      notified: {},
      categories: cloneDefaultCategories(),
      categoriesUpdatedAt: new Date().toISOString(),
      [CATEGORY_MIGRATION_FLAG]: false
    };
  }

  function loadSettings() {
    const raw = safeReadJson(STORAGE_KEYS.settings, defaultSettings());
    const settings = defaultSettings();
    if (!raw || typeof raw !== "object") {
      return settings;
    }
    let changed = false;
    settings.notifications = Boolean(raw.notifications);
    settings.welcomeDismissed = Boolean(raw.welcomeDismissed);
    if (!Object.prototype.hasOwnProperty.call(raw, "defaultReminder")) {
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(raw, "welcomeDismissed")) {
      changed = true;
    }
    settings.defaultReminder = normalizeReminderValue(
      Object.prototype.hasOwnProperty.call(raw, "defaultReminder") ? raw.defaultReminder : undefined,
      DEFAULT_REMINDER_MINUTES
    );
    if (raw.defaultReminder !== settings.defaultReminder) {
      changed = true;
    }
    settings.categories = normalizeCategories(raw.categories);
    settings.categoriesUpdatedAt = isValidIsoDate(raw.categoriesUpdatedAt)
      ? raw.categoriesUpdatedAt
      : new Date().toISOString();
    if (raw.categoriesUpdatedAt !== settings.categoriesUpdatedAt) {
      changed = true;
    }
    settings[CATEGORY_MIGRATION_FLAG] = Boolean(raw[CATEGORY_MIGRATION_FLAG]);
    if (raw.notified && typeof raw.notified === "object" && !Array.isArray(raw.notified)) {
      Object.keys(raw.notified).forEach((key) => {
        if (typeof raw.notified[key] === "string") {
          settings.notified[key] = raw.notified[key];
        }
      });
    }
    if (changed) {
      saveJson(STORAGE_KEYS.settings, settings);
    }
    return settings;
  }

  function safeReadJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function loadTombstones() {
    return normalizeTombstones(safeReadJson(STORAGE_KEYS.tombstones, null));
  }

  function normalizeTombstones(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      events: normalizeTombstoneList(source.events),
      todos: normalizeTombstoneList(source.todos)
    };
  }

  function normalizeTombstoneList(value) {
    const byId = new Map();
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (!item || typeof item !== "object") {
          return;
        }
        const id = typeof item.id === "string" ? item.id : "";
        const deletedAt = isValidIsoDate(item.deletedAt) ? item.deletedAt : "";
        if (!id || !deletedAt) {
          return;
        }
        const previous = byId.get(id);
        if (!previous || deletedAt > previous.deletedAt) {
          byId.set(id, { id, deletedAt });
        }
      });
    }
    return Array.from(byId.values())
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
      .slice(0, SYNC_TOMBSTONE_MAX);
  }

  function addTombstone(kind, id, deletedAt, options) {
    if ((kind !== "events" && kind !== "todos") || typeof id !== "string" || !id) {
      return;
    }
    const timestamp = isValidIsoDate(deletedAt) ? deletedAt : new Date().toISOString();
    const list = Array.isArray(state.tombstones[kind]) ? state.tombstones[kind] : [];
    const existing = list.find((item) => item.id === id);
    if (existing) {
      if (timestamp > existing.deletedAt) {
        existing.deletedAt = timestamp;
      }
    } else {
      list.push({ id, deletedAt: timestamp });
    }
    state.tombstones[kind] = normalizeTombstoneList(list);
    if (!options || !options.skipSave) {
      saveTombstones();
    }
  }

  function pruneAndSaveTombstones(options) {
    const next = pruneTombstones(state.tombstones);
    if (!syncDataEqual({ tombstones: state.tombstones }, { tombstones: next })) {
      state.tombstones = next;
      saveTombstones(options);
    }
  }

  function pruneTombstones(tombstones) {
    const cutoff = new Date(Date.now() - SYNC_TOMBSTONE_MAX_AGE_MS).toISOString();
    const normalized = normalizeTombstones(tombstones);
    return {
      events: normalized.events.filter((item) => item.deletedAt >= cutoff).slice(0, SYNC_TOMBSTONE_MAX),
      todos: normalized.todos.filter((item) => item.deletedAt >= cutoff).slice(0, SYNC_TOMBSTONE_MAX)
    };
  }

  function saveTombstones(options) {
    state.tombstones = pruneTombstones(state.tombstones);
    saveJson(STORAGE_KEYS.tombstones, state.tombstones);
    scheduleSyncAfterLocalChange(options);
  }

  function loadSyncState() {
    const raw = safeReadJson(STORAGE_KEYS.sync, null);
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const id = typeof raw.id === "string" ? raw.id : "";
    const key = typeof raw.key === "string" ? raw.key : "";
    if (!isValidSyncToken(id) || !isValidSyncToken(key)) {
      return null;
    }
    return {
      id,
      key,
      lastSyncAt: isValidIsoDate(raw.lastSyncAt) ? raw.lastSyncAt : ""
    };
  }

  function saveSyncState() {
    if (!state.syncState) {
      try {
        window.localStorage.removeItem(STORAGE_KEYS.sync);
      } catch (error) {
        // Nothing else to do; sync can be reconfigured from this device.
      }
      return;
    }
    saveJson(STORAGE_KEYS.sync, state.syncState);
  }

  function saveEvents(options) {
    saveJson(STORAGE_KEYS.events, state.events);
    scheduleSyncAfterLocalChange(options);
  }

  function saveTodos(options) {
    saveJson(STORAGE_KEYS.todos, state.todos);
    scheduleSyncAfterLocalChange(options);
  }

  function saveSettings(options) {
    saveJson(STORAGE_KEYS.settings, state.settings);
    if (options && options.sync) {
      scheduleSyncAfterLocalChange(options);
    }
  }

  function saveSyncedSettings(options) {
    const touchedAt = options && isValidIsoDate(options.touchedAt) ? options.touchedAt : new Date().toISOString();
    state.settings.categoriesUpdatedAt = touchedAt;
    saveSettings({ sync: true });
  }

  function saveJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      showToast("データを保存できませんでした", "error");
    }
  }

  function getHolidayName(dateStr) {
    const holidays = window.JP_HOLIDAYS;
    if (!holidays || typeof holidays !== "object") {
      return "";
    }
    if (!Object.prototype.hasOwnProperty.call(holidays, dateStr)) {
      return "";
    }
    return String(holidays[dateStr] || "祝日");
  }

  function defaultDateForAdd() {
    const todayStr = formatDate(new Date());
    if (state.view === "month" && isValidDateString(state.selectedDate)) {
      return state.selectedDate;
    }
    if (state.view === "week") {
      const weekStartStr = formatDate(state.currentWeekStart);
      const weekEndStr = formatDate(addDays(state.currentWeekStart, 6));
      if (todayStr >= weekStartStr && todayStr <= weekEndStr) {
        return todayStr;
      }
      return weekStartStr;
    }
    return todayStr;
  }

  function formatWeekRange(start, end) {
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();
    if (startYear === endYear) {
      return `${startYear}年${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
    }
    return `${startYear}年${start.getMonth() + 1}/${start.getDate()} - ${endYear}年${end.getMonth() + 1}/${end.getDate()}`;
  }

  function formatLongDate(dateOrString) {
    const date = typeof dateOrString === "string" ? parseDate(dateOrString) : dateOrString;
    if (!date) {
      return "";
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${WEEKDAYS[date.getDay()]})`;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function startOfWeek(date) {
    const base = stripTime(date);
    base.setDate(base.getDate() - base.getDay());
    return base;
  }

  function addDays(date, days) {
    const next = stripTime(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDate(value) {
    if (typeof value !== "string") {
      return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    return formatDate(date) === value ? date : null;
  }

  function isValidDateString(value) {
    return Boolean(parseDate(value));
  }

  function isValidIsoDate(value) {
    return typeof value === "string" && value.trim() === value && !Number.isNaN(Date.parse(value));
  }

  function isValidTimeString(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function timeToMinutes(value) {
    if (!isValidTimeString(value)) {
      return 0;
    }
    const parts = value.split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function compareDateStrings(a, b) {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function validWeekday(value) {
    return Number.isInteger(value) && value >= 0 && value <= 6;
  }

  function validMonthDay(value) {
    return Number.isInteger(value) && value >= 1 && value <= 31;
  }

  window.__syncSelfTest = function __syncSelfTest() {
    const base = Date.now();
    const t1 = new Date(base - 3000).toISOString();
    const t2 = new Date(base - 2000).toISOString();
    const t3 = new Date(base - 1000).toISOString();
    const eventA1 = testEvent("evt_a", "older", t1);
    const eventA2 = testEvent("evt_a", "newer", t2);
    const todoA1 = testTodo("todo_a", "local todo", false, t1);
    const todoA2 = testTodo("todo_a", "remote todo", true, t2);
    const categoriesA = [{ key: "work", label: "仕事", color: "#3B82F6" }];
    const categoriesB = [{ key: "home", label: "家", color: "#22C55E" }];
    const tests = [
      {
        name: "local newer event wins",
        run: () => mergeSyncData({ events: [eventA2] }, { events: [eventA1] }).events[0].title === "newer"
      },
      {
        name: "remote newer event wins",
        run: () => mergeSyncData({ events: [eventA1] }, { events: [eventA2] }).events[0].title === "newer"
      },
      {
        name: "equal event timestamp keeps local",
        run: () => mergeSyncData({ events: [eventA1] }, { events: [testEvent("evt_a", "same remote", t1)] }).events[0].title === "older"
      },
      {
        name: "newer event tombstone deletes",
        run: () => mergeSyncData({ events: [eventA1] }, { tombstones: { events: [{ id: "evt_a", deletedAt: t2 }] } }).events.length === 0
      },
      {
        name: "event newer than tombstone survives",
        run: () => mergeSyncData({ events: [eventA2] }, { tombstones: { events: [{ id: "evt_a", deletedAt: t1 }] } }).events.length === 1
      },
      {
        name: "remote newer todo wins",
        run: () => mergeSyncData({ todos: [todoA1] }, { todos: [todoA2] }).todos[0].done === true
      },
      {
        name: "newer todo tombstone deletes",
        run: () => mergeSyncData({ todos: [todoA1] }, { tombstones: { todos: [{ id: "todo_a", deletedAt: t2 }] } }).todos.length === 0
      },
      {
        name: "tombstones merge latest by id",
        run: () => mergeSyncData(
          { tombstones: { events: [{ id: "evt_a", deletedAt: t1 }] } },
          { tombstones: { events: [{ id: "evt_a", deletedAt: t2 }, { id: "evt_b", deletedAt: t1 }] } }
        ).tombstones.events.length === 2
      },
      {
        name: "remote newer settings set wins",
        run: () => mergeSyncData(
          { settings: { categories: categoriesA, defaultReminder: 10, categoriesUpdatedAt: t1 } },
          { settings: { categories: categoriesB, defaultReminder: 30, categoriesUpdatedAt: t2 } }
        ).settings.categories[0].key === "home"
      },
      {
        name: "local newer settings set wins",
        run: () => mergeSyncData(
          { settings: { categories: categoriesA, defaultReminder: 10, categoriesUpdatedAt: t3 } },
          { settings: { categories: categoriesB, defaultReminder: 30, categoriesUpdatedAt: t2 } }
        ).settings.defaultReminder === 10
      },
      {
        name: "empty data normalizes",
        run: () => {
          const merged = mergeSyncData({}, {});
          return Array.isArray(merged.events) && Array.isArray(merged.todos) && merged.settings.categories.length > 0;
        }
      },
      {
        name: "independent local and remote records both remain",
        run: () => mergeSyncData({ events: [eventA1] }, { events: [testEvent("evt_b", "remote b", t2)] }).events.length === 2
      }
    ];

    const results = tests.map((test) => {
      try {
        return { name: test.name, pass: Boolean(test.run()) };
      } catch (error) {
        return { name: test.name, pass: false, error: error && error.message ? error.message : String(error) };
      }
    });
    const passCount = results.filter((result) => result.pass).length;
    console.table(results);
    console.log(`__syncSelfTest: ${passCount}/${results.length} PASS`);
    return results.every((result) => result.pass);
  };

  function testEvent(id, title, updatedAt) {
    return {
      id,
      title,
      date: "2026-01-01",
      timeMode: "timed",
      startTime: "09:00",
      endTime: null,
      color: "work",
      memo: "",
      reminder: 10,
      recurrence: null,
      updatedAt,
      exceptions: []
    };
  }

  function testTodo(id, title, done, updatedAt) {
    return {
      id,
      title,
      done,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt
    };
  }

  function createId(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
