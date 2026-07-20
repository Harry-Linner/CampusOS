import { describe, expect, it } from "vitest";
import type {
  AcademicGradesData,
  CapabilityRecord,
  PluginCapability,
  PluginRuntimeSnapshot
} from "@campusos/shared";
import { manifest as academicGradesManifest } from "@campusos/plugin-academic-grades/manifest";
import { manifest as zjuUndergraduateManifest } from "@campusos/plugin-zju-undergraduate/manifest";
import { resolvePluginRuntime } from "./pluginRuntime";
import { createPluginCapabilityAccess } from "./pluginCapabilityAccess";

const gradeData: AcademicGradesData = {
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
    }
  ]
};

const createRuntime = (gradesEnabled = true): PluginRuntimeSnapshot =>
  resolvePluginRuntime({
    registrations: [
      {
        manifest: zjuUndergraduateManifest,
        enabled: true,
        grantedPermissions: [...zjuUndergraduateManifest.permissions]
      },
      {
        manifest: academicGradesManifest,
        enabled: gradesEnabled,
        grantedPermissions: []
      }
    ],
    coreCapabilities: [
      "core.auth.zju-verification@1",
      "core.auth.zju-service-session@1",
      "core.refresh@1",
      "core.provenance-store@1"
    ]
  });

const createRecord = (
  accountId: string | null,
  state: CapabilityRecord<AcademicGradesData>["state"] = "live"
): CapabilityRecord<AcademicGradesData> => ({
  capability: "academic.grades@1",
  providerId: zjuUndergraduateManifest.id,
  accountId,
  state,
  updatedAt: "2026-07-19T04:00:00.000Z",
  data: state === "unavailable" ? null : gradeData
});

describe("plugin capability access", () => {
  it("returns only the active plugin binding for the verified account", async () => {
    const readCapabilities: PluginCapability[] = [];
    const readRecords = async <T>(capability: PluginCapability) => {
      readCapabilities.push(capability);
      return [
        createRecord("3240100001"),
        createRecord("3240109999"),
        {
          ...createRecord("3240100001"),
          providerId: "org.example.unbound-provider"
        }
      ] as unknown as CapabilityRecord<T>[];
    };
    const access = createPluginCapabilityAccess({
      loadRuntime: async () => createRuntime(),
      readRecords,
      readVerifiedAccountId: async () => "3240100001"
    });

    const records = await access.read<AcademicGradesData>({
      pluginId: academicGradesManifest.id,
      capability: "academic.grades@1"
    });

    expect(records).toEqual([createRecord("3240100001")]);
    expect(readCapabilities).toEqual(["academic.grades@1"]);
  });

  it("does not expose another account cache when no account is verified", async () => {
    const unavailable = createRecord(null, "unavailable");
    const access = createPluginCapabilityAccess({
      loadRuntime: async () => createRuntime(),
      readRecords: async <T>() => [
        createRecord("3240100001"),
        unavailable
      ] as CapabilityRecord<T>[],
      readVerifiedAccountId: async () => null
    });

    await expect(access.read({
      pluginId: academicGradesManifest.id,
      capability: "academic.grades@1"
    })).resolves.toEqual([unavailable]);
  });

  it("rejects undeclared capabilities and disabled plugins", async () => {
    const createAccess = (runtime: PluginRuntimeSnapshot) =>
      createPluginCapabilityAccess({
        loadRuntime: async () => runtime,
        readRecords: async () => [],
        readVerifiedAccountId: async () => null
      });

    await expect(createAccess(createRuntime()).read({
      pluginId: academicGradesManifest.id,
      capability: "academic.exams@1"
    })).rejects.toThrow("未声明");
    await expect(createAccess(createRuntime(false)).read({
      pluginId: academicGradesManifest.id,
      capability: "academic.grades@1"
    })).rejects.toThrow("未激活");
  });
});
