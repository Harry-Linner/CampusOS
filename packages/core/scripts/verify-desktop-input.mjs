// Read-only Windows input-routing check. CDP renders through an obscuring window;
// WindowFromPoint tells us which native window would actually receive the mouse.
import { chromium } from "playwright";
import koffi from "koffi";

if (process.platform !== "win32") throw new Error("This check requires Windows.");
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CAMPUSOS_DEV_CDP_PORT || "9223"}`);
try {
  const pages = browser.contexts().flatMap((context) => context.pages()).filter((page) => page.url().includes("desk-calendar"));
  if (pages.length !== 1) throw new Error(`Expected one desktop calendar target, found ${pages.length}.`);
  const page = pages[0];
  const u32 = koffi.load("user32.dll");
  const find = u32.func("intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const wchar_t* cls, const wchar_t* title)");
  const hwnd = Number(find(0, 0, "Chrome_WidgetWin_1", "桌面日历"));
  if (!hwnd || find(0, hwnd, "Chrome_WidgetWin_1", "桌面日历")) throw new Error("Expected one top-level calendar HWND. A WorkerW child fails this gate.");
  const getRoot = u32.func("GetAncestor", "uintptr_t", ["uintptr_t", "uint32"]);
  const className = u32.func("GetClassNameW", "int", ["uintptr_t", "void*", "int"]);
  const getClientRect = u32.func("GetClientRect", "bool", ["uintptr_t", "void*"]);
  const toScreen = u32.func("ClientToScreen", "bool", ["uintptr_t", "void*"]);
  const pointType = koffi.struct({ x: "int", y: "int" });
  const hit = u32.func("WindowFromPoint", "uintptr_t", [pointType]);
  const dpi = u32.func("SetThreadDpiAwarenessContext", "intptr_t", ["intptr_t"]);
  const readClass = (handle) => {
    const buffer = Buffer.alloc(512);
    return buffer.toString("utf16le", 0, className(handle, buffer, 256) * 2);
  };
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const samples = [];
  for (const name of ["周", "日", "今天"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    if (!box) throw new Error(`Missing visible control: ${name}`);
    // Keep the native calls synchronous within one DPI context. No user data,
    // screenshots, focus changes, synthetic clicks or window reordering here.
    const priorDpi = dpi(-4);
    try {
      const rect = Buffer.alloc(16);
      const origin = Buffer.alloc(8);
      if (!getClientRect(hwnd, rect) || !toScreen(hwnd, origin)) throw new Error("Cannot read calendar geometry.");
      const point = {
        x: Math.round(origin.readInt32LE(0) + (box.x + box.width / 2) * rect.readInt32LE(8) / viewport.width),
        y: Math.round(origin.readInt32LE(4) + (box.y + box.height / 2) * rect.readInt32LE(12) / viewport.height)
      };
      const target = Number(hit(point));
      const targetClass = readClass(target);
      const routed = Number(getRoot(target, 2)) === hwnd;
      samples.push({ control: name, point, targetClass, result: routed ? "calendar" : ["SysListView32", "SHELLDLL_DefView", "WorkerW", "Progman"].includes(targetClass) ? "desktop-intercepts-input" : "covered-by-another-window" });
    } finally {
      dpi(priorDpi);
    }
  }
  console.log(JSON.stringify({ samples }, null, 2));
  process.exitCode = samples.every((sample) => sample.result === "calendar") ? 0
    : samples.some((sample) => sample.result === "desktop-intercepts-input") ? 1 : 2;
} finally {
  await browser.close();
}
