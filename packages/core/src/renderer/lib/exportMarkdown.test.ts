import { describe, expect, it } from "vitest";
import { renderExportMarkdown } from "./exportMarkdown";

describe("renderExportMarkdown（导出序列化，纯函数）", () => {
  it("渲染标题、导出时间与表格", () => {
    const markdown = renderExportMarkdown({
      title: "本周课表",
      generatedAt: "2026-08-24T08:00:00.000Z",
      sections: [
        {
          heading: "课程",
          rows: [
            ["时间", "课程", "地点"],
            ["周一 08:00", "高等数学", "西 1-101"],
            ["周二 10:00", "大学英语", "东 2-305"]
          ]
        }
      ]
    });
    expect(markdown).toContain("# 本周课表");
    expect(markdown).toContain("| 时间 | 课程 | 地点 |");
    expect(markdown).toContain("| --- | --- | --- |");
    expect(markdown).toContain("| 周一 08:00 | 高等数学 | 西 1-101 |");
    expect(markdown).toContain("导出时间：");
  });

  it("渲染列表并跳过空小节", () => {
    const markdown = renderExportMarkdown({
      title: "待办",
      generatedAt: "2026-08-24T08:00:00.000Z",
      sections: [
        { heading: "待办清单", kind: "list", rows: [["复习"], ["写作业"]] },
        { heading: "空小节", rows: [] }
      ]
    });
    expect(markdown).toContain("- 复习");
    expect(markdown).toContain("- 写作业");
    expect(markdown).not.toContain("空小节");
  });

  it("表格单元格中的竖线与换行被转义/清理", () => {
    const markdown = renderExportMarkdown({
      title: "含特殊字符",
      generatedAt: "2026-08-24T08:00:00.000Z",
      sections: [
        {
          heading: "备注",
          rows: [["备注"], ["a|b\n换行"]]
        }
      ]
    });
    expect(markdown).toContain("a\\|b 换行");
  });

  it("时间格式为本地显示（Asia/Shanghai）", () => {
    const markdown = renderExportMarkdown({
      title: "T",
      generatedAt: "2026-08-24T00:30:00.000Z",
      sections: []
    });
    expect(markdown).toContain("2026/8/24 08:30");
  });
});
