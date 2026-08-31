"""把 Qt 窗口钉入 Windows 桌面层（WorkerW），实现 Win+D"显示桌面"免疫。

参考 tauri-plugin-desktop-underlay / Lively 的做法：
1. 向 Progman 发 0x052C 触发 WorkerW 创建；
2. 枚举顶层窗口找到包含 SHELLDLL_DefView 的 WorkerW；
3. SetParent(hwnd, workerW)，窗口并入桌面层 → 不再被 Win+D 隐藏。

仅在 Windows 生效；其他平台降级为普通窗口。
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from typing import Optional

user32 = ctypes.windll.user32

_EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def _find_workerw() -> Optional[int]:
    progman = user32.FindWindowW("Progman", None)
    # 触发 WorkerW 创建
    user32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 0x03E8, ctypes.byref(ctypes.c_ulong()))

    found: list[int] = []

    def _cb(hwnd, _lparam):
        shell_view = user32.FindWindowExW(hwnd, 0, "SHELLDLL_DefView", None)
        if shell_view:
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(_EnumWindowsProc(_cb), 0)
    if not found:
        return None
    return found[0]


def pin_window_to_desktop(hwnd: int) -> bool:
    """把窗口钉入 WorkerW 桌面层。成功返回 True；出错返回 False（降级为普通窗口）。"""
    try:
        workerw = _find_workerw()
        if not workerw:
            return False
        user32.SetParent(hwnd, workerw)
        # 保持 READONLY/不抢焦点的一些附加；关键是把窗口并到桌面层。
        user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004)  # SWP_NOSIZE|NOMOVE|NOZORDER
        return True
    except Exception:
        return False
