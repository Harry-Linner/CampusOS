/* @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampusFeedOnboarding } from "../../../../../plugins/official/campus-feed/src/CampusFeedOnboarding";
import type { FeedSourceDescriptor } from "@campusos/shared";
import { CAMPUS_FEED_INTERESTS, campusFeedRecommendationReasons } from "@campusos/shared";
import { CAMPUS_FEED_CATALOG } from "../../main/campusFeedCatalog";
afterEach(cleanup);
const catalog: FeedSourceDescriptor[] = [{ id: "lib", name: "图书馆 · 资源动态", category: "general", tags: ["图书馆"], topics: ["图书资源"], baseUrl: "https://lib.example", listUrl: "https://lib.example/list.htm", intervalMinutes: 60, enabled: false, verification: { status: "verified", checkedAt: null, note: "已核对正文" } }];
describe("campus feed first-visit choices", () => {
  it("keeps every college source inside its audience even when every interest matches", () => {
    for (const source of CAMPUS_FEED_CATALOG.filter(entry => entry.college)) {
      for (const college of [null, "不属于这个来源的学院"]) {
        expect(campusFeedRecommendationReasons(source, { identity: "master", college, interests: CAMPUS_FEED_INTERESTS }), source.id).toEqual([]);
      }
    }
    const undergraduate = CAMPUS_FEED_CATALOG.find(source => source.id === "xgb-pingjiang")!;
    expect(campusFeedRecommendationReasons(undergraduate, { identity: "master", college: null, interests: ["奖助评优"] })).toEqual([]);
    expect(campusFeedRecommendationReasons({ ...catalog[0], category: "college", college: undefined, topics: ["就业实习"] }, { identity: "master", college: null, interests: ["就业实习"] })).toEqual([]);
  });
  it("does not recommend other colleges for a computer-science student interested in careers", () => {
    const profile = { identity: "master" as const, college: "计算机学院", interests: ["就业实习", "教务考试"] };
    const recommended = CAMPUS_FEED_CATALOG.filter(source => campusFeedRecommendationReasons(source, profile).length).map(source => source.id);
    expect(recommended).toContain("cs-csen");
    expect(recommended).not.toContain("ls-tzgg");
    expect(recommended).not.toContain("mse-tzgg");
    expect(recommended).not.toContain("ccea-tzgg");
  });
  it("recalculates checked recommendations when an existing user changes college and interests", () => {
    const view = render(createElement(CampusFeedOnboarding, { catalog: [...CAMPUS_FEED_CATALOG], initialProfile: { identity: "master", college: "历史学院", interests: [] }, initialSelected: ["ls-tzgg", "mse-tzgg"], onSave: vi.fn(async () => undefined) }));
    fireEvent.change(view.getByRole("combobox", { name: /学院或学园/ }), { target: { value: "计算机学院" } });
    fireEvent.click(view.getByRole("button", { name: "就业实习" }));
    fireEvent.click(view.getByRole("button", { name: "查看推荐来源" }));
    expect((view.getByRole("checkbox", { name: /计算机学院 · 重点提示/ }) as HTMLInputElement).checked).toBe(true);
    expect((view.getByRole("checkbox", { name: /历史学院 · 通知公告/ }) as HTMLInputElement).checked).toBe(false);
    expect((view.getByRole("checkbox", { name: /材料学院 · 党建通知/ }) as HTMLInputElement).checked).toBe(false);
    for (const checkbox of view.getAllByRole("checkbox", { name: /建工学院/ })) expect((checkbox as HTMLInputElement).checked).toBe(false);
  });
  it("can skip without selecting an identity or subscribing to anything", async () => {
    const save = vi.fn(async () => undefined);
    const { getByRole } = render(createElement(CampusFeedOnboarding, { catalog, onSave: save }));
    fireEvent.click(getByRole("button", { name: "暂不订阅，先看看" }));
    expect(save).toHaveBeenCalledWith({ profile: { identity: null, college: null, interests: [] }, selectedSourceIds: [], skip: true });
  });
  it("shows only the source name and information type, and saves the source selection", async () => {
    const save = vi.fn(async () => undefined);
    const { getByRole, queryByText } = render(createElement(CampusFeedOnboarding, { catalog, onSave: save }));
    fireEvent.click(getByRole("button", { name: "图书资源" }));
    fireEvent.click(getByRole("button", { name: "查看推荐来源" }));
    expect(getByRole("checkbox", { name: "图书馆 · 资源动态" })).toBeTruthy();
    expect(queryByText("你关注图书资源")).toBeNull();
    expect(queryByText("已核对正文")).toBeNull();
    fireEvent.click(getByRole("button", { name: "订阅所选并进入" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ selectedSourceIds: ["lib"] }));
  });
  it("selects the matching college without rendering internal recommendation explanations", () => {
    const history: FeedSourceDescriptor = { ...catalog[0], id: "history", name: "历史学院 · 通知", college: "历史学院", audience: ["master"], topics: [] };
    const { getByRole, queryByText } = render(createElement(CampusFeedOnboarding, { catalog: [history], onSave: vi.fn(async () => undefined) }));
    fireEvent.click(getByRole("button", { name: "硕士生" }));
    fireEvent.change(getByRole("combobox", { name: /学院或学园/ }), { target: { value: "历史学院" } });
    fireEvent.click(getByRole("button", { name: "查看推荐来源" }));
    expect(queryByText(/来自你的学院：历史学院/)).toBeNull();
    expect(queryByText(/面向硕士生/)).toBeNull();
    expect((getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });
  it("keeps manual source choices after returning to edit the profile", () => {
    const { getByRole } = render(createElement(CampusFeedOnboarding, { catalog, onSave: vi.fn(async () => undefined) }));
    fireEvent.click(getByRole("button", { name: "图书资源" }));
    fireEvent.click(getByRole("button", { name: "查看推荐来源" }));
    const checkbox = getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(getByRole("button", { name: "返回修改" }));
    fireEvent.click(getByRole("button", { name: "查看推荐来源" }));
    expect((getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("refreshes recommendations after going back and keeps unrelated sources in a separate group", () => {
    const view = render(createElement(CampusFeedOnboarding, { catalog: [...CAMPUS_FEED_CATALOG], onSave: vi.fn(async () => undefined) }));
    fireEvent.change(view.getByRole("combobox", { name: /学院或学园/ }), { target: { value: "历史学院" } });
    fireEvent.click(view.getByRole("button", { name: "查看推荐来源" }));
    fireEvent.click(view.getByRole("button", { name: "返回修改" }));
    fireEvent.change(view.getByRole("combobox", { name: /学院或学园/ }), { target: { value: "计算机学院" } });
    fireEvent.click(view.getByRole("button", { name: "就业实习" }));
    fireEvent.click(view.getByRole("button", { name: "查看推荐来源" }));
    const recommended = within(view.getByRole("region", { name: "推荐来源" }));
    expect((recommended.getByRole("checkbox", { name: "计算机学院 · 重点提示" }) as HTMLInputElement).checked).toBe(true);
    expect(recommended.queryByRole("checkbox", { name: /历史学院|建工学院|材料学院/ })).toBeNull();
  });
});
