/** Read-only month calendar with today + events, viewable by everyone.
 *  Events show their names directly in the grid (multi-day events render as a
 *  connected band); clicking a day opens an in-window detail panel with the
 *  day's events and notes. GMs can edit, delete or add events/notes from there. */

import { MODULE_ID, SETTINGS } from "../const.js";
import { TimeEngine } from "../engine.js";
import { getActiveCalendarConfig } from "../calendar/calendar.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CalendarView extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!this.instance) this.instance = new this();
    const c = game.time.components;
    this.instance._viewYear ??= c.year;
    this.instance._viewMonth ??= c.month;
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-calendar",
    classes: ["glct", "glct-calendar"],
    tag: "div",
    window: { title: "GLCT.calendarView.title", icon: "fa-solid fa-calendar-days", resizable: false },
    position: { width: 480, height: "auto" },
    actions: {
      prevMonth: CalendarView.prototype._onPrev,
      nextMonth: CalendarView.prototype._onNext,
      today: CalendarView.prototype._onToday,
      manageEvents: CalendarView.prototype._onManageEvents,
      selectDay: CalendarView.prototype._onSelectDay,
      selectMonthEvent: CalendarView.prototype._onSelectMonthEvent,
      closeDetail: CalendarView.prototype._onCloseDetail,
      editEvent: CalendarView.prototype._onEditEvent,
      deleteEvent: CalendarView.prototype._onDeleteEvent,
      addEventForDay: CalendarView.prototype._onAddForDay
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/calendar-view.hbs` }
  };

  _viewYear = null;
  _viewMonth = null;
  _selectedDay = null;
  _selectedEventId = null;

  _months() { return game.time.calendar?.months?.values ?? []; }

  /**
   * Per-weekday rest-day flags, indexed to line up with TimeEngine.weekdayOf().
   * Foundry's live CalendarData drops the custom `isRestDay` flag (the same way
   * it drops `intercalary`, see TimeEngine.weekdayOf), so the live calendar
   * alone never marks a weekend. The raw active config — preset or editor JSON —
   * always preserves it, so we read from there and fall back to the live data.
   */
  _restDays() {
    const live = game.time.calendar?.days?.values ?? [];
    const cfg = getActiveCalendarConfig()?.days?.values ?? [];
    const n = Math.max(live.length, cfg.length);
    return Array.from({ length: n }, (_, i) => !!(cfg[i]?.isRestDay ?? live[i]?.isRestDay));
  }

  _visibleEvents() {
    return (game.settings.get(MODULE_ID, SETTINGS.events) ?? [])
      .filter(e => game.user.isGM || e.visibleToPlayers);
  }

  _describe(e) {
    const months = this._months();
    const mn = i => months[i]?.name ?? `M${(i ?? 0) + 1}`;
    switch (e.scope) {
      case "month": return game.i18n.format?.("GLCT.calendarView.allOf", { month: mn(e.month) }) ?? `All of ${mn(e.month)}`;
      case "range": return `${mn(e.month)} ${e.day} – ${mn(e.endMonth)} ${e.endDay}`;
      default: return `${mn(e.month)} ${e.day}`;
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user?.isGM ?? false;
    const cal = game.time.calendar;
    const weekdays = cal?.days?.values ?? [];
    const months = cal?.months?.values ?? [];
    const wdCount = Math.max(1, weekdays.length);
    const restDays = this._restDays();

    const year = this._viewYear, monthIdx = this._viewMonth;
    const month = months[monthIdx] ?? months[0];
    const isLeap = cal?.isLeapYear?.(year) ?? false;
    const dayCount = (isLeap && month?.leapDays) ? month.leapDays : (month?.days ?? 30);

    // Weekday (0-based) of the first day of the viewed month, computed so that
    // intercalary days don't drift the cycle (see TimeEngine.weekdayOf).
    const firstWeekday = TimeEngine.weekdayOf(year, monthIdx, 0);

    const now = game.time.components;
    const isCurrentMonth = now.year === year && now.month === monthIdx;
    const todayNum = (now.dayOfMonth ?? 0) + 1;

    const events = this._visibleEvents();
    const onDay = (e, d) => d >= 1 && d <= dayCount && TimeEngine.matchesToday(e, monthIdx, d);

    // Whole-month events show as badges above the grid rather than a band
    // dragged across every cell (which reads as too busy).
    const monthBadges = events
      .filter(e => e.scope === "month" && e.month === monthIdx)
      .map(e => ({
        id: e.id,
        name: e.name,
        hasNote: !!(e.notePublic || (isGM && e.notePrivate)),
        gmOnly: isGM && !e.visibleToPlayers
      }));

    // Day-range events get a fixed "lane" so their bands line up vertically
    // from cell to cell; single-day events fill in beneath. This keeps a
    // multi-day range reading as one continuous bar.
    const spanning = events.filter(e =>
      e.scope === "range" &&
      Array.from({ length: dayCount }, (_, i) => i + 1).some(d => onDay(e, d))
    );

    const band = (e, d, column) => {
      const continuesLeft = (d > 1)
        ? onDay(e, d - 1)
        : (e.scope === "range" && monthIdx > (e.month ?? 0));
      const continuesRight = (d < dayCount)
        ? onDay(e, d + 1)
        : (e.scope === "range" && monthIdx < (e.endMonth ?? 0));
      return {
        id: e.id,
        name: e.name,
        continuesLeft,
        continuesRight,
        // Re-label the band at the start of each week row for readability.
        showLabel: !continuesLeft || column === 0,
        hasNote: !!(e.notePublic || (isGM && e.notePrivate))
      };
    };

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ inMonth: false });
    for (let d = 1; d <= dayCount; d++) {
      const wd = TimeEngine.weekdayOf(year, monthIdx, d - 1);
      const column = (firstWeekday + d - 1) % wdCount;

      // Lane row for each spanning event (empty spacer when it isn't today),
      // with trailing empties trimmed so cells don't grow needlessly.
      const lanes = spanning.map(e => onDay(e, d) ? band(e, d, column) : { empty: true });
      while (lanes.length && lanes[lanes.length - 1].empty) lanes.pop();

      const singles = events
        .filter(e => e.scope !== "range" && e.scope !== "month" && onDay(e, d))
        .map(e => band(e, d, column));

      cells.push({
        inMonth: true,
        day: d,
        isToday: isCurrentMonth && d === todayNum,
        isWeekend: restDays[wd],
        isSelected: this._selectedDay === d,
        events: [...lanes, ...singles]
      });
    }
    while (cells.length % wdCount !== 0) cells.push({ inMonth: false });

    return Object.assign(context, {
      isGM,
      monthName: month?.name ?? "",
      year,
      yearLabel: game.settings.get(MODULE_ID, SETTINGS.yearLabel) || "",
      weekdayNames: weekdays.map((w, i) => ({ label: w.abbreviation ?? w.name, rest: restDays[i] })),
      wdCount,
      monthBadges,
      cells,
      detail: this._buildDetail(year, monthIdx, isGM)
    });
  }

  /** Build the detail-panel context for the selected day or month-event. */
  _buildDetail(year, monthIdx, isGM) {
    const toView = e => ({
      id: e.id,
      name: e.name,
      when: this._describe(e),
      notePublic: e.notePublic || "",
      notePrivate: isGM ? (e.notePrivate || "") : "",
      visibleToPlayers: !!e.visibleToPlayers
    });

    // A whole-month badge was clicked: show just that event.
    if (this._selectedEventId) {
      const e = this._visibleEvents().find(x => x.id === this._selectedEventId);
      if (!e) return null;
      return {
        isGM,
        heading: e.name,
        sub: this._describe(e),
        isWeekend: false,
        events: [toView(e)]
      };
    }

    const d = this._selectedDay;
    if (!d) return null;
    const months = this._months();
    const month = months[monthIdx];
    const cal = game.time.calendar;
    const weekdays = cal?.days?.values ?? [];
    const wd = TimeEngine.weekdayOf(year, monthIdx, d - 1);
    const weekday = weekdays[wd];
    const isWeekend = this._restDays()[wd];

    const dayEvents = this._visibleEvents()
      .filter(e => TimeEngine.matchesToday(e, monthIdx, d))
      .map(toView);

    return {
      isGM,
      day: d,
      canAdd: isGM,
      heading: `${month?.name ?? ""} ${d}`,
      sub: weekday?.name ?? "",
      isWeekend,
      events: dayEvents
    };
  }

  async _onManageEvents() {
    const { EventsEditor } = await import("./events-editor.js");
    EventsEditor.show();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const grid = this.element.querySelector(".cal-grid");
    // minmax(0,1fr) lets columns shrink below their content; without it a long
    // event name forces a column wider than its share and the grid overflows the
    // fixed-width window off the screen.
    if (grid) grid.style.gridTemplateColumns = `repeat(${context.wdCount}, minmax(0, 1fr))`;
  }

  /* ----------------------------- day detail ----------------------------- */

  async _onSelectDay(ev, target) {
    const d = Number(target?.dataset?.day);
    if (!d) return;
    this._selectedEventId = null;
    this._selectedDay = (this._selectedDay === d) ? null : d;
    this.render();
  }

  async _onSelectMonthEvent(ev, target) {
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    if (!id) return;
    this._selectedDay = null;
    this._selectedEventId = (this._selectedEventId === id) ? null : id;
    this.render();
  }

  async _onCloseDetail() {
    this._selectedDay = null;
    this._selectedEventId = null;
    this.render();
  }

  async _onEditEvent(ev, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    const { EventsEditor } = await import("./events-editor.js");
    if (await EventsEditor.editEvent(id)) this.render();
  }

  async _onDeleteEvent(ev, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    const { EventsEditor } = await import("./events-editor.js");
    if (await EventsEditor.deleteEvent(id)) this.render();
  }

  async _onAddForDay() {
    if (!game.user.isGM || !this._selectedDay) return;
    const { EventsEditor } = await import("./events-editor.js");
    const d = this._selectedDay, m = this._viewMonth;
    const created = await EventsEditor.createEvent({
      scope: "day", month: m, day: d, endMonth: m, endDay: d
    });
    if (created) this.render();
  }

  async _onPrev() {
    const n = this._months().length;
    this._selectedDay = null; this._selectedEventId = null;
    this._viewMonth--;
    if (this._viewMonth < 0) { this._viewMonth = n - 1; this._viewYear--; }
    this.render();
  }
  async _onNext() {
    const n = this._months().length;
    this._selectedDay = null; this._selectedEventId = null;
    this._viewMonth++;
    if (this._viewMonth >= n) { this._viewMonth = 0; this._viewYear++; }
    this.render();
  }
  async _onToday() {
    const c = game.time.components;
    this._selectedDay = null; this._selectedEventId = null;
    this._viewYear = c.year; this._viewMonth = c.month;
    this.render();
  }
}
