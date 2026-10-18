// 定时任务展示层格式化：cron 表达式 → 人类可读的调度摘要 / 相对时间 / cron builder 组装。
// 说明：croner 只在 services 侧用于算下次触发时间；UI 这里仅做「已知常见模式」的可读化，
// 覆盖不到的表达式回退成原始 cron 文本，保证不误导。

export interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
}


const pad2 = (value: number): string => String(value).padStart(2, "0");

/** 毫秒时间戳 → 本地日期时间（YYYY-MM-DD HH:MM）。 */
export function formatDateTime(ts: number | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 相对时间（如 “in 2h”“3d ago”），用于“下次运行 / 上次运行”。 */
export function formatRelativeToNow(ts: number | undefined, now: number, intl: IntlLike): string {
  if (!ts) return "-";
  const diff = ts - now;
  const abs = Math.abs(diff);
  const future = diff >= 0;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value: number;
  let unitId: string;
  if (abs < minute) {
    return intl.formatMessage({
      id: future ? "automations.time.soon" : "automations.time.justNow",
    });
  }
  if (abs < hour) {
    value = Math.round(abs / minute);
    unitId = "automations.time.minutes";
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unitId = "automations.time.hours";
  } else {
    value = Math.round(abs / day);
    unitId = "automations.time.days";
  }
  const amount = intl.formatMessage({ id: unitId }, { value: String(value) });
  return intl.formatMessage(
    { id: future ? "automations.time.in" : "automations.time.ago" },
    { amount },
  );
}

