import { type BrowserWindow } from "electron";
import koffi from "koffi";

// 桌面日历贴底（Windows）。
//
// 目标层级：图标下方、壁纸上方（与 DesktopCal 一致）。
// Electron 没有"置底/贴桌面"的等价 API（setAlwaysOnTop 只能置顶），因此显式调用 Win32。
//
// 两条路径：
//  1) 首选 —— 嵌入 WorkerW 壁纸层（对照外部实现：luma-wallpaper / gallery2 / pomodoro-flow，
//     出处 Flying Bird Wallpaper 的 AttachToDesktop 思路）。流程：
//     FindWindowW("Progman") → SendMessageTimeoutW(WM_SPAWN_WORKERW, 0x052C) 强制 Explorer 生成
//     壁纸 WorkerW → EnumWindows 找到"其兄弟窗口含 SHELLDLL_DefView"的那个 WorkerW
//     → SetParent(ourHwnd, workerW) 把窗口挂到图标之下、壁纸之上。
//     注意：绝不能加 WS_EX_TRANSPARENT（会把整个窗口点击穿透，桌历便无法交互）。
//  2) 回退 —— 老方案：以 Progman 为基准 SetWindowPos 插到 GW_HWNDNEXT（壁纸之上、其它窗口之下）。
//
// 自愈守护：Win+D"显示桌面"会绕过 Electron 直接 ShowWindow(SW_HIDE)（isVisible 仍 true），
// 且 skipTaskbar 工具窗无恢复入口，故每 2s 查一次 Win32 真实可见性，必要时拉回。
// 用户主动关闭走 destroy，不会触发守护。仅 Windows 生效；互操作失败静默降级。

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_EX_LAYERED = 0x00080000;
const HWND_BOTTOM = 1;
const WM_SPAWN_WORKERW = 0x052C;
const SMTO_NORMAL = 0;
const SW_SHOWNA = 8;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x40;
const SWP_NOOWNERZORDER = 0x200;
const SWP_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
const GW_HWNDNEXT = 2;

type SetWindowPosFn = (hWnd: number, hWndInsertAfter: number, x: number, y: number, cx: number, cy: number, flags: number) => boolean;
type GetWindowFn = (hWnd: number, cmd: number) => number;
type FindWindowFn = (cls: string | null, title: string | null) => number;
type IsWindowVisibleFn = (hWnd: number) => boolean;
type FindWindowExFn = (parent: number, childAfter: number, cls: string | null, title: string | null) => number;
type SendMessageTimeoutFn = (hWnd: number, msg: number, wparam: number, lparam: number, flags: number, timeout: number, result: number | null) => number;
type EnumWindowsFn = (cb: unknown, lparam: number) => number;
type SetParentFn = (child: number, parent: number) => number;
type GetParentFn = (hWnd: number) => number;
type GetWindowLongPtrFn = (hWnd: number, index: number) => number;
type SetWindowLongPtrFn = (hWnd: number, index: number, value: number) => number;
type ShowWindowFn = (hWnd: number, cmd: number) => boolean;
type GetWindowRectFn = (hWnd: number, rect: Buffer) => boolean;

interface User32Api {
  setWindowPos: SetWindowPosFn;
  getWindow: GetWindowFn;
  findWindow: FindWindowFn;
  isWindowVisible: IsWindowVisibleFn;
  getWindowRect: GetWindowRectFn;
  findWindowEx?: FindWindowExFn;
  sendMessageTimeout?: SendMessageTimeoutFn;
  enumWindows?: EnumWindowsFn;
  setParent?: SetParentFn;
  getParent?: GetParentFn;
  getWindowLongPtr?: GetWindowLongPtrFn;
  setWindowLongPtr?: SetWindowLongPtrFn;
  showWindow?: ShowWindowFn;
  enumCallback?: unknown;
}

let api: User32Api | null = null;

const loadUser32 = (): boolean => {
  if (api) return true;
  try {
    const user32 = koffi.load("user32.dll");
    const basic: User32Api = {
      setWindowPos: user32.func("SetWindowPos", "bool", ["uintptr_t", "uintptr_t", "int", "int", "int", "int", "uint32"]) as unknown as SetWindowPosFn,
      getWindow: user32.func("GetWindow", "uintptr_t", ["uintptr_t", "uint32"]) as unknown as GetWindowFn,
      findWindow: user32.func("intptr_t __stdcall FindWindowW(const wchar_t* cls, const wchar_t* title)") as unknown as FindWindowFn,
      isWindowVisible: user32.func("IsWindowVisible", "bool", ["uintptr_t"]) as unknown as IsWindowVisibleFn,
      getWindowRect: user32.func("GetWindowRect", "bool", ["uintptr_t", "void*"]) as unknown as GetWindowRectFn
    };
    // 壁纸层（WorkerW）相关函数需要 koffi 的 proto/register/pointer 回调能力。
    // 不满足时静默跳过，仅保留基础函数，回退到 Progman/GW_HWNDNEXT 方案。
    try {
      const proto = koffi.proto("__stdcall", "EnumWindowsProc", "int32", ["uintptr_t", "intptr_t"]);
      const findWindowEx = user32.func("intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t childAfter, const wchar_t* cls, const wchar_t* title)") as unknown as FindWindowExFn;
      const enumCallback = koffi.register(
        (topLevelWindow: number) => {
          try {
            if (!workerwHost) {
              if (findWindowEx(topLevelWindow, 0, "SHELLDLL_DefView", null)) {
                const nextWorker = findWindowEx(0, topLevelWindow, "WorkerW", null);
                if (nextWorker) workerwHost = Number(nextWorker);
              }
            }
          } catch {
            // 枚举回调内异常：继续枚举，避免从 native 回调传播导致崩溃。
          }
          return 1;
        },
        koffi.pointer(proto)
      );
      basic.findWindowEx = findWindowEx;
      basic.sendMessageTimeout = user32.func("SendMessageTimeoutW", "intptr_t", ["uintptr_t", "uint32", "uintptr_t", "intptr_t", "uint32", "uint32", "void*"]) as unknown as SendMessageTimeoutFn;
      basic.enumWindows = user32.func("EnumWindows", "int32", [koffi.pointer(proto), "intptr_t"]) as unknown as EnumWindowsFn;
      basic.setParent = user32.func("SetParent", "uintptr_t", ["uintptr_t", "uintptr_t"]) as unknown as SetParentFn;
      basic.getParent = user32.func("GetParent", "uintptr_t", ["uintptr_t"]) as unknown as GetParentFn;
      basic.getWindowLongPtr = user32.func("GetWindowLongPtrW", "intptr_t", ["uintptr_t", "int32"]) as unknown as GetWindowLongPtrFn;
      basic.setWindowLongPtr = user32.func("SetWindowLongPtrW", "intptr_t", ["uintptr_t", "int32", "intptr_t"]) as unknown as SetWindowLongPtrFn;
      basic.showWindow = user32.func("ShowWindow", "bool", ["uintptr_t", "int32"]) as unknown as ShowWindowFn;
      basic.enumCallback = enumCallback;
    } catch {
      // 回调能力不可用：跳过壁纸层，保留基础函数。
    }
    api = basic;
    return true;
  } catch {
    return false;
  }
};

// 找到容纳壁纸的 WorkerW（图标之下、壁纸之上那一层）。找不到返回 0。
let workerwHost = 0;
const findDeskLayerHost = (): number => {
  if (!api || !api.findWindow || !api.sendMessageTimeout || !api.enumWindows) return 0;
  try {
    const progman = api.findWindow("Progman", null);
    if (!progman) return 0;
    workerwHost = 0;
    // 向 Progman 发 WM_SPAWN_WORKERW，强制 Explorer 在图标下生成壁纸 WorkerW 层。
    api.sendMessageTimeout(progman, WM_SPAWN_WORKERW, 0, 0, SMTO_NORMAL, 1000, null);
    if (api.enumWindows(api.enumCallback, 0) === 0) return 0;
    // 回退：找不到 WorkerW 时退化为 Progman（Explorer 变体没有 WorkerW 层）。
    return workerwHost || progman;
  } catch {
    return 0;
  }
};

const readWindowHandle = (window: BrowserWindow): number | null => {
  try {
    const handle = window.getNativeWindowHandle();
    if (handle.length < 8) return null;
    const value = handle.readBigUInt64LE(0);
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  } catch {
    return null;
  }
};

// 把窗口嵌入壁纸层（WorkerW/Progman）。返回是否成功。
// 注意：保留 Electron 已有的 WS_EX_LAYERED（透明），但绝不加 WS_EX_TRANSPARENT（会点击穿透）。
// 坐标用物理像素（GetWindowRect/SetWindowPos 同空间）且减去 WorkerW 父窗口的屏幕原点，
// 避免 DIP↔物理像素 + SetParent 后坐标相对父 client 的偏移导致"跑到屏幕外"。
const getPhysRect = (hwnd: number): { l: number; t: number; r: number; b: number } => {
  const buf = Buffer.alloc(16);
  api?.getWindowRect?.(hwnd, buf);
  return { l: buf.readInt32LE(0), t: buf.readInt32LE(4), r: buf.readInt32LE(8), b: buf.readInt32LE(12) };
};
const tryAttachWorkerW = (window: BrowserWindow, myHandle: number): boolean => {
  if (!api || !api.setParent || !api.getParent || !api.getWindowLongPtr || !api.setWindowLongPtr || !api.showWindow || !api.getWindowRect) return false;
  const host = findDeskLayerHost();
  if (!host) return false;
  try {
    const prevPhys = getPhysRect(myHandle); // 挂载前物理屏幕矩形
    const origStyle = Number(api.getWindowLongPtr(myHandle, GWL_STYLE)) >>> 0;
    const origEx = Number(api.getWindowLongPtr(myHandle, GWL_EXSTYLE)) >>> 0;
    api.setParent(myHandle, host);
    // 改为子窗口样式（去掉 WS_POPUP）。
    api.setWindowLongPtr(myHandle, GWL_STYLE, (origStyle | WS_CHILD) & ~WS_POPUP);
    api.setWindowLongPtr(myHandle, GWL_EXSTYLE, origEx | WS_EX_LAYERED);
    // 物理坐标对齐：目标相对父(WorkerW) client = 目标屏幕 - 父屏幕原点。
    const hostRect = getPhysRect(host);
    const width = prevPhys.r - prevPhys.l;
    const height = prevPhys.b - prevPhys.t;
    api.setWindowPos(
      myHandle, HWND_BOTTOM, prevPhys.l - hostRect.l, prevPhys.t - hostRect.t, width, height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
    );
    api.showWindow(myHandle, SW_SHOWNA);
    // 兜底：若 SetParent 后坐标被拖到明显偏离(如多屏/混合 DPI 环境)，还原为普通顶层窗口并回退 GW 方案，避免看不到。
    const after = getPhysRect(myHandle);
    if (Math.abs(after.l - prevPhys.l) > 300 || Math.abs(after.t - prevPhys.t) > 300) {
      api.setParent(myHandle, 0);
      api.setWindowLongPtr(myHandle, GWL_STYLE, origStyle);
      api.setWindowLongPtr(myHandle, GWL_EXSTYLE, origEx);
      return false;
    }
    return Number(api.getParent(myHandle)) === host;
  } catch {
    return false;
  }
};

// Win+D 显示桌面自愈：Electron 窗口会被 Explorer ShowWindow(SW_HIDE) 隐藏（isVisible 仍为 true 绕过感知）。
// 这里用两条路保证桌历不消失：
//  1) 即时：监听 Electron 'hide' 事件（系统把原生窗口隐藏时触发），立即把窗口拉回可见；
//  2) 兜底：每 500ms 查一次 Win32 真实可见性（IsWindowVisible），必要时 hide()+showInactive() 拉回。
const setupSelfHeal = (window: BrowserWindow, repin: () => void): void => {
  const pullBack = (): void => {
    if (window.isDestroyed()) return;
    try {
      const handle = readWindowHandle(window);
      if (handle === null || (api && api.isWindowVisible && api.isWindowVisible(handle))) return;
      // 强制两侧状态对齐后重新显示，避免 showInactive 空转。
      window.hide();
      window.showInactive();
      repin();
    } catch {
      // 销毁竞态；忽略。
    }
  };
  const onHide = (): void => {
    // Win+D 隐藏会触发 hide 事件：先同步两侧状态，再立即拉回可见。
    try {
      if (window.isDestroyed()) return;
      window.showInactive();
      repin();
    } catch {
      // 忽略。
    }
  };
  window.on("hide", onHide);
  window.on("closed", () => window.removeListener("hide", onHide));
  const guard = setInterval(pullBack, 500);
  window.on("closed", () => clearInterval(guard));
};

// 贴底层级开关：true=尝试 WorkerW 桌面层挂载（真 Win+D 免疫）；false=只用 GW_HWNDNEXT 贴底（窗口稳定可见）。
// Win+D 免疫另交由专门处理(用户安排)；为避免内置桌面层挂载导致日历打不开/跑到屏幕外，
// 这里默认关闭以保证日历稳定可见、可打开。需要真机 Win+D 免疫时再置 true。
const ENABLE_WORKERW_ATTACH = false;

export const pinWindowToDesktopBottom = (window: BrowserWindow): void => {
  if (process.platform !== "win32") return;
  if (!loadUser32()) return;
  const myHandle = readWindowHandle(window);
  if (myHandle === null) return;

  // 可选：嵌入壁纸层（图标之下、壁纸之上）。成功则只需自愈守护，无需 GW 压底。
  if (ENABLE_WORKERW_ATTACH && tryAttachWorkerW(window, myHandle)) {
    setupSelfHeal(window, () => undefined);
    return;
  }

  // 兜底（默认）：以 Progman 为基准，把窗口插到 GW_HWNDNEXT（壁纸之上、其它窗口之下）。
  // 压底时机 = 创建后 + 每次获得焦点（激活会抬到普通层顶部，随后压回）。
  const repin = (): void => {
    if (window.isAlwaysOnTop()) return; // 置顶时保持置顶，不压回底部
    if (!api || !api.getWindow || !api.findWindow) return;
    try {
      const progman = api.findWindow("Progman", null);
      if (!progman) return;
      const anchor = api.getWindow(progman, GW_HWNDNEXT);
      if (anchor === 0 || anchor === myHandle) return;
      api.setWindowPos(myHandle, anchor, 0, 0, 0, 0, SWP_FLAGS);
    } catch {
      // 窗口可能已销毁；忽略本次压底。
    }
  };
  window.on("focus", repin);
  repin();
  setupSelfHeal(window, repin);
};
