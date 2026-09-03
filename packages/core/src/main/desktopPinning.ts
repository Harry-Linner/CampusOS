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
const SWP_SHOWWINDOW = 0x40;
const SWP_NOOWNERZORDER = 0x200;
const SWP_ASYNCWINDOWPOS = 0x4000;
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

interface User32Api {
  setWindowPos: SetWindowPosFn;
  getWindow: GetWindowFn;
  findWindow: FindWindowFn;
  isWindowVisible: IsWindowVisibleFn;
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
      isWindowVisible: user32.func("IsWindowVisible", "bool", ["uintptr_t"]) as unknown as IsWindowVisibleFn
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
const tryAttachWorkerW = (window: BrowserWindow, myHandle: number): boolean => {
  if (!api || !api.setParent || !api.getParent || !api.getWindowLongPtr || !api.setWindowLongPtr || !api.showWindow) return false;
  const host = findDeskLayerHost();
  if (!host) return false;
  try {
    api.setParent(myHandle, host);
    // 改为子窗口样式（去掉 WS_POPUP）。
    const style = (Number(api.getWindowLongPtr(myHandle, GWL_STYLE)) >>> 0) | WS_CHILD;
    api.setWindowLongPtr(myHandle, GWL_STYLE, style & ~WS_POPUP);
    const exStyle = (Number(api.getWindowLongPtr(myHandle, GWL_EXSTYLE)) >>> 0) | WS_EX_LAYERED;
    api.setWindowLongPtr(myHandle, GWL_EXSTYLE, exStyle);
    api.setWindowPos(
      myHandle, HWND_BOTTOM, 0, 0, 0, 0,
      SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS
    );
    api.showWindow(myHandle, SW_SHOWNA);
    return Number(api.getParent(myHandle)) === host;
  } catch {
    return false;
  }
};

// Win+D 自愈守护：每 2s 查真实可见性，必要时拉回（showInactive 不抢焦点，随后重新压底）。
const setupSelfHeal = (window: BrowserWindow, repin: () => void): void => {
  const guard = setInterval(() => {
    if (window.isDestroyed()) {
      clearInterval(guard);
      return;
    }
    try {
      const handle = readWindowHandle(window);
      if (handle === null || !api || !api.isWindowVisible || api.isWindowVisible(handle)) return;
      window.hide();
      window.showInactive();
      repin();
    } catch {
      // 销毁竞态；下一 tick 由 isDestroyed 拦截。
    }
  }, 2000);
  window.on("closed", () => clearInterval(guard));
};

export const pinWindowToDesktopBottom = (window: BrowserWindow): void => {
  if (process.platform !== "win32") return;
  if (!loadUser32()) return;
  const myHandle = readWindowHandle(window);
  if (myHandle === null) return;

  // 首选：嵌入壁纸层（图标之下、壁纸之上）。成功则只需自愈守护，无需 GW 压底。
  if (tryAttachWorkerW(window, myHandle)) {
    setupSelfHeal(window, () => undefined);
    return;
  }

  // 回退：老方案 —— 以 Progman 为基准，把窗口插到 GW_HWNDNEXT（壁纸之上、其它窗口之下）。
  // 压底时机 = 创建后 + 每次获得焦点（激活会抬到普通层顶部，随后压回）。
  const repin = (): void => {
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
