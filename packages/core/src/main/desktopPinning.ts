import { type BrowserWindow } from "electron";
import koffi from "koffi";

// 对照 DeskToDo 的贴底行为：.tmp/DeskToDo/deskcal/ui/desktop_overlay/overlay_window.py:267-271
// 通过 Qt.WindowStaysOnBottomHint 让悬浮窗常驻"壁纸之上、普通窗口之下"。
// Electron 没有"置底"等价 API（setAlwaysOnTop 只能置顶），因此显式调用同一 Win32 机制：
// 以 Progman（桌面壁纸/图标宿主）为基准，SetWindowPos 把窗口插到 Progman 上方——
// 注意不能插 HWND_BOTTOM（绝对底部会沉到桌面层之下、被壁纸盖住，实测踩坑），
// 也不能用 GetDesktopWindow() 枚举（对根桌面窗口取 GW_HWNDLAST 恒为 0，实测踩坑）。
// 压底时机 = 窗口创建后 + 每次获得焦点（激活会把窗口抬到普通层顶部，随后压回，
// SWP_NOACTIVATE 保证键盘焦点留在窗口内，桌历内联输入框可用）。
// 不使用 WM_WINDOWPOSCHANGING 钩子：钩子上下文里调用 koffi 会段错误（实测踩坑），
// 且 Electron 传入的 lParam Buffer 是指针值的拷贝，改写它无法影响真实 WINDOWPOS。
// 仅 Windows 生效；互操作失败时静默降级为普通窗口，不影响其余功能。

const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_NOOWNERZORDER = 0x200;
const SWP_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
// SetWindowPos 语义：窗口被插到 hWndInsertAfter 之后（= 更靠近 Z 序底部）。
// 要落在"Progman（桌面）之上、其余窗口之下"，锚必须是 Progman 的上方邻窗（GW_HWNDNEXT）。
const GW_HWNDNEXT = 2;

type SetWindowPosFn = (hWnd: number, hWndInsertAfter: number, x: number, y: number, cx: number, cy: number, flags: number) => boolean;
type GetWindowFn = (hWnd: number, cmd: number) => number;
type FindWindowFn = (cls: string | null, title: string | null) => number;
type IsWindowVisibleFn = (hWnd: number) => boolean;

let setWindowPos: SetWindowPosFn | null = null;
let getWindow: GetWindowFn | null = null;
let findWindow: FindWindowFn | null = null;
let isWindowVisible: IsWindowVisibleFn | null = null;

const loadUser32 = (): boolean => {
  if (setWindowPos && getWindow && findWindow && isWindowVisible) return true;
  try {
    // koffi 使用预编译 N-API 二进制，Electron 与 Node 通用，无需 rebuild。
    const user32 = koffi.load("user32.dll");
    setWindowPos = user32.func(
      "bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, uint32_t uFlags)"
    ) as unknown as SetWindowPosFn;
    getWindow = user32.func("intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t cmd)") as unknown as GetWindowFn;
    findWindow = user32.func("intptr_t __stdcall FindWindowW(const wchar_t* cls, const wchar_t* title)") as unknown as FindWindowFn;
    isWindowVisible = user32.func("bool __stdcall IsWindowVisible(intptr_t hWnd)") as unknown as IsWindowVisibleFn;
    return true;
  } catch {
    return false;
  }
};

// 返回"紧贴桌面上方"的窗口句柄（桌历插到它之后=它下方、桌面之上）；
// 找不到桌面参考或其上没有别的窗口时返回 0（无需压制）。
const desktopAnchor = (): number => {
  if (!getWindow || !findWindow) return 0;
  try {
    const progman = findWindow("Progman", null);
    if (!progman) return 0;
    return getWindow(progman, GW_HWNDNEXT);
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

export const pinWindowToDesktopBottom = (window: BrowserWindow): void => {
  if (process.platform !== "win32") return;
  if (!loadUser32()) return;
  const myHandle = readWindowHandle(window);
  if (myHandle === null) return;
  const repin = (): void => {
    const anchor = desktopAnchor();
    // anchor === myHandle：自己已经是"紧贴桌面上方"，无需再动。
    if (anchor === 0 || anchor === myHandle || !setWindowPos) return;
    try {
      setWindowPos(myHandle, anchor, 0, 0, 0, 0, SWP_FLAGS);
    } catch {
      // 窗口可能已销毁；忽略本次压底。
    }
  };
  window.on("focus", repin);
  repin();
  // 贴底窗口自愈：Win+D"显示桌面"会让 Explorer 直接 ShowWindow(SW_HIDE) 跳过 Electron
  // （Electron 的 isVisible() 仍返回 true，感知不到），且 skipTaskbar 工具窗没有恢复入口
  // （对照 DeskToDo 托盘"临时隐藏15秒"的 show 定时拉回）。因此守护必须查询 Win32 真实可见性。
  // 用户主动关闭走 destroy，不会触发此守护。showInactive 不抢焦点，拉回后立即压底。
  const guard = setInterval(() => {
    if (window.isDestroyed()) {
      clearInterval(guard);
      return;
    }
    try {
      const handle = readWindowHandle(window);
      if (handle === null || !isWindowVisible || isWindowVisible(handle)) return;
      // Explorer 的隐藏绕过了 Electron，其内部仍标记为可见，showInactive 会空转；
      // 先 hide() 强制两侧状态对齐，再拉回显示。
      window.hide();
      window.showInactive();
      repin();
    } catch {
      // 窗口销毁竞态；下一次 tick 由 isDestroyed 拦截。
    }
  }, 2000);
  window.on("closed", () => clearInterval(guard));
};
