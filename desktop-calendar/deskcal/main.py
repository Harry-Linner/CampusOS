"""程序入口：贴底层日历窗口 + 系统托盘，无控制台（打包时配合 --noconsole）。

首次运行（检测不到 onboarding_completed 标记）时先弹引导向导，填完/跳过后才进入正常流程。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import QApplication

from deskcal.core.storage import TaskStore, load_appearance
from deskcal.services import autostart
from deskcal.services.lunar_holiday import ensure_default_holidays_seeded
from deskcal.tray.tray_icon import TrayIcon
from deskcal.ui.desktop_overlay.overlay_window import OverlayWindow
from deskcal.ui.desktop_overlay.widgets.registry import WidgetConfigStore
from deskcal.ui.onboarding.wizard import OnboardingWizard
from deskcal.utils import crypto
from deskcal.utils.desktop_pin import pin_window_to_desktop
from deskcal.utils.icons import app_icon


def _visibility_path() -> Path:
    env = os.environ.get("CAMPUSOS_USER_DATA")
    if env:
        return Path(env) / "desk-calendar-visible.json"
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home()
    return base / "CampusOS" / "desk-calendar-visible.json"


def _apply_visibility(window: OverlayWindow) -> bool:
    """CampusOS 懒加载：读取可见标志并 hide/show 窗口。仅在存在标志文件时控制（不影响独立使用）。"""
    path = _visibility_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return False
    visible = payload.get("visible", True) is True
    if visible and not window.isVisible():
        window.show()
        window.raise_()
        window.activateWindow()
    elif not visible and window.isVisible():
        window.hide()
    return True


def main() -> None:
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    app.setWindowIcon(app_icon())
    ensure_default_holidays_seeded()

    if not crypto.is_onboarding_completed():
        widget_store = WidgetConfigStore()
        widget_store.load()
        wizard = OnboardingWizard(widget_store)
        wizard.exec()

    store = TaskStore()
    store.load()

    window = OverlayWindow(store)
    window.show()
    # 由 CampusOS 托盘启用时跳到前台，让用户立刻看到；用户可自行移动/贴合。
    window.raise_()
    window.activateWindow()
    # Win+D"显示桌面"免疫：把窗口钉入桌面层(WorkerW)，Win+D 后它在桌面可见、不会消失。
    pin_window_to_desktop(int(window.winId()))
    # 懒加载：轮询 CampusOS 的可见标志，实现"关闭=隐藏、唤起=显示"（进程常驻，不冷启动）。
    visibility_timer = QTimer()
    visibility_timer.timeout.connect(lambda: _apply_visibility(window))
    visibility_timer.start(800)
    app.aboutToQuit.connect(window.persist_geometry)

    tray = TrayIcon(window)
    tray.show()

    if load_appearance()["autostart_enabled"]:
        autostart.enable_autostart()
    else:
        autostart.disable_autostart()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
