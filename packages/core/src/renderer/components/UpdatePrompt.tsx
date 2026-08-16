import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/updateBridge";

export const UpdatePrompt = (): JSX.Element | null => {
  const bridge = window.campusos?.updates;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    let active = true;
    void bridge.getAppInfo().then((info) => { if (active) setCurrentVersion(info.version); });
    void bridge.getStatus().then((next) => { if (active) setStatus(next); });
    const unsubscribe = bridge.subscribe((next) => { if (active) setStatus(next); });
    return () => { active = false; unsubscribe(); };
  }, [bridge]);

  if (!bridge || status?.state !== "available" || status.prompt !== true || !status.version) return null;

  const download = async (): Promise<void> => {
    setBusy(true);
    try { setStatus(await bridge.download()); } finally { setBusy(false); }
  };
  const dismiss = async (): Promise<void> => {
    setBusy(true);
    try { setStatus(await bridge.dismiss(status.version as string)); } finally { setBusy(false); }
  };

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section className="update-prompt" role="dialog" aria-modal="true" aria-labelledby="update-prompt-heading">
        <header>
          <div>
            <span className="eyebrow">\u66f4\u65b0</span>
            <h2 id="update-prompt-heading">\u53d1\u73b0\u65b0\u7248\u672c v{status.version}</h2>
          </div>
          <span className="update-prompt-current">\u5f53\u524d v{currentVersion ?? "—"}</span>
        </header>
        <p>\u66f4\u65b0\u4e0d\u4f1a\u5220\u9664\u4efb\u52a1\u3001\u901a\u77e5\u3001\u7a97\u53e3\u5e03\u5c40\u6216\u684c\u9762\u65e5\u5386\u72b6\u6001\u3002\u53ea\u6709\u4f60\u9009\u62e9\u201c\u73b0\u5728\u66f4\u65b0\u201d\u540e\u624d\u4f1a\u5f00\u59cb\u4e0b\u8f7d\u3002</p>
        {status.releaseNotes?.length ? (
          <div className="update-prompt-notes">
            <ul>{status.releaseNotes.slice(0, 5).map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
            {status.releaseNotes.length > 5 ? <button className="text-button" type="button" onClick={() => setShowNotes((value) => !value)}>
              {showNotes ? "\u6536\u8d77\u5b8c\u6574\u65e5\u5fd7" : "\u67e5\u770b\u5b8c\u6574\u65e5\u5fd7"}
            </button> : null}
            {showNotes ? <ul>{status.releaseNotes.slice(5).map((note, index) => <li key={`${index + 5}-${note}`}>{note}</li>)}</ul> : null}
          </div>
        ) : null}
        <footer>
          <button className="text-button" type="button" disabled={busy} onClick={() => void dismiss()}>\u7a0d\u540e</button>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void download()}>{busy ? "\u51c6\u5907\u4e2d" : "\u73b0\u5728\u66f4\u65b0"}</button>
        </footer>
      </section>
    </div>
  );
};
