import { useEffect, useState } from "react";
import type { AcademicProgram } from "../../../shared/credentialBridge";
import { useAcademicCredential } from "../../hooks/useAcademicCredential";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { formatVerificationTime } from "./format";

const formatPoints = (value: number): string =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

interface SettingsAccountPanelProps {
  /** 认证成功后刷新工作区，与「数据」分类里的刷新共用同一条链路。 */
  onRefreshData: () => Promise<void>;
}

/**
 * 账号：培养层次、统一认证连接、认证回执与退出（Batch 9 从 SettingsView 拆出）。
 *
 * 面板自己持有认证 hook 与表单状态 —— 这些在父组件里只服务于这一段 UI。
 */
export const SettingsAccountPanel = ({ onRefreshData }: SettingsAccountPanelProps) => {
  const academicCredential = useAcademicCredential();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [program, setProgram] = useState<AcademicProgram>("undergraduate");

  const authenticatedProfile =
    academicCredential.record?.verificationState === "verified" &&
    academicCredential.record.username === username.trim() &&
    academicCredential.record.program === program &&
    password.length === 0
      ? academicCredential.record.authenticatedProfile
      : null;

  useEffect(() => {
    if (academicCredential.record?.username) {
      setUsername(academicCredential.record.username);
    }
    if (academicCredential.record?.program) {
      setProgram(academicCredential.record.program);
    }
  }, [academicCredential.record?.program, academicCredential.record?.username]);

  return (
    <section className="settings-section" aria-labelledby="account-heading">
      <header className="settings-section-heading">
        <h2 id="account-heading">账号</h2>
      </header>

      <fieldset
        className="academic-program-fieldset"
        disabled={academicCredential.loading}
      >
        <legend>培养层次</legend>
        <div className="academic-program-options">
          <label
            className={program === "undergraduate" ? "selected" : undefined}
          >
            <input
              type="radio"
              name="academic-program"
              value="undergraduate"
              checked={program === "undergraduate"}
              onChange={() => setProgram("undergraduate")}
            />
            <span>
              <strong>本科生</strong>
              <small>验证本科教务与素拓业务数据</small>
            </span>
          </label>
          <label className={program === "graduate" ? "selected" : undefined}>
            <input
              type="radio"
              name="academic-program"
              value="graduate"
              checked={program === "graduate"}
              onChange={() => setProgram("graduate")}
            />
            <span>
              <strong>研究生</strong>
              <small>验证研究生院 token 与成绩数据</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="settings-fields">
        <div className="field-stack">
          <Label htmlFor="account-username">学号 / 统一认证账号</Label>
          <Input
            id="account-username"
            type="text"
            autoComplete="username"
            disabled={academicCredential.loading}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="输入账号"
          />
        </div>

        <div className="field-stack">
          <Label htmlFor="account-password">密码</Label>
          <Input
            id="account-password"
            type="password"
            autoComplete="current-password"
            disabled={academicCredential.loading}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={academicCredential.record?.configured ? "输入新密码" : "输入密码"}
          />
        </div>
      </div>
      <div className="settings-actions">
        <Button
          type="button"
          disabled={
            academicCredential.loading ||
            username.trim().length === 0 ||
            password.length === 0
          }
          onClick={() => {
            void (async () => {
              try {
                await academicCredential.connect({
                  username,
                  password,
                  program
                });
                setPassword("");
                await onRefreshData();
              } catch {
                // The hook renders the sanitized main-process error below.
              }
            })();
          }}
        >
          {academicCredential.loading
            ? academicCredential.record === null
              ? "读取账号…"
              : "连接中…"
            : "连接并保存"}
        </Button>
        {academicCredential.record?.verificationState === "verified" &&
        academicCredential.record.username === username.trim() &&
        academicCredential.record.program === program &&
        password.length === 0 ? (
          <span className="save-note" role="status" aria-live="polite">
            已验证并安全保存
          </span>
        ) : null}
      </div>

      <div className="settings-actions">
        <Button variant="ghost" className="text-destructive" type="button" disabled={academicCredential.loading} onClick={() => { if (!window.confirm("退出当前账号并返回初始引导？本地数据会保留并隐藏，重新登录此账号后恢复。")) return; void academicCredential.clear().then(() => { setUsername(""); setPassword(""); }).catch(() => undefined); }}>退出当前账号</Button>
      </div>

      {authenticatedProfile ? (
        <section
          className="credential-proof"
          aria-label="统一认证业务数据回执"
        >
          <header className="credential-proof-heading">
            <div>
              <strong>认证后业务数据已返回</strong>
              <span>
                {authenticatedProfile.source === "zju-quality-development"
                  ? "浙江大学素质拓展平台 · getMyInfo"
                  : "浙江大学研究生院 · 成绩数据接口"}
              </span>
            </div>
            <time dateTime={authenticatedProfile.fetchedAt}>
              {formatVerificationTime(authenticatedProfile.fetchedAt)}
            </time>
          </header>

          <dl className="credential-proof-data">
            <div>
              <dt>
                {authenticatedProfile.source === "zju-quality-development"
                  ? "返回学号"
                  : "认证账号"}
              </dt>
              <dd>{authenticatedProfile.studentId}</dd>
            </div>
            {authenticatedProfile.source === "zju-quality-development" ? (
              <>
                <div>
                  <dt>第二课堂</dt>
                  <dd>{formatPoints(authenticatedProfile.secondClassPoints)}</dd>
                </div>
                <div>
                  <dt>第三课堂</dt>
                  <dd>{formatPoints(authenticatedProfile.thirdClassPoints)}</dd>
                </div>
                <div>
                  <dt>第四课堂</dt>
                  <dd>{formatPoints(authenticatedProfile.fourthClassPoints)}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>验证数据</dt>
                  <dd>研究生成绩记录</dd>
                </div>
                <div>
                  <dt>返回记录</dt>
                  <dd>{authenticatedProfile.recordCount} 条</dd>
                </div>
              </>
            )}
          </dl>

          <p>
            {authenticatedProfile.source === "zju-quality-development"
              ? "以上数值来自本次认证后的业务接口返回，不是客户端生成的连接提示。"
              : "以上记录数来自本次认证后的研究生院响应；token 与成绩正文不会进入页面。"}
          </p>
        </section>
      ) : null}

      {academicCredential.record?.verificationState === "unverified" ? (
        <p className="error-copy" role="status">
          旧版保存的账号尚未经过统一认证验证，请重新连接。
        </p>
      ) : null}

      {academicCredential.error ? (
        <p className="error-copy" role="alert">
          {academicCredential.error}
        </p>
      ) : null}
    </section>
  );
};
