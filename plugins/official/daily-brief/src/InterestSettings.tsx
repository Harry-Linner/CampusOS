import { useEffect, useState } from "react";
import type { BriefProfile } from "@campusos/shared";
import { BRIEF_MAX_WEIGHT, BRIEF_MIN_WEIGHT } from "@campusos/shared";

interface InterestSettingsProps {
  brief: NonNullable<import("@campusos/shared").PluginComponentProps["brief"]>;
  onSaved?: (profile: BriefProfile) => void;
}

interface EditableInterest {
  id: string;
  name: string;
  weight: string;
  note: string;
}

const SOURCE_LABELS: Record<string, string> = {
  arxiv: "arXiv（学术/计算机）",
  "hacker-news": "Hacker News（技术/创业）",
  infoq: "InfoQ（技术/工程）"
};

const toEditable = (profile: BriefProfile): EditableInterest[] =>
  profile.interests.map((interest, index) => ({
    id: `interest-${index}`,
    name: interest.name,
    weight: String(interest.weight),
    note: interest.note ?? ""
  }));

const normalizeWeight = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return BRIEF_MIN_WEIGHT;
  return Math.min(BRIEF_MAX_WEIGHT, Math.max(BRIEF_MIN_WEIGHT, parsed));
};

export const InterestSettings = ({
  brief,
  onSaved
}: InterestSettingsProps): JSX.Element => {
  const [interests, setInterests] = useState<EditableInterest[]>([]);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBusy("load");
    void brief
      .loadSettings()
      .then((profile) => {
        if (!active) return;
        setInterests(toEditable(profile));
        setSourceEnabled(profile.sourceEnabled);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "读取设置失败。");
        }
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [brief]);

  const updateInterest = (id: string, patch: Partial<EditableInterest>): void => {
    setInterests((current) =>
      current.map((interest) =>
        interest.id === id ? { ...interest, ...patch } : interest
      )
    );
  };

  const addInterest = (): void => {
    setInterests((current) => [
      ...current,
      {
        id: `interest-${Date.now()}-${current.length}`,
        name: "",
        weight: "5",
        note: ""
      }
    ]);
  };

  const removeInterest = (id: string): void => {
    setInterests((current) => current.filter((interest) => interest.id !== id));
  };

  const save = async (): Promise<void> => {
    if (busy === "save") return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const saved = await brief.saveSettings({
        interests: interests
          .map((interest) => ({
            name: interest.name.trim(),
            weight: normalizeWeight(interest.weight),
            note: interest.note.trim() || null
          }))
          .filter((interest) => interest.name.length > 0),
        sourceEnabled
      });
      setInterests(toEditable(saved));
      setNotice("设置已保存，下一次刷新早报将按新的权重分配。");
      onSaved?.(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="brief-settings" aria-label="早报设置">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Interests</p>
          <h2>关注领域</h2>
        </div>
        <span className="assistant-config-state">{busy === "load" ? "读取中" : `${interests.length} 个领域`}</span>
      </header>
      <p className="assistant-privacy-copy">
        领域与权重决定各板块的摘要条数（高权重领域优先分配）。早报抓取仅限下方启用的公开信息源；AI 生成复用 AI 助手已配置的服务商与 API Key。
      </p>

      {error ? <div className="workspace-error-banner" role="alert">{error}</div> : null}
      {notice ? <p className="schedule-notice" role="status">{notice}</p> : null}

      <div className="interest-editor">
        {interests.length === 0 ? (
          <div className="quiet-empty-state">
            还没有关注领域。添加一个领域（如"数学"），早报会优先为你聚合该领域的资讯。
          </div>
        ) : (
          interests.map((interest) => (
            <div className="interest-row" key={interest.id}>
              <input
                aria-label="领域名称"
                value={interest.name}
                placeholder="领域名称，如：数学"
                onChange={(event) => updateInterest(interest.id, { name: event.target.value })}
              />
              <input
                aria-label="权重"
                type="number"
                min={BRIEF_MIN_WEIGHT}
                max={BRIEF_MAX_WEIGHT}
                value={interest.weight}
                onChange={(event) => updateInterest(interest.id, { weight: event.target.value })}
                title={`权重（${BRIEF_MIN_WEIGHT}-${BRIEF_MAX_WEIGHT}）`}
              />
              <input
                aria-label="备注"
                value={interest.note}
                placeholder="备注（可选）"
                onChange={(event) => updateInterest(interest.id, { note: event.target.value })}
              />
              <button
                className="text-button is-danger"
                type="button"
                onClick={() => removeInterest(interest.id)}
              >
                删除
              </button>
            </div>
          ))
        )}
        <button className="secondary-button" type="button" onClick={addInterest}>
          添加领域
        </button>
      </div>

      <header className="section-heading brief-source-heading">
        <div>
          <p className="eyebrow">Sources</p>
          <h2>信息源</h2>
        </div>
      </header>
      <ul className="source-toggle-list">
        {Object.entries(SOURCE_LABELS).map(([sourceId, label]) => (
          <li key={sourceId}>
            <label>
              <input
                type="checkbox"
                checked={sourceEnabled[sourceId] !== false}
                onChange={(event) =>
                  setSourceEnabled((current) => ({
                    ...current,
                    [sourceId]: event.target.checked
                  }))
                }
              />
              {label}
            </label>
          </li>
        ))}
      </ul>

      <div className="assistant-actions">
        <button
          className="primary-button"
          type="button"
          disabled={busy === "save" || busy === "load"}
          onClick={() => void save()}
        >
          {busy === "save" ? "正在保存" : "保存设置"}
        </button>
      </div>
    </section>
  );
};
