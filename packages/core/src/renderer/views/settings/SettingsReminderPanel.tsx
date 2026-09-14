import { useEffect, useState } from "react";
import { useReminderSettings } from "../../hooks/useReminderSettings";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Input } from "../../components/ui/input";

const reminderLeadOptions = [15, 60, 120];

/**
 * 提醒：桌面通知、成绩变化通知与提前量（Batch 10 从 SettingsView 拆出）。
 *
 * 面板持有提醒设置 hook 与表单状态；父组件不再需要任何提醒相关状态。
 */
export const SettingsReminderPanel = () => {
  const reminderSettings = useReminderSettings();
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [gradeChangesEnabled, setGradeChangesEnabled] = useState(true);
  const [selectedLeadMinutes, setSelectedLeadMinutes] = useState<number[]>([15, 120]);
  const [courseReminderLeadMinutes, setCourseReminderLeadMinutes] = useState(20);
  const [departurePromptText, setDeparturePromptText] = useState("勾勾够出发喽");
  const [reminderSaved, setReminderSaved] = useState(false);

  useEffect(() => {
    if (reminderSettings.record) {
      setReminderEnabled(reminderSettings.record.enabled);
      setSelectedLeadMinutes(reminderSettings.record.leadMinutes);
      setGradeChangesEnabled(reminderSettings.record.gradeChangesEnabled !== false);
      if (reminderSettings.record.courseReminderLeadMinutes !== undefined) {
        setCourseReminderLeadMinutes(reminderSettings.record.courseReminderLeadMinutes);
      }
      if (reminderSettings.record.departurePromptText !== undefined) {
        setDeparturePromptText(reminderSettings.record.departurePromptText);
      }
    }
  }, [reminderSettings.record]);

  return (
    <section className="settings-section" aria-labelledby="reminder-heading">
      <header className="settings-section-heading">
        <h2 id="reminder-heading">提醒</h2>
      </header>

      <div className="flex items-center justify-between gap-3 py-1">
        <Label htmlFor="reminder-enabled">启用桌面通知</Label>
        <Switch
          id="reminder-enabled"
          checked={reminderEnabled}
          onCheckedChange={(checked) => {
            setReminderSaved(false);
            setReminderEnabled(checked);
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 py-1">
        <Label htmlFor="grade-changes-enabled">启用成绩变化通知</Label>
        <Switch
          id="grade-changes-enabled"
          checked={gradeChangesEnabled}
          onCheckedChange={(checked) => {
            setReminderSaved(false);
            setGradeChangesEnabled(checked);
          }}
        />
      </div>

      <div className="space-y-2 py-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="course-reminder-lead">课前提醒提前量</Label>
          <span className="text-sm text-muted-foreground font-mono">{courseReminderLeadMinutes} 分钟</span>
        </div>
        <input
          id="course-reminder-lead"
          type="range"
          min="0"
          max="120"
          step="5"
          className="w-full accent-primary cursor-pointer"
          value={courseReminderLeadMinutes}
          onChange={(event) => {
            setReminderSaved(false);
            setCourseReminderLeadMinutes(Number(event.target.value));
          }}
        />
      </div>

      <div className="space-y-1.5 py-1">
        <Label htmlFor="departure-prompt">通知底部提示文字</Label>
        <Input
          id="departure-prompt"
          value={departurePromptText}
          placeholder="勾勾够出发喽"
          onChange={(event) => {
            setReminderSaved(false);
            setDeparturePromptText(event.target.value);
          }}
        />
      </div>

      <fieldset className="reminder-options" disabled={!reminderEnabled}>
        <legend>提醒时间</legend>
        <div>
          {reminderLeadOptions.map((option) => {
            const selected = selectedLeadMinutes.includes(option);

            return (
              <label
                key={option}
                className={selected ? "reminder-option is-selected" : "reminder-option"}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) => {
                    setReminderSaved(false);
                    setSelectedLeadMinutes((current) =>
                      event.target.checked
                        ? [...current, option].sort((left, right) => left - right)
                        : current.filter((value) => value !== option)
                    );
                  }}
                />
                <span>{option === 60 ? "1 小时前" : `${option} 分钟前`}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="settings-actions">
        <Button
          type="button"
          disabled={
            reminderSettings.loading ||
            (reminderEnabled && selectedLeadMinutes.length === 0)
          }
          onClick={() => {
            void (async () => {
              const saved = await reminderSettings.save({
                enabled: reminderEnabled,
                leadMinutes: selectedLeadMinutes,
                gradeChangesEnabled,
                courseReminderLeadMinutes,
                departurePromptText: departurePromptText.trim() || "勾勾够出发喽"
              });
              setReminderSaved(saved);
            })();
          }}
        >
          {reminderSettings.loading ? "保存中" : "保存提醒"}
        </Button>
        {reminderSaved ? <span className="save-note">已保存</span> : null}
      </div>

      {reminderSettings.error ? (
        <p className="error-copy">{reminderSettings.error}</p>
      ) : null}
    </section>
  );
};
