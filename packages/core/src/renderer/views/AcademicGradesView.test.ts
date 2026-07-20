/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AcademicGradesData,
  CapabilityRecord,
  PluginCapability,
  PluginCapabilityClient
} from "@campusos/shared";
import { Component as AcademicGradesView } from "@campusos/plugin-academic-grades";

afterEach(cleanup);

const liveRecord: CapabilityRecord<AcademicGradesData> = {
  capability: "academic.grades@1",
  providerId: "org.campusos.zju-undergraduate",
  accountId: "3240100001",
  state: "live",
  updatedAt: "2026-07-19T04:00:00.000Z",
  data: {
    grades: [
      {
        sourceId: "grade-1",
        courseCode: "CS101",
        courseName: "程序设计",
        credit: 3,
        originalScore: "92",
        gradePoint: 4.2,
        academicYearStart: 2025,
        termNumber: 1,
        isMajorCourse: true,
        courseCategory: null
      },
      {
        sourceId: "grade-2",
        courseCode: "MATH100",
        courseName: "微积分",
        credit: 5,
        originalScore: "85",
        gradePoint: 3.7,
        academicYearStart: 2025,
        termNumber: 1,
        isMajorCourse: true,
        courseCategory: null
      }
    ]
  }
};

describe("AcademicGradesView", () => {
  it("reads its injected capability and refreshes through the workspace chain", async () => {
    const readCalls: string[] = [];
    const capabilities: PluginCapabilityClient = {
      read: async <T>(capability: PluginCapability) => {
        readCalls.push(capability);
        return [liveRecord] as unknown as CapabilityRecord<T>[];
      }
    };
    const onRefresh = vi.fn(async () => undefined);

    render(createElement(AcademicGradesView, {
      capabilities,
      loading: false,
      onRefresh,
      snapshot: null
    }));

    expect(await screen.findByText("程序设计")).toBeDefined();
    expect(screen.getAllByText("3.89")).toHaveLength(2);
    expect(screen.getByText("实时获取")).toBeDefined();
    expect(readCalls).toEqual(["academic.grades@1"]);

    fireEvent.click(screen.getByRole("button", { name: "刷新成绩" }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(readCalls).toHaveLength(2);
    });
  });

  it("masks original scores when privacy toggle is on by default", async () => {
    const capabilities: PluginCapabilityClient = {
      read: async <T>() =>
        [liveRecord] as unknown as CapabilityRecord<T>[]
    };
    const onRefresh = vi.fn(async () => undefined);

    render(createElement(AcademicGradesView, {
      capabilities,
      loading: false,
      onRefresh,
      snapshot: null
    }));

    await screen.findByText("程序设计");
    // Privacy mask is on by default — scores hidden
    expect(screen.getAllByText("***")).toHaveLength(2);
    // Grade points still visible
    expect(screen.getByText("绩点 4.2")).toBeDefined();
    expect(screen.getByText("绩点 3.7")).toBeDefined();
    // Original scores hidden
    expect(screen.queryByText("92")).toBeNull();
    expect(screen.queryByText("85")).toBeNull();

    // Toggle privacy off
    fireEvent.click(screen.getByLabelText("隐私遮罩"));
    expect(screen.getByText("92")).toBeDefined();
    expect(screen.getByText("85")).toBeDefined();
    expect(screen.queryByText("***")).toBeNull();
  });
});
