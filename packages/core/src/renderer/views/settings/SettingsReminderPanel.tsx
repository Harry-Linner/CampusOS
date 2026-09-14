import { useEffect, useState } from "react";
import { useReminderSettings } from "../../hooks/useReminderSettings";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";

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
  const [reminderSaved, setReminderSaved] = useState(false);

  useEffect(() => {
    if (reminderSettings.record) {
      setReminderEnabled(reminderSettings.record.enabled);
      setSelectedLeadMinutes(reminderSettings.record.leadMinutes);
      setGradeChangesEnabled(reminderSettings.record.gradeChangesEnabled !== false);
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
                gradeChangesEnabled
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
