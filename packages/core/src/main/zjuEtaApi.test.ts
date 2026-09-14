import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "./zjuAuthCookies";
import type { ZjuAuthRequestHost } from "./zjuAuthHost";
import { parseEtaTimetable, ZjuEtaApi } from "./zjuEtaApi";

const payload = (half = "秋冬", repeat = "all") => JSON.stringify({ code: 0, data: { kbList: { "1": [{ xqj: 2, ksj: 3, ks: 2, sfqd: 1, xxq: half, dsz: repeat, ke: [{ kcdm: "TEST", kcmc: "课程(H)", rkjs: "教师", jsmc: "教室" }] }] } } });
const credential = { username: "student", password: "test-only" };
const host = () => {
  const cookies = new CookieJar();
  cookies.store("https://zjuam.zju.edu.cn/cas/login", ["SSO=fixture; Path=/; Secure"]);
  return {
    request: vi.fn<ZjuAuthRequestHost["request"]>(),
    authenticateCas: vi.fn(async () => ({ username: "student", cookies })),
    timeoutMs: 1000, now: () => new Date("2026-09-14T00:00:00Z")
  };
};
const ticket = { status: 302, headers: { location: "http://eta.zju.edu.cn/zftal-xgxt-web/teacher/xtgl/index/check.zf?ticket=ST-test" }, body: "" };
const session = { status: 302, headers: { "set-cookie": "JSESSIONID=eta-only; Path=/zftal-xgxt-web; Secure" }, body: "" };

describe("ETA timetable schema and session boundary", () => {
  it("parses half-semesters, consecutive periods and odd/even weeks without inventing selection IDs", () => {
    const [row] = parseEtaTimetable(payload("冬", "single"), 2026, 1);
    expect(row).toMatchObject({ courseName: "课程（H）", periods: [3, 4], dayOfWeek: 2, firstHalf: false, secondHalf: true, weekPattern: "odd", confirmed: true });
    expect(row.courseId).toBeUndefined();
    expect(parseEtaTimetable(payload("春", "double"), 2026, 2)[0]).toMatchObject({ firstHalf: true, secondHalf: false, weekPattern: "even" });
    expect(parseEtaTimetable(payload(), 2026, 1)[0].sourceId).not.toBe(parseEtaTimetable(payload(), 2025, 1)[0].sourceId);
  });
  it("distinguishes a valid empty semester from rejected and malformed responses", () => {
    expect(parseEtaTimetable('{"code":0,"data":{"kbList":{}}}', 2026, 1)).toEqual([]);
    for (const body of ["<html>登录</html>", '{"code":401}', '{"code":0,"data":{"kbList":{"1":[{}]}}}']) expect(() => parseEtaTimetable(body, 2026, 1)).toThrow();
  });
  it("uses CAS once, upgrades only the exact ETA ticket callback, and isolates service cookies", async () => {
    const h = host();
    h.request.mockResolvedValueOnce(ticket).mockResolvedValueOnce(session)
      .mockResolvedValue({ status: 200, headers: {}, body: payload() });
    const api = new ZjuEtaApi(h);
    await api.timetable(credential, 2026, 1);
    await api.timetable(credential, 2025, 2);
    expect(h.authenticateCas).toHaveBeenCalledTimes(1);
    const calls = h.request.mock.calls;
    expect(new URL(calls[0][1]).searchParams.get("service")).toBe("http://eta.zju.edu.cn/zftal-xgxt-web/teacher/xtgl/index/check.zf");
    expect(calls[0][2]?.cookie).toBe("SSO=fixture");
    expect(calls[1][1]).toBe("https://eta.zju.edu.cn/zftal-xgxt-web/teacher/xtgl/index/check.zf?ticket=ST-test");
    expect(calls[1][2]?.cookie).toBeUndefined();
    expect(new URL(calls[2][1]).searchParams.get("xnxq")).toBe("2026-2027-1");
    expect(new URL(calls[3][1]).searchParams.get("xnxq")).toBe("2025-2026-2");
    expect(calls[2][2]?.cookie).toBe("JSESSIONID=eta-only");
    expect(calls.every(call => !call[1].includes("zdbk"))).toBe(true);
  });
  it("rejects foreign ticket destinations before sending credentials or tickets", async () => {
    const h = host();
    h.request.mockResolvedValue({ ...ticket, headers: { location: "https://other.example/?ticket=ST-test" } });
    await expect(new ZjuEtaApi(h).timetable(credential, 2026, 1)).rejects.toMatchObject({ code: "service-verification-failed" });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it("does not publish an in-flight result after the account is cleared", async () => {
    const h = host();
    let release!: (response: { status: number; headers: Record<string, string>; body: string }) => void;
    h.request.mockResolvedValueOnce(ticket).mockResolvedValueOnce(session)
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const api = new ZjuEtaApi(h);
    const pending = api.timetable(credential, 2026, 1);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(3));
    api.clear();
    release({ status: 200, headers: {}, body: payload() });
    await expect(pending).rejects.toMatchObject({ code: "service-verification-failed" });
  });
});
