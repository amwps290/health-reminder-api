import { Check, Clock3, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { todayInBusinessTimeZone } from "../utils";

type ClockMode = "hour" | "minute";

interface TimeDialInputProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

interface DateTimeDialInputProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  max?: string;
}

export function TimeDialInput({ value, onChange, ariaLabel }: TimeDialInputProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ClockMode>("hour");
  const { hour, minute } = parseTime(value);

  function update(nextHour: number, nextMinute: number) {
    onChange(`${pad(nextHour)}:${pad(nextMinute)}`);
  }

  return (
    <div className="time-dial-control">
      <button
        type="button"
        className="time-dial-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Clock3 size={17} />
        <span>{pad(hour)}:{pad(minute)}</span>
      </button>
      {open && (
        <div className="time-dial-panel">
          <div className="time-dial-display" aria-live="polite">
            <button type="button" className={mode === "hour" ? "active" : ""} onClick={() => setMode("hour")}>{pad(hour)}</button>
            <span>:</span>
            <button type="button" className={mode === "minute" ? "active" : ""} onClick={() => setMode("minute")}>{pad(minute)}</button>
          </div>
          <div className={`clock-face clock-${mode}`} role="group" aria-label={mode === "hour" ? "选择小时" : "选择分钟"}>
            {mode === "hour"
              ? Array.from({ length: 24 }, (_, index) => (
                <ClockOption
                  key={index}
                  value={index}
                  label={pad(index)}
                  selected={index === hour}
                  ring={index < 12 ? "inner" : "outer"}
                  onSelect={() => {
                    update(index, minute);
                    setMode("minute");
                  }}
                />
              ))
              : Array.from({ length: 12 }, (_, index) => index * 5).map((item) => (
                <ClockOption
                  key={item}
                  value={item / 5}
                  label={pad(item)}
                  selected={item === minute}
                  ring="outer"
                  onSelect={() => update(hour, item)}
                />
              ))}
            <div className="clock-hand" style={{ transform: `rotate(${mode === "hour" ? hourAngle(hour) : minute * 6}deg)` }} />
            <div className="clock-pin" />
          </div>
          <div className="minute-stepper" aria-label="分钟微调">
            <button type="button" className="icon-button" aria-label="减少 1 分钟" onClick={() => update(hour, (minute + 59) % 60)}><Minus size={16} /></button>
            <span>{pad(minute)} 分</span>
            <button type="button" className="icon-button" aria-label="增加 1 分钟" onClick={() => update(hour, (minute + 1) % 60)}><Plus size={16} /></button>
          </div>
          <div className="time-dial-actions">
            <button type="button" className="secondary-button" onClick={() => setMode(mode === "hour" ? "minute" : "hour")}>{mode === "hour" ? "选分钟" : "选小时"}</button>
            <button type="button" className="primary-button" onClick={() => setOpen(false)}><Check size={16} />完成</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DateTimeDialInput({ value, onChange, ariaLabel, max }: DateTimeDialInputProps) {
  const parts = splitDateTime(value);
  const maxParts = max ? splitDateTime(max) : null;
  return (
    <div className="date-time-dial">
      <input
        type="date"
        aria-label={`${ariaLabel} 日期`}
        value={parts.date}
        max={maxParts?.date}
        onChange={(event) => onChange(joinDateTime(event.target.value, parts.time))}
        required
      />
      <TimeDialInput
        value={parts.time}
        ariaLabel={ariaLabel}
        onChange={(time) => onChange(joinDateTime(parts.date, time))}
      />
    </div>
  );
}

function ClockOption({ value, label, selected, ring, onSelect }: {
  value: number;
  label: string;
  selected: boolean;
  ring: "inner" | "outer";
  onSelect: () => void;
}) {
  const style = useMemo(() => {
    const angle = ring === "inner" ? hourAngle(value) : value * 30;
    const radius = ring === "inner" ? 58 : 98;
    return {
      transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`,
    };
  }, [ring, value]);

  return (
    <button type="button" className={selected ? "clock-option selected" : "clock-option"} style={style} onClick={onSelect}>
      {label}
    </button>
  );
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { hour: 8, minute: 0 };
  return {
    hour: clamp(Number(match[1]), 0, 23),
    minute: clamp(Number(match[2]), 0, 59),
  };
}

function splitDateTime(value: string): { date: string; time: string } {
  return {
    date: value.slice(0, 10) || todayInBusinessTimeZone(),
    time: value.slice(11, 16) || "08:00",
  };
}

function joinDateTime(date: string, time: string): string {
  return `${date}T${time}`;
}

function hourAngle(hour: number): number {
  return (hour % 12) * 30;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
