import { useEffect, useMemo, useRef, useState } from "react";
import type { CampusWorkspaceSnapshot, LocalTaskRecord, PluginComponentProps } from "@campusos/shared";
import {
  buildGlobalSearchIndex,
  searchGlobalIndex,
  type GlobalSearchKind,
  type GlobalSearchNavigation
} from "../lib/globalSearch";
import { Input } from "../components/ui/input";

interface GlobalSearchProps {
  open: boolean;
  snapshot: CampusWorkspaceSnapshot | null;
  schedule?: PluginComponentProps["schedule"];
  onClose: () => void;
  onNavigate: (navigation: GlobalSearchNavigation) => void;
}

const kindLabels: Record<GlobalSearchKind, string> = {
  course: "课程",
  item: "事项",
  material: "资料"
};

export const GlobalSearch = ({
  open,
  snapshot,
  schedule,
  onClose,
  onNavigate
}: GlobalSearchProps): JSX.Element | null => {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<LocalTaskRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(
    () => buildGlobalSearchIndex(snapshot, tasks),
    [snapshot, tasks]
  );
  const results = useMemo(() => searchGlobalIndex(index, query), [index, query]);

  // Load the local task store when the modal opens so self-created items are searchable.
  useEffect(() => {
    if (!open) return;
    if (!schedule?.loadTasks) return;
    let active = true;
    void schedule.loadTasks().then((data) => {
      if (active) setTasks(data.tasks);
    }).catch(() => undefined);
    const unsubscribe = schedule.subscribe?.(() => {
      void schedule.loadTasks().then((data) => setTasks(data.tasks)).catch(() => undefined);
    });
    return () => { active = false; unsubscribe?.(); };
  }, [open, schedule]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="global-search-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        <label className="global-search-field">
          <span className="sr-only">搜索课程、事项和资料</span>
          <Input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="搜索课程、事项和资料"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </label>

        <div className="global-search-results" aria-live="polite">
          {!query.trim() ? (
            <p className="global-search-hint">输入名称、课程代码、教师或学期</p>
          ) : results.length === 0 ? (
            <p className="global-search-hint">没有匹配结果</p>
          ) : (
            <ul>
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(result.navigation);
                      onClose();
                    }}
                  >
                    <span className="global-search-kind">
                      {kindLabels[result.kind]}
                    </span>
                    <span className="global-search-result-copy">
                      <strong>{result.title}</strong>
                      {result.detail ? <small>{result.detail}</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};
