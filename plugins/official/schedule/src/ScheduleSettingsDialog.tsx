import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReminderSettingsRecord } from "@campusos/shared";

interface ScheduleSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_LEAD_OPTIONS = [5, 10, 15, 20, 30, 45, 60];

export const ScheduleSettingsDialog = ({
  open,
  onOpenChange
}: ScheduleSettingsDialogProps): JSX.Element => {
  const [enabled, setEnabled] = useState(true);
  const [courseLeadMinutes, setCourseLeadMinutes] = useState(20);
  const [departurePromptText, setDeparturePromptText] = useState("勾勾够出发喽");
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [rawRecord, setRawRecord] = useState<ReminderSettingsRecord | null>(null);

  useEffect(() => {
    if (!open) {
      setSavedNote(false);
      return;
    }
    const bridge = window.campusos?.reminders;
    if (bridge?.loadSettings) {
      void bridge.loadSettings().then((rec) => {
        setRawRecord(rec);
        setEnabled(rec.enabled);
        if (typeof rec.courseReminderLeadMinutes === "number") {
          setCourseLeadMinutes(rec.courseReminderLeadMinutes);
        } else if (rec.leadMinutes && rec.leadMinutes.length > 0) {
          setCourseLeadMinutes(rec.leadMinutes[0]);
        }
        if (typeof rec.departurePromptText === "string") {
          setDeparturePromptText(rec.departurePromptText);
        }
      }).catch(() => undefined);
    }
  }, [open]);

  const handleSave = async (): Promise<void> => {
    const bridge = window.campusos?.reminders;
    if (!bridge?.saveSettings) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setSavedNote(false);
    try {
      await bridge.saveSettings({
        enabled,
        leadMinutes: rawRecord?.leadMinutes ?? [15, 120],
        gradeChangesEnabled: rawRecord?.gradeChangesEnabled !== false,
        courseReminderLeadMinutes: courseLeadMinutes,
        departurePromptText: departurePromptText.trim() || "勾勾够出发喽"
      });
      setSavedNote(true);
      setTimeout(() => {
        onOpenChange(false);
      }, 500);
    } catch {
      // Graceful fallback
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>日程与上课提醒设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <label htmlFor="course-reminder-toggle" className="text-sm font-medium">
              开启上课桌面提醒
            </label>
            <input
              id="course-reminder-toggle"
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">提前提醒时间</span>
              <span className="text-sm font-semibold text-primary">
                {courseLeadMinutes === 0 ? "准时开始" : `提前 ${courseLeadMinutes} 分钟`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={120}
              step={5}
              disabled={!enabled}
              value={courseLeadMinutes}
              onChange={(e) => setCourseLeadMinutes(Number(e.target.value))}
              className="w-full cursor-pointer accent-primary"
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_LEAD_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setCourseLeadMinutes(opt)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    courseLeadMinutes === opt
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:bg-muted"
                  }`}
                >
                  {opt} 分钟
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Windows 通知、桌面日历高亮与桌宠气泡将严格按照此时长同步联动。
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="departure-prompt-input" className="text-sm font-medium">
              自定义行前提示语（通知尾行）
            </label>
            <input
              id="departure-prompt-input"
              type="text"
              maxLength={40}
              disabled={!enabled}
              value={departurePromptText}
              placeholder="勾勾够出发喽"
              onChange={(e) => setDeparturePromptText(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-input bg-background"
            />
            <p className="text-xs text-muted-foreground">
              显示在上课提醒原生弹窗最底部，激励按时出发上课。
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          {savedNote ? <span className="text-sm text-green-600 font-medium mr-auto">已保存设置</span> : null}
          <Button variant="ghost" type="button" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={() => void handleSave()}>
            {busy ? "保存中" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
