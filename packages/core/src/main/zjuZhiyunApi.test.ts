import { describe, expect, it } from "vitest";
import { extractZhiyunToken, parseZhiyunCourseListing, parseZhiyunSubInfo } from "./zjuZhiyunApi";

describe("extractZhiyunToken", () => {
  it("pulls the bearer token out of the PHP-serialized _token cookie", () => {
    // classroom 把登录态存成 PHP 序列化串，percent-encode 之后放在 _token cookie 里。
    const serialized = '{i:0;s:6:"_token";i:0;s:11:"abc123token";}';
    const header = `other=1; _token=${encodeURIComponent(serialized)}`;
    expect(extractZhiyunToken(header)).toBe("abc123token");
  });

  it("decodes a partially encoded cookie value", () => {
    // 真实 Cookie 头里分号必须编码（否则会被当成分隔符），引号常常保持原样。
    const serialized = '{i:0;s:6:"_token";i:0;s:4:"tok1";}';
    expect(extractZhiyunToken(`_token=${serialized.replace(/;/g, "%3B")}`)).toBe("tok1");
  });

  it("returns null when the cookie is missing or does not carry a token", () => {
    expect(extractZhiyunToken(null)).toBeNull();
    expect(extractZhiyunToken("other=1")).toBeNull();
    expect(extractZhiyunToken("_token=not-a-serialized-blob")).toBeNull();
  });
});

describe("parseZhiyunCourseListing", () => {
  it("reads the by-day shape, where list is an object of buckets", () => {
    // 对照实现 get_range_subs：`list` 是对象，遍历 values 的 `course[]`。
    const body = JSON.stringify({
      code: 0,
      list: {
        "2026-09-14 08:00": { course: [{ id: "86240", title: "计算机网络", sub_id: "1966542", sub_title: "计网(1)", realname: "张三", tenant_code: "112" }] },
        "2026-09-14 10:00": { course: [{ id: "86241", title: "操作系统", sub_id: "1966543", sub_title: "OS(1)", realname: "李四", tenant_code: "112" }] }
      }
    });
    const entries = parseZhiyunCourseListing(body, "2026-09-14");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ courseId: "86240", subId: "1966542", courseName: "计算机网络", teacher: "张三", observedDay: "2026-09-14" });
  });

  it("reads the by-month shape, where list is an array of buckets", () => {
    const body = JSON.stringify({
      code: 0,
      list: [{ course: [{ id: 86240, title: "计算机网络", sub_id: 1966542, realname: "张三" }] }]
    });
    const entries = parseZhiyunCourseListing(body, null);
    expect(entries).toEqual([
      { courseId: "86240", subId: "1966542", courseName: "计算机网络", subTitle: null, teacher: "张三", tenantCode: null, observedDay: null }
    ]);
  });

  it("deduplicates the same class seen on several days and skips incomplete rows", () => {
    const row = { id: "86240", title: "计算机网络", sub_id: "1966542", realname: "张三" };
    const body = JSON.stringify({
      code: 0,
      list: {
        a: { course: [row, { id: "86240", title: "计算机网络" }, { title: "缺 id" }] },
        b: { course: [row] }
      }
    });
    expect(parseZhiyunCourseListing(body, "2026-09-14")).toHaveLength(1);
  });

  it("returns nothing for a non-JSON body", () => {
    expect(parseZhiyunCourseListing("<html>login</html>", "2026-09-14")).toEqual([]);
  });
});

describe("parseZhiyunSubInfo", () => {
  it("treats sub_status 6 as playable even when contents is empty", () => {
    // 真实观测：2026-09-14 的计网这一节 contents 为空但 sub_status 为 6，
    // 回放页可以正常播放。智云前端判的就是 6，所以不能改看 contents。
    const body = JSON.stringify({ code: 0, data: { sub_status: 6, content: { save_playback: { contents: [] } } } });
    expect(parseZhiyunSubInfo(body)).toEqual({ subStatus: "6", playbackCount: 0, playable: true });
  });

  it("treats an unready session as not playable", () => {
    // 真实观测：当天还没录像的节次是 sub_status 2 且没有 save_playback，
    // 此时打开回放页只会看到「不在回放内」。
    const body = JSON.stringify({ code: 0, data: { sub_status: 2, content: {} } });
    expect(parseZhiyunSubInfo(body)).toEqual({ subStatus: "2", playbackCount: 0, playable: false });
  });

  it("accepts ready playback contents as playable too", () => {
    const body = JSON.stringify({ code: 0, data: { sub_status: 5, content: { save_playback: { contents: [{ url: "https://example.invalid/a" }] } } } });
    expect(parseZhiyunSubInfo(body).playable).toBe(true);
  });

  it("refuses to claim playable for an unparsable or empty payload", () => {
    expect(parseZhiyunSubInfo("not json")).toEqual({ subStatus: null, playbackCount: 0, playable: false });
    expect(parseZhiyunSubInfo(JSON.stringify({ code: 1 })).playable).toBe(false);
    expect(parseZhiyunSubInfo(JSON.stringify({})).playable).toBe(false);
  });
});
