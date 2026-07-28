import { describe, expect, it } from "vitest";
import type { CampusDownloadRequest } from "@campusos/shared";
import { classifyCampusDownloadRequest } from "./downloadRequestPolicy";

const validRequest = (): CampusDownloadRequest => ({
  url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob",
  fallbackUrl: "https://courses.zju.edu.cn/api/uploads/908844/blob",
  title: "lecture.pdf",
  courseName: "Computer Networks",
  sourceId: "learning-platform",
  semester: "2026-fall"
});

describe("campus download request policy", () => {
  it("extracts only the two fixed zju-learning upload identifiers", () => {
    expect(classifyCampusDownloadRequest(validRequest())).toEqual({
      kind: "zju-learning",
      uploadId: "908844",
      referenceId: "929150"
    });
  });

  it.each([
    ["foreign host", { url: "https://example.com/api/uploads/reference/929150/blob" }],
    ["insecure protocol", { url: "http://courses.zju.edu.cn/api/uploads/reference/929150/blob" }],
    ["malformed reference id", { url: "https://courses.zju.edu.cn/api/uploads/reference/not-an-id/blob" }],
    ["wrong reference path", { url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob/extra" }],
    ["query string", { url: "https://courses.zju.edu.cn/api/uploads/reference/929150/blob?next=evil" }],
    ["missing fallback", { fallbackUrl: undefined }],
    ["malformed upload id", { fallbackUrl: "https://courses.zju.edu.cn/api/uploads/not-an-id/blob" }],
    ["wrong fallback host", { fallbackUrl: "https://example.com/api/uploads/908844/blob" }]
  ])("rejects a %s learning-platform request", (_label, override) => {
    expect(() => classifyCampusDownloadRequest({
      ...validRequest(),
      ...override
    })).toThrow("学在浙大课件下载地址无效");
  });

  it("leaves non-learning HTTP downloads on the public transport", () => {
    expect(classifyCampusDownloadRequest({
      ...validRequest(),
      sourceId: "academic-affairs",
      url: "https://example.com/public.pdf",
      fallbackUrl: undefined
    })).toEqual({ kind: "public" });
  });
});
