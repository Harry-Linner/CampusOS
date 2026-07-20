import { describe, expect, it, vi } from "vitest";
import {
  createZjuCalendarConfigConnector,
  parseOfficialCalendarPage
} from "@campusos/plugin-zju-calendar-config/main";

const sourceUrl = "https://www.zju.edu.cn/english/19600/list.htm";
const page = `
  <div class="title">Autumn Quarter 2026</div>
  <div class="content"><table><tbody>
    <tr><th>September 11 – November 15</th></tr>
    <tr><td>September 14</td><td>Classes begin</td></tr>
  </tbody></table></div>
  <div class="zju-section__quarter-header">Autumn Quarter 2026</div>
  <div class="title">Winter Quarter 2026</div>
  <div class="content"><table><tbody>
    <tr><th>November 9, 2026 – January 15, 2027</th></tr>
    <tr><td>November 9</td><td>Classes begin</td></tr>
  </tbody></table></div>
  <div class="zju-section__quarter-header">Winter Quarter 2026</div>
  <div class="title">Spring Quarter 2026</div>
  <div class="content"><table><tbody>
    <tr><th>February 27 – April 26</th></tr>
    <tr><td>March&nbsp;2</td><td>Classes begin</td></tr>
  </tbody></table></div>
  <div class="zju-section__quarter-header">Spring Quarter 2026</div>
  <div class="title">Summer Quarter 2026</div>
  <div class="content"><table><tbody>
    <tr><th>damaged range</th></tr>
    <tr><td>April 27</td><td>Classes begin</td></tr>
  </tbody></table></div>
`;

describe("zju official calendar connector", () => {
  it("parses valid quarter boundaries and isolates a malformed quarter", () => {
    const data = parseOfficialCalendarPage(page, sourceUrl);

    expect(data.timezone).toBe("Asia/Shanghai");
    expect(data.periodTimes).toHaveLength(14);
    expect(data.periodTimes[0]).toEqual({ period: 1, start: "08:00", end: "08:45" });
    expect(data.quarters).toEqual([
      {
        academicYearStart: 2025,
        season: "2|春",
        startDate: "2026-02-27",
        classesBeginDate: "2026-03-02",
        endDate: "2026-04-26"
      },
      {
        academicYearStart: 2026,
        season: "1|秋",
        startDate: "2026-09-11",
        classesBeginDate: "2026-09-14",
        endDate: "2026-11-15"
      },
      {
        academicYearStart: 2026,
        season: "1|冬",
        startDate: "2026-11-09",
        classesBeginDate: "2026-11-09",
        endDate: "2027-01-15"
      }
    ]);
  });

  it("publishes cache instead of inventing dates when the official page fails", async () => {
    const cached = parseOfficialCalendarPage(page, sourceUrl);
    const publish = vi.fn(async () => undefined);
    const connector = createZjuCalendarConfigConnector({
      fetchCalendarPage: async () => {
        throw new Error("temporary failure");
      },
      loadCachedCalendar: async () => cached,
      publish,
      registerRefreshJob: () => () => undefined,
      now: () => new Date("2026-07-19T04:00:00.000Z")
    });

    await connector.activate({
      pluginId: connector.manifest.id,
      grantedPermissions: connector.manifest.permissions,
      bindings: {}
    });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "academic.calendar-config@1",
        state: "cache",
        data: cached
      })
    );
  });
});
