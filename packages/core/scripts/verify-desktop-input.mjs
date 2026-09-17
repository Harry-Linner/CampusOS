// Read-only Windows input-routing check. CDP renders through an obscuring window;
// WindowFromPoint tells us which native window would actually receive the mouse.
import { chromium } from "playwright";
import koffi from "koffi";

if (process.platform !== "win32") throw new Error("This check requires Windows.");
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CAMPUSOS_DESKTOP_CDP_PORT || Number(process.env.CAMPUSOS_DEV_CDP_PORT || "9223") + 1}`);
try {
  const pages = browser.contexts().flatMap((context) => context.pages()).filter((page) => page.url().includes("desk-calendar"));
  if (pages.length !== 1) throw new Error(`Expected one desktop calendar target, found ${pages.length}.`);
  const page = pages[0];
  const u32 = koffi.load("user32.dll");
  const session = await browser.newBrowserCDPSession();
  const info = await session.send("SystemInfo.getProcessInfo");
  const pid = info.processInfo.find(item => item.type === "browser").id;
  await session.detach();
  const parentOf = u32.func("GetParent", "uintptr_t", ["uintptr_t"]);
  const threadPid = u32.func("GetWindowThreadProcessId", "uint32", ["uintptr_t", koffi.out(koffi.pointer("uint32"))]);
  const enumType = koffi.proto("bool __stdcall DesktopInputEnum(uintptr_t hwnd, intptr_t arg)");
  const enumChildren = u32.func("EnumChildWindows", "bool", ["uintptr_t", koffi.pointer(enumType), "intptr_t"]);
  const desktopWindow = u32.func("GetDesktopWindow", "uintptr_t", []);
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
  let hwnd = 0;
  const callback = koffi.register(handle => { const id = [0]; threadPid(handle, id); if (id[0] === pid && ["WorkerW", "Progman"].includes(readClass(parentOf(handle)))) hwnd = Number(handle); return true; }, koffi.pointer(enumType));
  try { enumChildren(desktopWindow(), callback, 0); } finally { koffi.unregister(callback); }
  if (!hwnd) throw new Error("No calendar child in the desktop host.");
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
      const desktop = ["SysListView32", "SHELLDLL_DefView", "WorkerW", "Progman"].includes(targetClass);
      samples.push({ control: name, point, targetClass, result: desktop ? "desktop-layer-requires-native-routing" : "covered-by-another-window" });
    } finally {
      dpi(priorDpi);
    }
  }
  console.log(JSON.stringify({ parent: readClass(parentOf(hwnd)), samples, note: "Read-only layer check. Actual clicks, icon priority and wheel require a separate native input test." }, null, 2));
  process.exitCode = samples.every((sample) => sample.result === "desktop-layer-requires-native-routing") ? 0 : 2;
} finally {
  await browser.close();
}
