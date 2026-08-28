import { useEffect, useMemo, useState } from "react";
import type {
  CampusDownloadRequest,
  CampusDownloadTask,
  CampusMaterialRecord,
  CampusWorkspaceSnapshot,
  PluginComponentProps
} from "@campusos/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export { manifest } from "./manifest";

type MaterialsSection = "library" | "downloads";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const statusLabel: Record<CampusDownloadTask["status"], string> = {
  queued: "等待下载",
  syncing: "下载中",
  paused: "已暂停",
  failed: "下载失败",
  ready: "已完成"
};

interface MaterialCourseGroup {
  key: string;
  name: string;
  materials: CampusMaterialRecord[];
}

interface MaterialSemesterGroup {
  key: string;
  label: string;
  courses: MaterialCourseGroup[];
}

const normalizeSemester = (semester: string): { key: string; label: string } => {
  const normalized = semester
    .trim()
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replace(/\s+/g, "");
  const academicYear = /(20\d{2})-(20\d{2})/.exec(normalized);
  const shortTerm = /短学期|短|小学期/.test(normalized);
  const season = /秋|冬/.test(normalized)
    ? { number: 1, label: "秋冬学期" }
    : /春|夏/.test(normalized)
      ? { number: 2, label: "春夏学期" }
      : null;
  if (academicYear && shortTerm) {
    return {
      key: `${academicYear[1]}:short`,
      label: `${academicYear[1]}-${academicYear[2]} 短学期`
    };
  }
  if (!academicYear || !season) {
    return { key: normalized, label: semester };
  }
  return {
    key: `${academicYear[1]}:${season.number}`,
    label: `${academicYear[1]}-${academicYear[2]} ${season.label}`
  };
};

export const buildMaterialSemesterGroups = (
  snapshot: CampusWorkspaceSnapshot
): MaterialSemesterGroup[] => {
  const semesters = new Map<
    string,
    { label: string; courses: Map<string, MaterialCourseGroup> }
  >();
  const ensureCourse = (semester: string, courseName: string): MaterialCourseGroup => {
    const normalized = normalizeSemester(semester);
    const semesterGroup = semesters.get(normalized.key) ?? {
      label: normalized.label,
      courses: new Map<string, MaterialCourseGroup>()
    };
    const courseKey = `${normalized.key}:${courseName}`;
    const course = semesterGroup.courses.get(courseKey) ?? {
      key: courseKey,
      name: courseName,
      materials: []
    };
    semesterGroup.courses.set(courseKey, course);
    semesters.set(normalized.key, semesterGroup);
    return course;
  };

  for (const course of snapshot.materialCourses ?? []) {
    ensureCourse(course.semester, course.name);
  }
  for (const material of snapshot.materials) {
    ensureCourse(material.semester, material.courseName).materials.push(material);
  }

  return [...semesters.entries()]
    .map(([key, semester]) => ({
      key,
      label: semester.label,
      courses: [...semester.courses.values()]
        .map((course) => ({
          ...course,
          materials: [...course.materials].sort(
            (left, right) =>
              Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
              left.title.localeCompare(right.title, "zh-CN")
          )
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    }))
    .sort((left, right) => right.key.localeCompare(left.key));
};

const formatFileSize = (size: number | undefined): string => {
  if (size === undefined || !Number.isFinite(size) || size < 0) return "大小未知";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const toDownloadRequest = (material: CampusMaterialRecord): CampusDownloadRequest => ({
  url: material.downloadUrl!,
  fallbackUrl: material.downloadFallbackUrl,
  expectedBytes: material.sizeBytes,
  title: material.title,
  courseName: material.courseName,
  sourceId: material.sourceId,
  semester: material.semester
});

const findMaterialDownload = (
  material: CampusMaterialRecord,
  downloads: readonly CampusDownloadTask[]
): CampusDownloadTask | null =>
  downloads.find(
    (download) =>
      download.title === material.title &&
      download.courseName === material.courseName &&
      download.sourceId === material.sourceId
  ) ?? null;

export const Component = ({
  downloads,
  loading,
  onRefresh,
  snapshot,
  navigationTarget
}: PluginComponentProps): JSX.Element => {
  const [section, setSection] = useState<MaterialsSection>("library");
  const [semesterKey, setSemesterKey] = useState("");
  const [courseKey, setCourseKey] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const semesterGroups = useMemo(
    () => (snapshot ? buildMaterialSemesterGroups(snapshot) : []),
    [snapshot]
  );
  const selectedSemesterKey = semesterGroups.some(
    (semester) => semester.key === semesterKey
  )
    ? semesterKey
    : semesterGroups[0]?.key ?? "";
  const selectedSemester =
    semesterGroups.find((semester) => semester.key === selectedSemesterKey) ?? null;
  const filteredCourses = (selectedSemester?.courses ?? []).filter((course) =>
    course.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const selectedCourseKey = filteredCourses.some((course) => course.key === courseKey)
    ? courseKey
    : filteredCourses[0]?.key ?? "";
  const selectedCourse =
    filteredCourses.find((course) => course.key === selectedCourseKey) ?? null;
  const selectableMaterials =
    selectedCourse?.materials.filter((material) => material.downloadUrl) ?? [];
  const selectedMaterials = selectableMaterials.filter((material) =>
    selectedIds.has(material.id)
  );

  // Jump-to-locate: when the global search navigates to a material, select the
  // semester + course that contains it, then scroll to and flash-highlight it.
  useEffect(() => {
    if (!navigationTarget || navigationTarget.viewId !== "materials" || !navigationTarget.entityId) return;
    const targetId = navigationTarget.entityId;
    for (const semester of semesterGroups) {
      const course = semester.courses.find((candidate) =>
        candidate.materials.some((material) => material.id === targetId)
      );
      if (course) {
        setSemesterKey(semester.key);
        setCourseKey(course.key);
        break;
      }
    }
  }, [navigationTarget, semesterGroups]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.viewId !== "materials" || !navigationTarget.entityId) return;
    const id = navigationTarget.entityId;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-search-id="${id}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("is-search-highlight");
        window.setTimeout(() => el.classList.remove("is-search-highlight"), 1600);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [navigationTarget, selectedCourseKey, semesterKey]);

  const runAction = async (
    id: string,
    action: () => Promise<void>
  ): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "下载操作失败。");
    } finally {
      setBusyId(null);
    }
  };

  const runFileAction = async (
    id: string,
    action: () => Promise<void>
  ): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "File action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const enqueueSelected = async (): Promise<void> => {
    if (!downloads || selectedMaterials.length === 0) return;
    setBusyId("selected");
    setActionError(null);
    setNotice(null);
    const results = await Promise.allSettled(
      selectedMaterials.map((material) =>
        downloads.enqueue(toDownloadRequest(material))
      )
    );
    const failed = results.filter((result) => result.status === "rejected");
    const succeededIds = selectedMaterials
      .filter((_, index) => results[index]?.status === "fulfilled")
      .map((material) => material.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of succeededIds) next.delete(id);
      return next;
    });
    if (failed.length > 0) {
      const firstFailure = failed[0];
      setActionError(
        firstFailure?.status === "rejected" && firstFailure.reason instanceof Error
          ? `${failed.length} 个文件入队失败：${firstFailure.reason.message}`
          : `${failed.length} 个文件入队失败。`
      );
    } else {
      setNotice(`${succeededIds.length} 个文件已加入下载队列`);
    }
    try {
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "下载队列刷新失败。");
    } finally {
      setBusyId(null);
    }
  };

  if (!snapshot) {
    return (
      <section className="page-shell materials-page">
        <header className="page-heading">
          <div>
            <h1>资料</h1>
            <p>{loading ? "正在读取课程资料与下载队列" : "资料暂时不可用"}</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="page-shell materials-page">
      <header className="page-heading materials-heading">
        <div>
          <h1>资料</h1>
        </div>
        <nav className="module-tabs" aria-label="资料视图">
          <button
            type="button"
            className={section === "library" ? "is-active" : undefined}
            aria-pressed={section === "library"}
            onClick={() => setSection("library")}
          >
            课程资料
          </button>
          <button
            type="button"
            className={section === "downloads" ? "is-active" : undefined}
            aria-pressed={section === "downloads"}
            onClick={() => setSection("downloads")}
          >
            下载队列
            {snapshot.downloads.length > 0 ? ` ${snapshot.downloads.length}` : ""}
          </button>
        </nav>
      </header>

      {actionError ? (
        <p className="workspace-error-banner" role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className="schedule-notice" role="status">
          {notice}
        </p>
      ) : null}

      {section === "library" ? (
        semesterGroups.length === 0 ? (
          <div className="quiet-empty-state">同步完成后，目标学期课程会显示在这里。</div>
        ) : (
          <div className="materials-browser">
            <aside className="materials-course-pane" aria-label="课程目录">
              <div className="materials-course-tools">
                {semesterGroups.length > 1 ? (
                  <label>
                    <span>学期</span>
                    <select
                      aria-label="资料学期"
                      value={selectedSemesterKey}
                      onChange={(event) => {
                        setSemesterKey(event.target.value);
                        setCourseKey("");
                      }}
                    >
                      {semesterGroups.map((semester) => (
                        <option key={semester.key} value={semester.key}>
                          {semester.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索课程"
                  aria-label="搜索资料课程"
                />
              </div>
              <div className="materials-course-list">
                {filteredCourses.map((course) => (
                  <button
                    key={course.key}
                    type="button"
                    className={
                      course.key === selectedCourseKey
                        ? "materials-course-option is-active"
                        : "materials-course-option"
                    }
                    onClick={() => setCourseKey(course.key)}
                  >
                    <strong>{course.name}</strong>
                    <span>{course.materials.length} 个文件</span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="materials-file-pane" aria-label="资料文件">
              <header className="materials-file-heading">
                <div>
                  <h2>{selectedCourse?.name ?? "没有匹配的课程"}</h2>
                </div>
                {selectableMaterials.length > 0 ? (
                  <div className="materials-selection-actions">
                    <label>
                      <input
                        type="checkbox"
                        aria-label="选择当前课程全部资料"
                        checked={
                          selectableMaterials.length > 0 &&
                          selectableMaterials.every((material) =>
                            selectedIds.has(material.id)
                          )
                        }
                        onChange={(event) => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            for (const material of selectableMaterials) {
                              if (event.target.checked) next.add(material.id);
                              else next.delete(material.id);
                            }
                            return next;
                          });
                        }}
                      />
                      全选
                    </label>
                    <Button
                      type="button"
                      disabled={
                        !downloads ||
                        selectedMaterials.length === 0 ||
                        busyId === "selected"
                      }
                      onClick={() => void enqueueSelected()}
                    >
                      {busyId === "selected"
                        ? "正在入队"
                        : `下载选中${selectedMaterials.length > 0 ? ` ${selectedMaterials.length}` : ""}`}
                    </Button>
                  </div>
                ) : null}
              </header>

              {selectedCourse && selectedCourse.materials.length > 0 ? (
                <ul className="materials-file-list">
                  {selectedCourse.materials.map((material) => {
                    const download = findMaterialDownload(
                      material,
                      snapshot.downloads
                    );
                    return (
                      <li key={material.id} data-search-id={material.id} className="materials-file-row">
                        <input
                          type="checkbox"
                          aria-label={`选择${material.title}`}
                          disabled={!material.downloadUrl}
                          checked={selectedIds.has(material.id)}
                          onChange={(event) => {
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(material.id);
                              else next.delete(material.id);
                              return next;
                            });
                          }}
                        />
                        <div className="materials-file-copy">
                          <strong>{material.title}</strong>
                          <span>
                            {formatFileSize(material.sizeBytes)} · {" "}
                            {dateTimeFormatter.format(new Date(material.updatedAt))}
                          </span>
                          {download ? (
                            <span className={`materials-local-state is-${download.status}`}>
                              {statusLabel[download.status]}
                              {download.status === "syncing" || download.status === "paused"
                                ? ` · ${download.progress}%`
                                : ""}
                            </span>
                          ) : null}
                        </div>
                        {material.downloadUrl && downloads ? (
                          <Button
                            variant="ghost"
                            type="button"
                            disabled={busyId === material.id}
                            onClick={() =>
                              void runAction(material.id, () =>
                                downloads.enqueue(toDownloadRequest(material))
                              )
                            }
                          >
                            {busyId === material.id
                              ? "处理中"
                              : download?.status === "ready"
                                ? "校验文件"
                                : "下载"}
                          </Button>
                        ) : (
                          <span className="meta-line">不可下载</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="quiet-empty-state">
                  {selectedCourse ? "这门课程暂时没有资料。" : "没有匹配的课程。"}
                </div>
              )}
            </section>
          </div>
        )
      ) : (
        <section className="materials-downloads" aria-label="下载队列">
          <header className="section-heading">
            <h2>下载队列</h2>
            <span>
              {snapshot.downloads.filter((item) => item.status !== "ready").length} 个进行中
            </span>
          </header>
          {snapshot.downloads.length > 0 ? (
            <ul className="materials-download-list">
              {snapshot.downloads.map((download) => (
                <li key={download.id} className="materials-download-row">
                  <div className="materials-download-copy">
                    <strong>{download.title}</strong>
                    <span>{download.courseName} · {download.targetPath}</span>
                    {download.failureMessage ? (
                      <span className="error-copy" role="alert">
                        {download.failureMessage}
                      </span>
                    ) : null}
                  </div>
                  <div className="materials-download-progress">
                    <span>
                      {download.progress}% · {statusLabel[download.status]}
                    </span>
                    <progress max="100" value={download.progress}>
                      {download.progress}%
                    </progress>
                  </div>
                  {downloads && download.status === "ready" ? (
                    <div className="inline-actions">
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busyId === download.id}
                        onClick={() =>
                          void runFileAction(download.id, () =>
                            downloads.open(download.id)
                          )
                        }
                      >
                        打开
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busyId === download.id}
                        onClick={() =>
                          void runFileAction(download.id, () =>
                            downloads.reveal(download.id)
                          )
                        }
                      >
                        在文件夹中显示
                      </Button>
                    </div>
                  ) : downloads ? (
                    <div className="inline-actions">
                      {download.status === "paused" || download.status === "failed" ? (
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={busyId === download.id}
                          onClick={() =>
                            void runAction(download.id, () =>
                              downloads.resume(download.id)
                            )
                          }
                        >
                          {download.status === "failed" ? "重试" : "继续"}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={busyId === download.id}
                          onClick={() =>
                            void runAction(download.id, () =>
                              downloads.pause(download.id)
                            )
                          }
                        >
                          暂停
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        type="button"
                        disabled={busyId === download.id}
                        onClick={() =>
                          void runAction(download.id, () =>
                            downloads.cancel(download.id)
                          )
                        }
                      >
                        取消
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="quiet-empty-state">下载队列为空。</div>
          )}
        </section>
      )}
    </section>
  );
};
