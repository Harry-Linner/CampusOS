import type { CampusAppInfo } from "../../../shared/updateBridge";
import { Button } from "../../components/ui/button";

const mitLicenseText = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

interface SettingsAboutPanelProps {
  appInfo: CampusAppInfo | null;
}

/** 关于：应用信息、MIT 许可证全文与反馈入口（Batch 8 从 SettingsView 拆出）。 */
export const SettingsAboutPanel = ({ appInfo }: SettingsAboutPanelProps) => (
  <section className="settings-section" aria-labelledby="about-heading">
    <header className="settings-section-heading">
      <h2 id="about-heading">关于</h2>
    </header>
    <dl className="about-data">
      <div>
        <dt>应用</dt>
        <dd>{appInfo?.name ?? "CampusOS"}</dd>
      </div>
      <div>
        <dt>版本</dt>
        <dd>{appInfo ? appInfo.version : "正在读取"}</dd>
      </div>
      <div>
        <dt>许可证</dt>
        <dd>{appInfo?.licenseName ?? "MIT"}</dd>
      </div>
    </dl>
    <details className="license-disclosure">
      <summary>查看 MIT 许可证</summary>
      <pre>{`${appInfo?.copyright ?? "Copyright (c) 2026 Harry-Linner"}\n\n${mitLicenseText}`}</pre>
    </details>
    <div className="settings-actions">
      <Button
        variant="ghost"
        type="button"
        onClick={() => void window.campusos?.feedback?.openIssue()}
      >
        提交问题反馈
      </Button>
    </div>
    <p className="page-copy">反馈会打开 GitHub Issues，不会自动附带账号、课程、文件或本地诊断数据。</p>
  </section>
);
