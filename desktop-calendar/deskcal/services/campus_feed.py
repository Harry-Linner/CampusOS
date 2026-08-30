"""CampusOS 校园事件 feed 读取：从 CampusOS 主程序写入的 JSON 渲染为日程事件。

CampusOS(Electron) 把课程/考试/作业/任务写成一份只读 feed，DeskToDo 在渲染月历时
把其中的事件按类型上色叠加到对应日期上（不写回 DeskToDo 的任务库，只读展示）。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

CAMPUS_FEED_FILE_NAME = "desk-calendar-feed.json"


def get_campus_feed_path() -> Path:
    env = os.environ.get("CAMPUSOS_USER_DATA")
    if env:
        return Path(env) / CAMPUS_FEED_FILE_NAME
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home()
    return base / "CampusOS" / CAMPUS_FEED_FILE_NAME


# 类型 → 显示色（近似 CampusOS 设计 token 的 R,G,B）
KIND_COLOR = {
    "course": (49, 95, 142),      # APP_ACCENT
    "exam": (181, 69, 66),        # APP_DANGER
    "assignment": (165, 109, 34), # APP_WARNING
    "task": (53, 107, 87),        # APP_SUCCESS
}
KIND_LABEL = {
    "course": "课程", "exam": "考试", "assignment": "作业", "task": "任务",
}


@dataclass
class CampusFeedEvent:
    id: str
    title: str
    date: str  # YYYY-MM-DD
    kind: str  # course | exam | assignment | task
    time: Optional[str] = None

    @property
    def color(self) -> tuple[int, int, int]:
        return KIND_COLOR.get(self.kind, KIND_COLOR["course"])

    @property
    def label(self) -> str:
        return KIND_LABEL.get(self.kind, self.kind)


def load_campus_feed() -> list[CampusFeedEvent]:
    path = get_campus_feed_path()
    try:
        raw = path.read_text(encoding="utf-8-sig")
        payload = json.loads(raw)
    except (OSError, ValueError):
        return []
    events: list[CampusFeedEvent] = []
    for item in payload.get("events", []):
        if not isinstance(item, dict):
            continue
        day = item.get("date")
        kind = item.get("kind")
        title = item.get("title")
        if not isinstance(day, str) or not isinstance(title, str) or not isinstance(kind, str):
            continue
        if len(day) != 10 or day[4] != "-" or day[7] != "-":
            continue
        events.append(CampusFeedEvent(
            id=str(item.get("id", "")),
            title=title,
            date=day,
            kind=kind if kind in KIND_COLOR else "course",
            time=item.get("time") if isinstance(item.get("time"), str) else None,
        ))
    events.sort(key=lambda e: (e.date, e.time or "", e.title))
    return events
