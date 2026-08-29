import { useEffect, useState, type ReactNode } from "react";
import type {
  DeskCalendarWidgetData,
  DeskCalendarWeather
} from "@campusos/shared";
import "./desk-calendar-widget.css";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const weatherEmoji = (code: number): string => {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌡️";
};

const weatherText = (code: number): string => {
  if (code === 0) return "晴";
  if (code === 1 || code === 2) return "多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 67) return "雨";
  if (code >= 71 && code <= 77) return "雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code >= 85 && code <= 86) return "阵雪";
  if (code >= 95) return "雷雨";
  return "未知";
};

/** DeskToDo 式最高/最低温折线图（SVG 自绘，不引入图表库；与桌历主窗同构）。 */
const TemperatureChart = ({ days }: { days: ReadonlyArray<{ date: string; tempMax: number; tempMin: number }> }): ReactNode => {
  if (days.length < 2) return null;
  const all = days.flatMap((day) => [day.tempMax, day.tempMin]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(max - min, 1);
  const width = 224;
  const height = 40;
  const padX = 10;
  const padTop = 8;
  const padBottom = 4;
  const x = (index: number): number => padX + (index / (days.length - 1)) * (width - padX * 2);
  const y = (value: number): number => padTop + (1 - (value - min) / span) * (height - padTop - padBottom);
  const highPoints = days.map((day, index) => `${x(index)},${y(day.tempMax)}`).join(" ");
  const lowPoints = days.map((day, index) => `${x(index)},${y(day.tempMin)}`).join(" ");
  return (
    <svg className="desk-cal-weather-chart" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="未来四天最高最低温折线图" preserveAspectRatio="none">
      <polyline points={highPoints} fill="none" stroke="#ff7043" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={lowPoints} fill="none" stroke="#42a5f5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {days.map((day, index) => (
        <g key={day.date}>
          <circle cx={x(index)} cy={y(day.tempMax)} r="2.5" fill="#ff7043" />
          <circle cx={x(index)} cy={y(day.tempMin)} r="2.5" fill="#42a5f5" />
        </g>
      ))}
    </svg>
  );
};

export interface DeskCalendarWidgetWindowApi {
  loadData: () => Promise<DeskCalendarWidgetData>;
  refreshWeather: () => Promise<DeskCalendarWeather>;
  saveSettings: (patch: Partial<DeskCalendarWidgetData>) => Promise<unknown>;
  close: () => Promise<unknown>;
  subscribe: (listener: () => void) => () => void;
}

export const DeskCalendarWidgetApp = ({ api }: { api: DeskCalendarWidgetWindowApi }): ReactNode => {
  const [data, setData] = useState<DeskCalendarWidgetData | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      api.loadData().then((next) => {
        if (active) setData(next);
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "组件数据读取失败。");
      });
    };
    void load();
    const unsubscribe = api.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const shell = (content: ReactNode): ReactNode => (
    <div className="desk-widget-shell" style={{ opacity: data?.appearance.opacity ?? 0.92 }}>
      <button className="desk-widget-close" type="button" aria-label="关闭组件" onClick={() => void api.close()}>×</button>
      {content}
    </div>
  );

  if (!data) {
    return shell(<p className="desk-widget-empty-hint">{error ?? "加载中…"}</p>);
  }

  const timeLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(now);

  if (data.id === "clock") {
    return shell(
      <div className="desk-cal-widget desk-cal-widget-clock">
        <span className="desk-cal-clock-time">{timeLabel}</span>
      </div>
    );
  }

  if (data.id === "weather") {
    const weather = data.weather;
    const relativeTime = weather?.cachedAt ? (() => {
      const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(weather.cachedAt)) / 1000));
      if (seconds < 60) return "刚刚更新";
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
      return `${Math.floor(seconds / 3600)} 小时前`;
    })() : "尚未刷新";
    const forecastDays = (weather?.forecast ?? []).map((day) => {
      const parsed = new Date(`${day.date}T00:00:00`);
      const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: SHANGHAI_TIME_ZONE, weekday: "short" }).format(parsed);
      return { ...day, weekday };
    });
    return shell(
      <div className="desk-cal-widget desk-cal-weather">
        <div className="desk-cal-weather-head">
          <strong>{weather?.location ?? "天气"}</strong>
          <span>{weather ? `${weather.temperatureC.toFixed(0)}° ${weatherText(weather.weatherCode)}` : "未配置城市"}</span>
          <small>{relativeTime}</small>
          <button type="button" aria-label="刷新天气" onClick={() => {
            api.refreshWeather().then((next) => {
              setData((current) => current ? { ...current, weather: next } : current);
              setError(null);
            }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "天气刷新失败。"));
          }}>⟳</button>
        </div>
        {forecastDays.length > 0 ? (
          <div className="desk-cal-weather-days">
            {forecastDays.map((day, index) => (
              <div className="desk-cal-weather-day" key={day.date}>
                <span>{index === 0 ? "今天" : day.weekday}</span>
                <i aria-hidden="true">{weatherEmoji(day.weatherCode)}</i>
                <strong><em className="desk-cal-temp-max">{day.tempMax.toFixed(0)}°</em><em className="desk-cal-temp-min">{day.tempMin.toFixed(0)}°</em></strong>
              </div>
            ))}
          </div>
        ) : null}
        {forecastDays.length > 0 ? <TemperatureChart days={forecastDays} /> : null}
        {error ? <p className="desk-widget-empty-hint">{error}</p> : null}
      </div>
    );
  }

  if (data.id === "countdown") {
    const items = data.countdowns;
    return shell(
      <div className="desk-cal-widget">
        <strong>倒计时</strong>
        <span>{items.length === 0 ? "暂无，在桌历「组件」里添加" : `${items.length} 项`}</span>
        {items.length === 0 ? <span className="desk-widget-empty-hint">点击「组件」在桌历里添加</span> : null}
        {items.map((item) => (
          <div className="desk-cal-widget-item" key={item.id}>
            <span className="desk-cal-widget-item-title">{item.title}</span>
            <span className="desk-cal-widget-item-value">{Math.max(0, Math.ceil((Date.parse(item.targetAt) - now.getTime()) / 86_400_000))} 天</span>
            <button type="button" onClick={() => {
              void api.saveSettings({ countdowns: data.countdowns.filter((candidate) => candidate.id !== item.id) });
            }}>删除</button>
          </div>
        ))}
      </div>
    );
  }

  const progressItems = data.progress;
  return shell(
    <div className="desk-cal-widget desk-cal-progress">
      <strong>进度条</strong>
      <span>{progressItems.length === 0 ? "暂无，在桌历「组件」里添加" : `${progressItems.length} 项`}</span>
      {progressItems.length === 0 ? <span className="desk-widget-empty-hint">点击「组件」在桌历里添加</span> : null}
      {progressItems.map((item) => {
        const total = Date.parse(item.endAt) - Date.parse(item.startAt);
        const percent = total > 0
          ? Math.max(0, Math.min(100, ((now.getTime() - Date.parse(item.startAt)) / total) * 100))
          : 0;
        return (
          <div className="desk-cal-widget-item" key={item.id}>
            <span className="desk-cal-widget-item-title">{item.title}</span>
            <span className="desk-cal-widget-item-value">{percent.toFixed(0)}%</span>
            <button type="button" onClick={() => {
              void api.saveSettings({ progress: data.progress.filter((candidate) => candidate.id !== item.id) });
            }}>删除</button>
            <div className="desk-cal-progress-track" role="progressbar" aria-label={item.title} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
