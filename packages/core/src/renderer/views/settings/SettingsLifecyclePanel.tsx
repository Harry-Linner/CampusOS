import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";

type CloseBehavior = "ask" | "hide-to-tray" | "quit";

/**
 * 后台与启动：开机自启、桌面通知权限与关闭主窗口行为（Batch 10 从 SettingsView 拆出）。
 */
export const SettingsLifecyclePanel = () => {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>("ask");
  const [notificationPermissionEnabled, setNotificationPermissionEnabled] = useState(true);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [lifecycleMessage, setLifecycleMessage] = useState("");

  useEffect(() => {
    void window.campusos?.lifecycle?.load().then((record) => {
      setLaunchAtLogin(record.launchAtLogin);
      setCloseBehavior(record.closeBehavior);
      setNotificationPermissionEnabled(record.notificationEnabled);
    }).catch(() => undefined);
  }, []);

  const saveLifecycleSettings = async (): Promise<void> => {
    const lifecycle = window.campusos?.lifecycle;
    if (!lifecycle) return;
    setLifecycleSaving(true);
    setLifecycleMessage("");
    try {
      const record = await lifecycle.save({
        launchAtLogin,
        closeBehavior,
        notificationEnabled: notificationPermissionEnabled,
        notificationPrompted: true
      });
      setLaunchAtLogin(record.launchAtLogin);
      setCloseBehavior(record.closeBehavior);
      setNotificationPermissionEnabled(record.notificationEnabled);
      setLifecycleMessage("后台与通知设置已保存");
    } catch (error) {
      setLifecycleMessage(error instanceof Error ? error.message : "设置保存失败。");
    } finally {
      setLifecycleSaving(false);
    }
  };

  return (
    <section className="settings-section" aria-labelledby="lifecycle-heading">
      <header className="settings-section-heading"><h2 id="lifecycle-heading">后台与启动</h2></header>
      <p className="page-copy">桌面日历与提醒随 CampusOS 运行，不会注册独立开机项。</p>
      <div className="settings-toggle-list">
        <div className="flex items-center justify-between gap-3 py-1">
          <Label htmlFor="launch-at-login">登录系统时启动 CampusOS</Label>
          <Switch id="launch-at-login" checked={launchAtLogin} onCheckedChange={setLaunchAtLogin} />
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <Label htmlFor="notification-permission">允许桌面通知</Label>
          <Switch id="notification-permission" checked={notificationPermissionEnabled} onCheckedChange={setNotificationPermissionEnabled} />
        </div>
      </div>
      <fieldset className="academic-program-fieldset">
        <legend>关闭主窗口时</legend>
        <div className="academic-program-options">
          {([ ["ask", "每次询问"], ["hide-to-tray", "隐藏到托盘"], ["quit", "退出 CampusOS"] ] as const).map(([value, label]) => (
            <label key={value} className={closeBehavior === value ? "selected" : undefined}><input type="radio" name="close-behavior" value={value} checked={closeBehavior === value} onChange={() => setCloseBehavior(value)} /><span>{label}</span></label>
          ))}
        </div>
      </fieldset>
      <div className="settings-actions"><Button type="button" disabled={lifecycleSaving} onClick={() => void saveLifecycleSettings()}>{lifecycleSaving ? "保存中" : "保存后台设置"}</Button></div>
      {lifecycleMessage ? <p className="save-note" role="status">{lifecycleMessage}</p> : null}
    </section>
  );
};
