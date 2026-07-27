import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Baby, Pencil, Plus, Scale, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import type { PregnancyStatus, WeightInput, WeightRecord } from "../types";

const DAY_MS = 86_400_000;

export function WeightsPage() {
  const [editing, setEditing] = useState<WeightRecord | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const weights = useQuery({
    queryKey: ["weights"],
    queryFn: () => api<WeightRecord[]>("/weights"),
  });
  const pregnancy = useQuery({
    queryKey: ["pregnancy"],
    queryFn: () => api<PregnancyStatus>("/pregnancy"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/weights/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["weights"] }),
  });

  const records = weights.data ?? [];
  const latest = records.at(-1);
  const today = pregnancy.data?.today ?? toLocalDate(new Date());
  const todayRecord = records.find((record) => record.measuredOn === today);
  const subtitle = pregnancy.data?.configured
    ? `当前孕 ${pregnancy.data.currentWeeks} 周 ${pregnancy.data.currentDays} 天`
    : "记录变化趋势，校准孕周后可按孕周查看";

  return (
    <div className="page-container">
      <PageHeader
        title="体重记录"
        subtitle={subtitle}
        actions={
          <button
            className="primary-button"
            onClick={() => setEditing(todayRecord ?? null)}
            aria-label={todayRecord ? "更新今日体重" : "记录体重"}
          >
            {todayRecord ? <Pencil size={18} /> : <Plus size={18} />}
            <span>{todayRecord ? "更新今日" : "记录体重"}</span>
          </button>
        }
      />

      {weights.isError && <ErrorNotice message={weights.error.message} />}
      {pregnancy.isError && <ErrorNotice message={pregnancy.error.message} />}
      {remove.isError && <ErrorNotice message={remove.error.message} />}

      <WeightSummary records={records} />

      <section className="weight-chart-panel" aria-labelledby="weight-chart-title">
        <div className="weight-section-heading">
          <div>
            <h2 id="weight-chart-title">孕期增长曲线</h2>
            <p>{records.length > 1 ? `${records[0]?.measuredOn} 至 ${latest?.measuredOn}` : "每次记录后自动更新"}</p>
          </div>
          {pregnancy.data?.configured && <span><Baby size={15} />按孕周显示</span>}
        </div>
        {!pregnancy.isPending && !pregnancy.data?.configured && (
          <div className="weight-context-notice">
            <Baby size={17} />
            <span>尚未校准孕周，当前按测量日期显示曲线。</span>
          </div>
        )}
        {weights.isPending ? (
          <LoadingView label="正在加载体重曲线" />
        ) : records.length === 0 ? (
          <EmptyState title="记录第一次体重后，这里会生成增长曲线" />
        ) : (
          <WeightChart records={records} pregnancy={pregnancy.data} />
        )}
      </section>

      <section className="weight-history" aria-labelledby="weight-history-title">
        <div className="weight-section-heading">
          <div>
            <h2 id="weight-history-title">历史记录</h2>
            <p>同一天保留一条测量数据</p>
          </div>
          <strong>{records.length} 条</strong>
        </div>
        {weights.isPending && <LoadingView />}
        {!weights.isPending && records.length === 0 && <EmptyState title="还没有体重记录" />}
        <div className="weight-record-list">
          {[...records].reverse().map((record) => {
            const index = records.findIndex((item) => item.id === record.id);
            const previous = index > 0 ? records[index - 1] : undefined;
            const change = previous ? record.weightKg - previous.weightKg : null;
            return (
              <article className="weight-record-row" key={record.id}>
                <time dateTime={record.measuredOn}>{formatDisplayDate(record.measuredOn)}</time>
                <div className="weight-record-context">
                  <strong>{formatGestation(record.measuredOn, pregnancy.data)}</strong>
                  {record.note && <span>{record.note}</span>}
                </div>
                <div className="weight-record-value">
                  <strong>{record.weightKg.toFixed(1)} kg</strong>
                  {change !== null && <span className={change > 0 ? "increase" : change < 0 ? "decrease" : ""}>{formatSignedWeight(change)}</span>}
                </div>
                <div className="compact-actions">
                  <button className="icon-button" onClick={() => setEditing(record)} aria-label={`编辑 ${record.measuredOn} 体重`} title="编辑"><Pencil size={16} /></button>
                  <button
                    className="icon-button danger"
                    onClick={() => window.confirm(`删除 ${record.measuredOn} 的体重记录？`) && remove.mutate(record.id)}
                    aria-label={`删除 ${record.measuredOn} 体重`}
                    title="删除"
                  ><Trash2 size={16} /></button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {editing !== undefined && (
        <WeightModal
          record={editing}
          latest={latest}
          today={today}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

function WeightSummary({ records }: { records: WeightRecord[] }) {
  const first = records[0];
  const latest = records.at(-1);
  const gain = first && latest ? latest.weightKg - first.weightKg : null;
  return (
    <section className="weight-summary" aria-label="体重概况">
      <SummaryItem icon={<Scale size={19} />} label="最新体重" value={latest ? `${latest.weightKg.toFixed(1)} kg` : "--"} />
      <SummaryItem
        icon={gain !== null && gain < 0 ? <TrendingDown size={19} /> : <TrendingUp size={19} />}
        label="累计变化"
        value={gain === null ? "--" : formatSignedWeight(gain)}
      />
      <SummaryItem icon={<Baby size={19} />} label="记录次数" value={`${records.length} 次`} />
    </section>
  );
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="weight-summary-item"><span className="weight-summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function WeightChart({ records, pregnancy }: { records: WeightRecord[]; pregnancy?: PregnancyStatus }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(280, Math.floor(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = width < 520 ? 240 : 280;
  const margins = { top: 22, right: 18, bottom: 42, left: width < 520 ? 42 : 50 };
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  const points = useMemo(() => buildChartPoints(records, pregnancy), [records, pregnancy]);
  const rawXMin = Math.min(...points.map((point) => point.x));
  const rawXMax = Math.max(...points.map((point) => point.x));
  const xMin = pregnancy?.configured ? Math.min(0, rawXMin) : rawXMin === rawXMax ? rawXMin - 1 : rawXMin;
  const xMax = pregnancy?.configured ? Math.max(280, rawXMax) : rawXMin === rawXMax ? rawXMax + 1 : rawXMax;
  const weights = points.map((point) => point.record.weightKg);
  const rawYMin = Math.min(...weights);
  const rawYMax = Math.max(...weights);
  const yPadding = Math.max(1, (rawYMax - rawYMin) * 0.2);
  const yMin = Math.floor((rawYMin - yPadding) * 2) / 2;
  const yMax = Math.ceil((rawYMax + yPadding) * 2) / 2;
  const scaleX = (value: number) => margins.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const scaleY = (value: number) => margins.top + ((yMax - value) / (yMax - yMin)) * plotHeight;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${scaleX(point.x)} ${scaleY(point.record.weightKg)}`).join(" ");
  const area = `${line} L ${scaleX(points.at(-1)!.x)} ${margins.top + plotHeight} L ${scaleX(points[0]!.x)} ${margins.top + plotHeight} Z`;
  const yTicks = createTicks(yMin, yMax, 5);
  const xTicks = createTicks(xMin, xMax, width < 520 ? 4 : 5);
  const latestPoint = points.at(-1)!;

  return (
    <div className="weight-chart" ref={containerRef}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="孕期体重增长折线图">
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line className="weight-grid-line" x1={margins.left} x2={width - margins.right} y1={scaleY(tick)} y2={scaleY(tick)} />
            <text className="weight-axis-label" x={margins.left - 8} y={scaleY(tick) + 4} textAnchor="end">{tick.toFixed(1)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text className="weight-axis-label" key={`x-${tick}`} x={scaleX(tick)} y={height - 13} textAnchor="middle">
            {formatChartX(tick, points, pregnancy)}
          </text>
        ))}
        {points.length > 1 && <path className="weight-chart-area" d={area} />}
        {points.length > 1 && <path className="weight-chart-line" d={line} />}
        {points.map((point) => (
          <circle
            className="weight-chart-point"
            key={point.record.id}
            cx={scaleX(point.x)}
            cy={scaleY(point.record.weightKg)}
            r={4.5}
            tabIndex={0}
            aria-label={`${point.record.measuredOn}，${point.record.weightKg.toFixed(1)} 公斤，${point.label}`}
          >
            <title>{`${point.record.measuredOn} · ${point.label} · ${point.record.weightKg.toFixed(1)} kg`}</title>
          </circle>
        ))}
        <text className="weight-latest-label" x={scaleX(latestPoint.x) - 7} y={Math.max(15, scaleY(latestPoint.record.weightKg) - 10)} textAnchor="end">
          {latestPoint.record.weightKg.toFixed(1)} kg
        </text>
      </svg>
    </div>
  );
}

function WeightModal({ record, latest, today, onClose }: { record: WeightRecord | null; latest?: WeightRecord; today: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    measuredOn: record?.measuredOn ?? today,
    weightKg: record ? String(record.weightKg) : latest ? String(latest.weightKg) : "",
    note: record?.note ?? "",
  });
  const mutation = useMutation({
    mutationFn: () => {
      const input: WeightInput = {
        measuredOn: form.measuredOn,
        weightKg: Number(form.weightKg),
        note: form.note,
      };
      return api<WeightRecord>(record ? `/weights/${record.id}` : "/weights", {
        method: record ? "PUT" : "POST",
        ...jsonBody(input),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["weights"] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validateWeightForm(form, today);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate();
  }

  return (
    <Modal title={record ? "编辑体重" : "记录体重"} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {formError && <ErrorNotice message={formError} />}
        {mutation.isError && <ErrorNotice message={mutation.error.message} />}
        <div className="form-grid two-columns">
          <Field label="测量日期"><input type="date" max={today} value={form.measuredOn} onChange={(event) => setForm({ ...form, measuredOn: event.target.value })} required /></Field>
          <Field label="体重（kg）"><input type="number" min="20" max="350" step="0.1" inputMode="decimal" value={form.weightKg} onChange={(event) => setForm({ ...form, weightKg: event.target.value })} required autoFocus /></Field>
        </div>
        <Field label="备注"><textarea rows={3} maxLength={500} placeholder="例如：晨起空腹、产检测量" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? "保存中" : "保存"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field-group"><span>{label}</span>{children}</label>;
}

function validateWeightForm(form: { measuredOn: string; weightKg: string }, today: string): string | null {
  if (!form.measuredOn) return "请选择测量日期";
  if (form.measuredOn > today) return "体重记录日期不能晚于今天";
  const weight = Number(form.weightKg);
  if (!Number.isFinite(weight) || weight < 20 || weight > 350) return "请输入 20 到 350 kg 之间的体重";
  return null;
}

interface ChartPoint {
  record: WeightRecord;
  x: number;
  label: string;
}

function buildChartPoints(records: WeightRecord[], pregnancy?: PregnancyStatus): ChartPoint[] {
  const firstDay = dayNumber(records[0]!.measuredOn);
  return records.map((record) => {
    const gestationalDays = getGestationalDays(record.measuredOn, pregnancy);
    return {
      record,
      x: gestationalDays ?? dayNumber(record.measuredOn) - firstDay,
      label: gestationalDays === null ? formatDisplayDate(record.measuredOn) : formatGestationalDays(gestationalDays),
    };
  });
}

function formatChartX(value: number, points: ChartPoint[], pregnancy?: PregnancyStatus): string {
  if (pregnancy?.configured) {
    if (value < 0) return "孕前";
    return `${Math.round(value / 7)} 周`;
  }
  const date = new Date((dayNumber(points[0]!.record.measuredOn) + value) * DAY_MS);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatGestation(measuredOn: string, pregnancy?: PregnancyStatus): string {
  const days = getGestationalDays(measuredOn, pregnancy);
  return days === null ? "按日期记录" : formatGestationalDays(days);
}

function getGestationalDays(measuredOn: string, pregnancy?: PregnancyStatus): number | null {
  if (!pregnancy?.configured) return null;
  const calibratedDays = pregnancy.calibrationWeeks * 7 + pregnancy.calibrationDays;
  return calibratedDays + dayNumber(measuredOn) - dayNumber(pregnancy.calibratedOn);
}

function formatGestationalDays(days: number): string {
  if (days < 0) return `孕前 ${Math.abs(days)} 天`;
  return `${Math.floor(days / 7)} 周 ${days % 7} 天`;
}

function createTicks(minimum: number, maximum: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => minimum + ((maximum - minimum) * index) / (count - 1));
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
}

function formatDisplayDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}年${month}月${day}日`;
}

function formatSignedWeight(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} kg`;
}

function toLocalDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
