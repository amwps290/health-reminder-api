import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Baby, BellRing, CheckCircle2, Clock3, Pencil, RefreshCw, RotateCcw, Send, Syringe, TriangleAlert } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import { StatusBadge } from "../components/StatusBadge";
import type { PregnancyStatus, SystemStatus, TimelineJob } from "../types";
import { addDateDays, BUSINESS_TIME_ZONE, formatDateTime, fromDateTimeInput, todayInBusinessTimeZone } from "../utils";

export function DashboardPage() {
  const [pregnancyEditorOpen, setPregnancyEditorOpen] = useState(false);
  const queryClient = useQueryClient();
  const range = getTodayRange();
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api<SystemStatus>("/system/status"),
    refetchInterval: 60_000,
  });
  const pregnancy = useQuery({
    queryKey: ["pregnancy"],
    queryFn: () => api<PregnancyStatus>("/pregnancy"),
  });
  const timeline = useQuery({
    queryKey: ["timeline", range.from, range.to],
    queryFn: () => api<TimelineJob[]>(`/timeline?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
  });
  const testPush = useMutation({
    mutationFn: () => api("/notifications/test", {
      method: "POST",
      ...jsonBody({ title: "健康提醒测试", body: "Web 管理端与 Bark 连接正常" }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["system-status"] }),
  });

  return (
    <div className="page-container">
      <PageHeader
        title="今日"
        subtitle={new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeZone: BUSINESS_TIME_ZONE }).format(new Date())}
        actions={
          <button className="secondary-button" aria-label="测试 Bark" title="测试 Bark" onClick={() => testPush.mutate()} disabled={testPush.isPending}>
            <Send size={17} /><span>{testPush.isPending ? "发送中" : "测试 Bark"}</span>
          </button>
        }
      />

      {testPush.isSuccess && <div className="success-notice"><CheckCircle2 size={18} />测试通知已被 Bark 接受</div>}
      {testPush.isError && <ErrorNotice message={testPush.error.message} />}
      {status.isError && <ErrorNotice message={status.error.message} />}

      {pregnancy.isError && <ErrorNotice message={pregnancy.error.message} />}
      <PregnancyCard
        pregnancy={pregnancy.data}
        loading={pregnancy.isPending}
        onEdit={() => setPregnancyEditorOpen(true)}
      />

      <section className="metrics-band" aria-label="任务概况">
        <Metric icon={Clock3} label="计划任务" value={status.data?.jobs.pending ?? "--"} tone="green" />
        <Metric icon={RefreshCw} label="重试中" value={status.data?.jobs.retrying ?? "--"} tone="amber" />
        <Metric icon={TriangleAlert} label="失败" value={status.data?.jobs.failed ?? "--"} tone="red" />
      </section>

      <section className="content-section">
        <div className="section-heading"><h2>今日提醒</h2><span>{timeline.data?.length ?? 0} 项</span></div>
        {timeline.isPending && <LoadingView />}
        {timeline.isError && <ErrorNotice message={timeline.error.message} />}
        {timeline.data?.length === 0 && <EmptyState title="今天没有提醒" />}
        <div className="task-list">
          {timeline.data?.map((job) => (
            <article className="task-row" key={job.id}>
              <div className={`task-icon ${job.source_type}`}>
                {job.source_type === "medication" ? <BellRing size={19} /> : job.source_type === "injection" ? <Syringe size={19} /> : <Clock3 size={19} />}
              </div>
              <div className="task-main"><strong>{job.title}</strong><p>{job.body}</p></div>
              <time>{formatDateTime(job.scheduled_at).slice(-5)}</time>
              <StatusBadge status={job.status} />
            </article>
          ))}
        </div>
      </section>
      {pregnancyEditorOpen && <PregnancyModal pregnancy={pregnancy.data} onClose={() => setPregnancyEditorOpen(false)} />}
    </div>
  );
}

function PregnancyCard({ pregnancy, loading, onEdit }: { pregnancy?: PregnancyStatus; loading: boolean; onEdit: () => void }) {
  if (loading) {
    return <section className="pregnancy-card"><LoadingView label="正在计算孕周" /></section>;
  }

  if (!pregnancy?.configured) {
    return (
      <section className="pregnancy-card unconfigured">
        <div className="pregnancy-icon"><Baby size={22} /></div>
        <div className="pregnancy-main">
          <span>孕周提示</span>
          <strong>尚未校准</strong>
          <p>输入当前孕周后，系统会按日期自动推算。</p>
        </div>
        <button className="primary-button" onClick={onEdit}><Pencil size={17} />校准</button>
      </section>
    );
  }

  return (
    <section className="pregnancy-card">
      <div className="pregnancy-icon"><Baby size={22} /></div>
      <div className="pregnancy-main">
        <span>今日孕周</span>
        <strong>{pregnancy.currentWeeks} 周 {pregnancy.currentDays} 天</strong>
        <p>校准于 {pregnancy.calibratedOn} · 预产期 {pregnancy.dueDate}</p>
      </div>
      <div className="pregnancy-side">
        <span>{pregnancy.daysUntilDue >= 0 ? "距 40 周" : "超过 40 周"}</span>
        <strong>{Math.abs(pregnancy.daysUntilDue)} 天</strong>
      </div>
      <button className="secondary-button" onClick={onEdit}><Pencil size={17} />校准</button>
    </section>
  );
}

function PregnancyModal({ pregnancy, onClose }: { pregnancy?: PregnancyStatus; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = pregnancy?.today ?? todayInBusinessTimeZone();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    calibratedOn: today,
    weeks: pregnancy?.configured ? pregnancy.currentWeeks : 12,
    days: pregnancy?.configured ? pregnancy.currentDays : 0,
  }));
  const save = useMutation({
    mutationFn: () => api<PregnancyStatus>("/pregnancy", { method: "PUT", ...jsonBody(form) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pregnancy"] });
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => api("/pregnancy", { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pregnancy"] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validatePregnancyForm(form, today);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    save.mutate();
  }

  return (
    <Modal title="校准孕周" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {formError && <ErrorNotice message={formError} />}
        {save.isError && <ErrorNotice message={save.error.message} />}
        {reset.isError && <ErrorNotice message={reset.error.message} />}
        <div className="form-grid two-columns">
          <Field label="校准日期"><input type="date" max={today} value={form.calibratedOn} onChange={(event) => setForm({ ...form, calibratedOn: event.target.value })} required /></Field>
          <div className="field-group">
            <span>当天孕周</span>
            <div className="gestation-inputs">
              <label><input type="number" min={0} max={45} value={form.weeks} onChange={(event) => setForm({ ...form, weeks: Number(event.target.value) })} required /><span>周</span></label>
              <label><input type="number" min={0} max={6} value={form.days} onChange={(event) => setForm({ ...form, days: Number(event.target.value) })} required /><span>天</span></label>
            </div>
          </div>
        </div>
        <div className="calibration-preview">
          <Baby size={18} />
          <span>{previewPregnancy(form, today)}</span>
        </div>
        <div className="form-actions split-actions">
          {pregnancy?.configured && <button type="button" className="danger-text-button" onClick={() => reset.mutate()} disabled={reset.isPending}><RotateCcw size={16} />重置</button>}
          <div>
            <button type="button" className="secondary-button" onClick={onClose}>取消</button>
            <button type="submit" className="primary-button" disabled={save.isPending}>{save.isPending ? "保存中" : "保存"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Clock3; label: string; value: ReactNode; tone: string }) {
  return <div className={`metric metric-${tone}`}><Icon size={20} /><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field-group"><span>{label}</span>{children}</label>;
}

function validatePregnancyForm(form: { calibratedOn: string; weeks: number; days: number }, today?: string): string | null {
  if (!form.calibratedOn) return "请选择校准日期";
  if (today && form.calibratedOn > today) return "校准日期不能晚于今天";
  if (!Number.isInteger(form.weeks) || form.weeks < 0 || form.weeks > 45) return "孕周周数需在 0 到 45 之间";
  if (!Number.isInteger(form.days) || form.days < 0 || form.days > 6) return "孕周天数需在 0 到 6 之间";
  if (form.weeks * 7 + form.days > 315) return "孕周不能超过 45 周";
  return null;
}

function previewPregnancy(form: { calibratedOn: string; weeks: number; days: number }, today: string): string {
  if (validatePregnancyForm(form, today)) return "填写校准日期和孕周后显示预览";
  const totalDays = form.weeks * 7 + form.days + diffDays(form.calibratedOn, today);
  if (totalDays < 0) return "校准日期晚于今天，保存后暂时无法推算";
  return `按今天计算为 ${Math.floor(totalDays / 7)} 周 ${totalDays % 7} 天`;
}

function diffDays(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear!, toMonth! - 1, toDay) - Date.UTC(fromYear!, fromMonth! - 1, fromDay)) /
      86_400_000,
  );
}

function getTodayRange() {
  const today = todayInBusinessTimeZone();
  const nextMidnight = fromDateTimeInput(`${addDateDays(today, 1)}T00:00`);
  return {
    from: fromDateTimeInput(`${today}T00:00`),
    to: new Date(Date.parse(nextMidnight) - 1).toISOString(),
  };
}
