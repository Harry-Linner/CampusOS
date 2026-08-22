import { useEffect, useState } from "react";
import { AlertCircle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BriefProfile } from "@campusos/shared";
import { BRIEF_MAX_WEIGHT, BRIEF_MIN_WEIGHT } from "@campusos/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

interface InterestSettingsProps {
  brief: NonNullable<import("@campusos/shared").PluginComponentProps["brief"]>;
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
  infoq: "InfoQ（技术/工程）",
  solidot: "Solidot（科技/科学/中文）"
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
  brief
}: InterestSettingsProps): JSX.Element => {
  const [interests, setInterests] = useState<EditableInterest[]>([]);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      toast.success("设置已保存", {
        description: "下一次刷新早报将按新的权重分配。"
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>关注领域</CardTitle>
        <CardDescription>
          领域与权重决定各板块的摘要条数（高权重领域优先分配）。早报抓取仅限下方启用的公开信息源；AI 生成复用 AI 助手已配置的服务商与 API Key。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>设置异常</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {busy === "load" ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {interests.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  还没有关注领域。添加一个领域（如"数学"），早报会优先为你聚合该领域的资讯。
                </p>
              ) : (
                interests.map((interest) => (
                  <div
                    key={interest.id}
                    className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)_auto] items-center gap-2"
                  >
                    <Input
                      aria-label="领域名称"
                      value={interest.name}
                      placeholder="领域名称，如：数学"
                      onChange={(event) =>
                        updateInterest(interest.id, { name: event.target.value })
                      }
                    />
                    <Input
                      aria-label="权重"
                      type="number"
                      min={BRIEF_MIN_WEIGHT}
                      max={BRIEF_MAX_WEIGHT}
                      value={interest.weight}
                      title={`权重（${BRIEF_MIN_WEIGHT}-${BRIEF_MAX_WEIGHT}）`}
                      onChange={(event) =>
                        updateInterest(interest.id, { weight: event.target.value })
                      }
                    />
                    <Input
                      aria-label="备注"
                      value={interest.note}
                      placeholder="备注（可选）"
                      onChange={(event) =>
                        updateInterest(interest.id, { note: event.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`删除领域 ${interest.name || "未命名"}`}
                      onClick={() => removeInterest(interest.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))
              )}
              <Button type="button" variant="outline" size="sm" onClick={addInterest}>
                <Plus className="size-4" />
                添加领域
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-sm font-medium">信息源</h3>
              {Object.entries(SOURCE_LABELS).map(([sourceId, label]) => (
                <label
                  key={sourceId}
                  className="flex items-center justify-between rounded-md border px-3 py-2.5"
                >
                  <span className="text-sm">{label}</span>
                  <Switch
                    checked={sourceEnabled[sourceId] !== false}
                    onCheckedChange={(checked) =>
                      setSourceEnabled((current) => ({
                        ...current,
                        [sourceId]: checked
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={busy === "save" || busy === "load"}
        >
          <Save className="size-4" />
          {busy === "save" ? "正在保存…" : "保存设置"}
        </Button>
      </CardFooter>
    </Card>
  );
};
