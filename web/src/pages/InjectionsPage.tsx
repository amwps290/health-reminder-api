import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarRange, CheckCircle2, Clock3, History, MapPin, Pencil, Plus, Repeat2, Send, SkipForward, Syringe, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { NotificationTestFeedback } from "../components/NotificationTestFeedback";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import { TimeDialInput } from "../components/TimeDialInput";
import type { Injection, InjectionInput, InjectionRecord, InjectionRecordStatus, InjectionSide, NotificationTestResult } from "../types";
import { formatDateTime, fromDateTimeInput, todayInBusinessTimeZone, toDateTimeInput } from "../utils";

const sideLabels: Record<InjectionSide, string> = { left: "左侧", right: "右侧" };

export function InjectionsPage() {
  const [editing, setEditing] = useState<Injection | null | "new">(null);
  const [recording, setRecording] = useState<Injection | null>(null);
  const queryClient = useQueryClient();
  const injections = useQuery({ queryKey: ["injections"], queryFn: () => api<Injection[]>("/injections") });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/injections/${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(queryClient),
  });

  return (
    <div className="page-container">
      <PageHeader title="注射计划" subtitle={`${injections.data?.filter((item) => item.enabled).length ?? 0} 个启用计划`} actions={
        <button className="primary-button" aria-label="新增" title="新增注射计划" onClick={() => setEditing("new")}><Plus size={18} /><span>新增</span></button>
      } />
      {injections.isPending && <LoadingView />}
      {injections.isError && <ErrorNotice message={injections.error.message} />}
      {remove.isError && <ErrorNotice message={remove.error.message} />}
      {injections.data?.length === 0 && <EmptyState title="还没有注射计划" />}
      <div className="item-grid">
        {injections.data?.map((item) => (
          <article className={`item-card ${item.enabled ? "" : "disabled"}`} key={item.id}>
            <div className="item-card-header">
              <div className="item-title"><span className="item-icon injection"><Syringe size={19} /></span><div><h2>{item.name}</h2><p>{item.dose || "未填写剂量"}</p></div></div>
              <span className={item.enabled ? "enabled-label" : "disabled-label"}>{item.enabled ? "启用" : "停用"}</span>
            </div>
            <div className="item-details">
              <div><Clock3 size={16} /><span>{item.localTime} · {formatInterval(item.intervalDays)}</span></div>
              <div><Repeat2 size={16} /><span>下一次预计{sideLabels[item.nextSide]}（按真实完成记录）</span></div>
              <div><MapPin size={16} /><span>{item.site || "未指定部位"}</span></div>
              <div><CalendarRange size={16} /><span>{item.startDate} 至 {item.endDate || "长期"}</span></div>
            </div>
            {item.instructions && <p className="item-note">{item.instructions}</p>}
            <div className="item-actions">
              <button className="text-button" onClick={() => setRecording(item)}><History size={16} />执行记录</button>
              <button className="text-button" onClick={() => setEditing(item)}><Pencil size={16} />编辑</button>
              <button className="danger-text-button" onClick={() => window.confirm(`删除“${item.name}”？`) && remove.mutate(item.id)}><Trash2 size={16} />删除</button>
            </div>
          </article>
        ))}
      </div>
      {editing && <InjectionModal injection={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {recording && <InjectionRecordsModal injection={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}

function InjectionModal({ injection, onClose }: { injection: Injection | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = todayInBusinessTimeZone();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<InjectionInput>(() => injection ? {
    name: injection.name,
    dose: injection.dose,
    site: injection.site,
    instructions: injection.instructions,
    startDate: injection.startDate,
    endDate: injection.endDate,
    localTime: injection.localTime,
    intervalDays: injection.intervalDays,
    firstSide: injection.firstSide,
    enabled: injection.enabled,
  } : {
    name: "",
    dose: "",
    site: "腹部",
    instructions: "",
    startDate: today,
    endDate: null,
    localTime: "20:00",
    intervalDays: 1,
    firstSide: "left",
    enabled: true,
  });
  const mutation = useMutation({
    mutationFn: () => api<Injection>(injection ? `/injections/${injection.id}` : "/injections", {
      method: injection ? "PUT" : "POST",
      ...jsonBody(form),
    }),
    onSuccess: async () => { await refresh(queryClient); onClose(); },
  });
  const testNotification = useMutation({
    mutationFn: () => api<NotificationTestResult>("/injections/test-notification", {
      method: "POST",
      ...jsonBody(form),
    }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validateInjectionForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate();
  }
  function test() {
    const error = validateInjectionForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    testNotification.mutate();
  }

  return (
    <Modal title={injection ? "编辑注射计划" : "新增注射计划"} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {formError && <ErrorNotice message={formError} />}
        {mutation.isError && <ErrorNotice message={mutation.error.message} />}
        {testNotification.isError && <ErrorNotice message={testNotification.error.message} />}
        {testNotification.data && <NotificationTestFeedback result={testNotification.data} />}
        <div className="form-grid two-columns">
          <Field label="名称"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={120} placeholder="例如：胰岛素" /></Field>
          <Field label="单次剂量"><input value={form.dose} onChange={(event) => setForm({ ...form, dose: event.target.value })} maxLength={120} placeholder="例如：10 单位" /></Field>
        </div>
        <div className="form-grid two-columns">
          <Field label="注射部位"><input value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value })} maxLength={120} placeholder="例如：腹部" /></Field>
          <div className="field-group">
            <span>注射时间</span>
            <TimeDialInput value={form.localTime} ariaLabel="注射时间" onChange={(value) => setForm({ ...form, localTime: value })} />
          </div>
        </div>
        <div className="form-grid two-columns">
          <Field label="开始日期"><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></Field>
          <Field label="结束日期"><input type="date" value={form.endDate || ""} min={form.startDate} onChange={(event) => setForm({ ...form, endDate: event.target.value || null })} /></Field>
        </div>
        <div className="form-grid two-columns align-end">
          <Field label="注射间隔（天）"><input type="number" min={1} max={365} step={1} value={form.intervalDays} onChange={(event) => setForm({ ...form, intervalDays: Number(event.target.value) })} required /></Field>
          <div className="field-group">
            <span>首次注射侧别</span>
            <div className="segmented-control side-control" role="group" aria-label="首次注射侧别">
              {(["left", "right"] as const).map((side) => (
                <button type="button" key={side} className={form.firstSide === side ? "active" : ""} aria-pressed={form.firstSide === side} onClick={() => setForm({ ...form, firstSide: side })}>{sideLabels[side]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="rotation-preview"><Repeat2 size={18} /><span>{formatInterval(form.intervalDays)} · {sideLabels[form.firstSide]} → {sideLabels[oppositeSide(form.firstSide)]} → {sideLabels[form.firstSide]}</span></div>
        <Field label="注射说明"><textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} rows={3} maxLength={1000} placeholder="按医嘱记录注意事项" /></Field>
        <label className="toggle-row"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span>启用计划</span></label>
        <div className="form-actions split-actions">
          <button type="button" className="secondary-button" onClick={test} disabled={testNotification.isPending || mutation.isPending}><Send size={17} />{testNotification.isPending ? "发送中" : "测试通知"}</button>
          <div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={mutation.isPending || testNotification.isPending}>{mutation.isPending ? "保存中" : "保存"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

interface RecordForm {
  scheduledDate: string;
  status: InjectionRecordStatus;
  completedAt: string;
  actualSide: InjectionSide;
  rescheduledTo: string;
  notes: string;
}

function InjectionRecordsModal({ injection, onClose }: { injection: Injection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ["injection-records", injection.id],
    queryFn: () => api<InjectionRecord[]>(`/injections/${injection.id}/records`),
  });
  const [form, setForm] = useState<RecordForm>(() => emptyRecordForm(injection));
  const save = useMutation({
    mutationFn: () => api<InjectionRecord>(`/injections/${injection.id}/records`, {
      method: "POST",
      ...jsonBody({
        scheduledDate: form.scheduledDate,
        status: form.status,
        completedAt: form.status === "completed" ? fromDateTimeInput(form.completedAt) : null,
        actualSide: form.status === "completed" ? form.actualSide : null,
        rescheduledTo: form.status === "rescheduled" ? form.rescheduledTo : null,
        notes: form.notes,
      }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["injection-records", injection.id] }),
        refresh(queryClient),
      ]);
      const current = await api<Injection>(`/injections/${injection.id}`);
      setForm(emptyRecordForm(current));
    },
  });
  const remove = useMutation({
    mutationFn: (recordId: string) => api(`/injections/${injection.id}/records/${recordId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["injection-records", injection.id] }),
        refresh(queryClient),
      ]);
    },
  });

  function editRecord(record: InjectionRecord): void {
    setForm({
      scheduledDate: record.scheduledDate,
      status: record.status,
      completedAt: record.completedAt ? toDateTimeInput(record.completedAt) : toDateTimeInput(new Date().toISOString()),
      actualSide: record.actualSide || injection.nextSide,
      rescheduledTo: record.rescheduledTo || record.scheduledDate,
      notes: record.notes,
    });
  }

  return (
    <Modal title={`${injection.name} · 执行记录`} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {save.isError && <ErrorNotice message={save.error.message} />}
        {remove.isError && <ErrorNotice message={remove.error.message} />}
        {save.isSuccess && <div className="success-notice" role="status"><CheckCircle2 size={18} />执行记录已保存，后续侧别已重新计算</div>}
        <div className="field-group">
          <span>执行结果</span>
          <div className="segmented-control record-status-control" role="group" aria-label="执行结果">
            <button type="button" className={form.status === "completed" ? "active" : ""} aria-pressed={form.status === "completed"} onClick={() => setForm({ ...form, status: "completed" })}><CheckCircle2 size={16} />已完成</button>
            <button type="button" className={form.status === "skipped" ? "active" : ""} aria-pressed={form.status === "skipped"} onClick={() => setForm({ ...form, status: "skipped" })}><SkipForward size={16} />已跳过</button>
            <button type="button" className={form.status === "rescheduled" ? "active" : ""} aria-pressed={form.status === "rescheduled"} onClick={() => setForm({ ...form, status: "rescheduled" })}><CalendarClock size={16} />已改期</button>
          </div>
        </div>
        <div className="form-grid two-columns">
          <Field label="原计划日期"><input type="date" value={form.scheduledDate} onChange={(event) => setForm({ ...form, scheduledDate: event.target.value })} required /></Field>
          {form.status === "rescheduled" ? (
            <Field label="改期到"><input type="date" value={form.rescheduledTo} onChange={(event) => setForm({ ...form, rescheduledTo: event.target.value })} required /></Field>
          ) : form.status === "completed" ? (
            <Field label="实际完成时间"><input type="datetime-local" value={form.completedAt} onChange={(event) => setForm({ ...form, completedAt: event.target.value })} required /></Field>
          ) : <div />}
        </div>
        {form.status === "completed" && (
          <div className="field-group">
            <span>实际注射侧别</span>
            <div className="segmented-control side-control" role="group" aria-label="实际注射侧别">
              {(["left", "right"] as const).map((side) => (
                <button type="button" key={side} className={form.actualSide === side ? "active" : ""} aria-pressed={form.actualSide === side} onClick={() => setForm({ ...form, actualSide: side })}>{sideLabels[side]}</button>
              ))}
            </div>
          </div>
        )}
        <Field label="备注"><textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="可记录实际部位、剂量或异常情况" /></Field>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
          <button type="submit" className="primary-button" disabled={save.isPending}>{save.isPending ? "保存中" : "保存记录"}</button>
        </div>
      </form>

      <section className="injection-history" aria-labelledby="injection-history-title">
        <div className="section-heading"><h2 id="injection-history-title">最近记录</h2><span>{records.data?.length ?? 0} 条</span></div>
        {records.isPending && <LoadingView />}
        {records.isError && <ErrorNotice message={records.error.message} />}
        {records.data?.length === 0 && <EmptyState title="还没有执行记录" />}
        <div className="injection-history-list">
          {records.data?.map((record) => (
            <div className="injection-history-row" key={record.id}>
              <div>
                <strong>{record.scheduledDate} · {recordStatusLabel(record)}</strong>
                <span>{record.completedAt ? formatDateTime(record.completedAt) : record.rescheduledTo ? `改到 ${record.rescheduledTo}` : record.notes || "未填写备注"}</span>
              </div>
              <div className="compact-actions">
                <button type="button" className="icon-button" aria-label={`编辑 ${record.scheduledDate} 执行记录`} onClick={() => editRecord(record)}><Pencil size={16} /></button>
                <button type="button" className="icon-button danger" aria-label={`删除 ${record.scheduledDate} 执行记录`} onClick={() => window.confirm("删除这条执行记录？") && remove.mutate(record.id)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </Modal>
  );
}

function emptyRecordForm(injection: Injection): RecordForm {
  const today = todayInBusinessTimeZone();
  return {
    scheduledDate: today,
    status: "completed",
    completedAt: toDateTimeInput(new Date().toISOString()),
    actualSide: injection.nextSide,
    rescheduledTo: today,
    notes: "",
  };
}

function recordStatusLabel(record: InjectionRecord): string {
  if (record.status === "completed") return `已完成 · ${sideLabels[record.actualSide!]}`;
  if (record.status === "rescheduled") return "已改期";
  return "已跳过";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field-group"><span>{label}</span>{children}</label>;
}

function validateInjectionForm(form: InjectionInput): string | null {
  if (!form.name.trim()) return "请填写注射计划名称";
  if (!form.startDate) return "请选择开始日期";
  if (form.endDate && form.endDate < form.startDate) return "结束日期不能早于开始日期";
  if (!form.localTime) return "请选择注射时间";
  if (!Number.isInteger(form.intervalDays) || form.intervalDays < 1 || form.intervalDays > 365) return "注射间隔需为 1 到 365 天的整数";
  return null;
}

function formatInterval(days: number): string {
  return days === 1 ? "每天" : `每隔 ${days} 天`;
}

function oppositeSide(side: InjectionSide): InjectionSide {
  return side === "left" ? "right" : "left";
}

function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["injections"] }),
    queryClient.invalidateQueries({ queryKey: ["timeline"] }),
    queryClient.invalidateQueries({ queryKey: ["system-status"] }),
  ]);
}
