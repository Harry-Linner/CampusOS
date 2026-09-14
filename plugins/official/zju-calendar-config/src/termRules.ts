import type { AcademicCalendarTermRules } from "@campusos/shared";

/**
 * 内置的官方校历排课规则（不排课区间 + 调课）。
 *
 * 来源：学校官方校历原件，逐条文字化见 `docs/references/zju-academic-calendar.md`。
 * 首次发布先内置已核对的学年；新学年由校历解析结果随更新推送写入本表，
 * 未收录的学年按「无节假日与调休信息」处理（不猜测、不伪造）。
 *
 * 约定：
 * - `closedRanges` 含首尾，命中即当日不排课；
 * - `movedDays` 表示把 `fromDate` 的课改到 `toDate` 上（官方校历的「对调 / 补课」），
 *   `fromDate` 当日不排课，`toDate` 当日只按被调日的课表排课。
 */
export const ZJU_ACADEMIC_TERM_RULES: AcademicCalendarTermRules[] = [
  {
    academicYearStart: 2026,
    closedRanges: [
      { startDate: "2026-09-25", endDate: "2026-09-27", label: "中秋节放假" },
      { startDate: "2026-10-01", endDate: "2026-10-07", label: "国庆节放假" },
      { startDate: "2026-10-24", endDate: "2026-10-25", label: "秋季校运动会" },
      { startDate: "2026-11-07", endDate: "2026-11-08", label: "秋学期考试" },
      { startDate: "2026-11-14", endDate: "2026-11-15", label: "秋学期考试" },
      { startDate: "2026-12-31", endDate: "2026-12-31", label: "浙江大学学生节" },
      { startDate: "2027-01-01", endDate: "2027-01-01", label: "元旦放假" },
      { startDate: "2027-01-06", endDate: "2027-01-15", label: "全校停课考试" },
      { startDate: "2027-03-27", endDate: "2027-03-28", label: "春季校运动会" },
      { startDate: "2027-04-05", endDate: "2027-04-05", label: "清明节放假" },
      { startDate: "2027-04-17", endDate: "2027-04-18", label: "春学期考试" },
      { startDate: "2027-04-24", endDate: "2027-04-25", label: "春学期考试" },
      { startDate: "2027-05-01", endDate: "2027-05-02", label: "劳动节放假" },
      { startDate: "2027-06-09", endDate: "2027-06-09", label: "端午节放假" },
      { startDate: "2027-06-15", endDate: "2027-06-26", label: "全校停课考试" }
    ],
    movedDays: [
      // 国庆节放假调休：10-06、10-07 的课分别与 09-20、10-10 对调，10-17 补 10-02 的课。
      { fromDate: "2026-10-06", toDate: "2026-09-20" },
      { fromDate: "2026-10-07", toDate: "2026-10-10" },
      { fromDate: "2026-10-02", toDate: "2026-10-17" },
      // 学生节：2027-01-04 补 2026-12-31 的课。
      { fromDate: "2026-12-31", toDate: "2027-01-04" }
    ]
  },
  {
    academicYearStart: 2025,
    closedRanges: [
      { startDate: "2025-10-01", endDate: "2025-10-08", label: "国庆节、中秋节放假" },
      { startDate: "2025-10-24", endDate: "2025-10-26", label: "秋季校运动会" },
      { startDate: "2025-11-08", endDate: "2025-11-09", label: "秋学期考试" },
      { startDate: "2025-11-15", endDate: "2025-11-16", label: "秋学期考试" },
      { startDate: "2025-12-31", endDate: "2025-12-31", label: "浙江大学学生节" },
      { startDate: "2026-01-01", endDate: "2026-01-01", label: "元旦放假" },
      { startDate: "2026-01-07", endDate: "2026-01-16", label: "全校停课考试" },
      { startDate: "2026-04-05", endDate: "2026-04-05", label: "清明节放假" },
      { startDate: "2026-04-18", endDate: "2026-04-19", label: "春季校运动会" },
      { startDate: "2026-04-25", endDate: "2026-04-26", label: "春学期考试" },
      { startDate: "2026-05-01", endDate: "2026-05-02", label: "劳动节放假" },
      { startDate: "2026-05-09", endDate: "2026-05-10", label: "春学期考试" },
      { startDate: "2026-06-19", endDate: "2026-06-19", label: "端午节放假" },
      { startDate: "2026-06-25", endDate: "2026-07-04", label: "全校停课考试" }
    ],
    movedDays: [
      // 国庆节、中秋节放假调休：10-07、10-08 的课分别与 09-28、10-11 对调，10-18 补 10-24 的课。
      { fromDate: "2025-10-07", toDate: "2025-09-28" },
      { fromDate: "2025-10-08", toDate: "2025-10-11" },
      { fromDate: "2025-10-24", toDate: "2025-10-18" },
      // 学生节：2026-01-05 补 2025-12-31 的课。
      { fromDate: "2025-12-31", toDate: "2026-01-05" }
    ]
  }
];
