import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, CheckCircle2, Clock3, History, Pencil, Pill, Plus, Repeat2, Send, SkipForward, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { NotificationTestFeedback } from "../components/NotificationTestFeedback";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import { TimeDialInput } from "../components/TimeDialInput";
import type { Medication, MedicationInput, MedicationRecord, MedicationRecordStatus, NotificationTestResult } from "../types";
import { formatDateTime, fromDateTimeInput, todayInBusinessTimeZone, toDateTimeInput } from "../utils";

export function MedicationsPage() {
  const [editing, setEditing] = useState<Medication | null | "new">(null);
  const [recording, setRecording] = useState<Medication | null>(null);
  const queryClient = useQueryClient();
  const medications = useQuery({ queryKey: ["medications"], queryFn: () => api<Medication[]>("/medications") });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/medications/${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(queryClient),
  });

  return (
    <div className="page-container">
      <PageHeader title="服药计划" subtitle={`${medications.data?.filter((item) => item.enabled).length ?? 0} 个启用计划`} actions={
        <button className="primary-button" aria-label="新增" title="新增服药计划" onClick={() => setEditing("new")}><Plus size={18} /><span>新增</span></button>
      } />
      {medications.isPending && <LoadingView />}
      {medications.isError && <ErrorNotice message={medications.error.message} />}
      {remove.isError && <ErrorNotice message={remove.error.message} />}
      {medications.data?.length === 0 && <EmptyState title="还没有服药计划" />}
      <div className="item-grid">
        {medications.data?.map((item) => (
          <article className={`item-card ${item.enabled ? "" : "disabled"}`} key={item.id}>
            <div className="item-card-header">
              <div className="item-title"><span className="item-icon medication"><Pill size={19} /></span><div><h2>{item.name}</h2><p>{formatMedicationDose(item)}</p></div></div>
              <span className={item.enabled ? "enabled-label" : "disabled-label"}>{item.enabled ? "启用" : "停用"}</span>
            </div>
            <div className="item-details">
              <div><Clock3 size={16} /><span>{formatMedicationSlots(item)}</span></div>
              <div><Repeat2 size={16} /><span>{formatMedicationSchedule(item)}</span></div>
              <div><CalendarRange size={16} /><span>{item.schedule.startDate} 至 {item.schedule.endDate || "长期"}</span></div>
            </div>
            {item.instructions && <p className="item-note">{item.instructions}</p>}
            <div className="item-actions">
              <button className="text-button" onClick={() => setRecording(item)}><History size={16} />服用记录</button>
              <button className="text-button" onClick={() => setEditing(item)}><Pencil size={16} />编辑</button>
              <button className="danger-text-button" onClick={() => window.confirm(`删除“${item.name}”？`) && remove.mutate(item.id)}><Trash2 size={16} />删除</button>
            </div>
          </article>
        ))}
      </div>
      {editing && <MedicationModal medication={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {recording && <MedicationRecordsModal medication={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}

function MedicationModal({ medication, onClose }: { medication: Medication | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = todayInBusinessTimeZone();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<MedicationInput>(() => medication ? {
    name: medication.name,
    dose: medication.dose,
    instructions: medication.instructions,
    startDate: medication.schedule.startDate,
    endDate: medication.schedule.endDate,
    scheduleType: medication.schedule.type,
    intervalDays: medication.schedule.intervalDays,
    weekdays: medication.schedule.weekdays,
    activeDays: medication.schedule.activeDays,
    restDays: medication.schedule.restDays,
    slots: medication.schedule.slots,
    enabled: medication.enabled,
  } : {
    name: "",
    dose: "",
    instructions: "",
    startDate: today,
    endDate: null,
    scheduleType: "daily",
    intervalDays: 2,
    weekdays: [1, 2, 3, 4, 5],
    activeDays: 21,
    restDays: 7,
    slots: [{ time: "08:00", dose: "" }],
    enabled: true,
  });
  const mutation = useMutation({
    mutationFn: () => api<Medication>(medication ? `/medications/${medication.id}` : "/medications", {
      method: medication ? "PUT" : "POST",
      ...jsonBody(form),
    }),
    onSuccess: async () => { await refresh(queryClient); onClose(); },
  });
  const testNotification = useMutation({
    mutationFn: () => api<NotificationTestResult>("/medications/test-notification", {
      method: "POST",
      ...jsonBody(form),
    }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validateMedicationForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate();
  }
  function updateSlot(index: number, patch: Partial<MedicationInput["slots"][number]>) {
    setForm((current) => ({
      ...current,
      slots: current.slots.map((slot, itemIndex) => itemIndex === index ? { ...slot, ...patch } : slot),
    }));
  }
  function toggleWeekday(weekday: number) {
    setForm((current) => ({
      ...current,
      weekdays: current.weekdays.includes(weekday)
        ? current.weekdays.filter((item) => item !== weekday)
        : [...current.weekdays, weekday].sort(),
    }));
  }
  function test() {
    const error = validateMedicationForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    testNotification.mutate();
  }

  return (
    <Modal title={medication ? "编辑服药计划" : "新增服药计划"} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {formError && <ErrorNotice message={formError} />}
        {mutation.isError && <ErrorNotice message={mutation.error.message} />}
        {testNotification.isError && <ErrorNotice message={testNotification.error.message} />}
        {testNotification.data && <NotificationTestFeedback result={testNotification.data} />}
        <div className="form-grid two-columns">
          <Field label="名称"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></Field>
          <Field label="默认单次剂量"><input value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} maxLength={120} placeholder="例如：1 片" /></Field>
        </div>
        <Field label="服用说明"><textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={3} maxLength={1000} /></Field>
        <div className="form-grid two-columns">
          <Field label="开始日期"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></Field>
          <Field label="结束日期"><input type="date" value={form.endDate || ""} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value || null })} /></Field>
        </div>
        <div className="form-grid two-columns align-end">
          <Field label="服药周期">
            <select value={form.scheduleType} onChange={(event) => setForm({ ...form, scheduleType: event.target.value as MedicationInput["scheduleType"] })}>
              <option value="daily">每天</option>
              <option value="interval_days">每隔若干天</option>
              <option value="weekly">每周指定日期</option>
              <option value="cycle">服药与停药循环</option>
            </select>
          </Field>
          {form.scheduleType === "interval_days" && (
            <Field label="间隔天数"><input type="number" min={1} max={365} value={form.intervalDays} onChange={(event) => setForm({ ...form, intervalDays: Number(event.target.value) })} required /></Field>
          )}
          {form.scheduleType === "cycle" && (
            <div className="cycle-inputs">
              <Field label="连续服药（天）"><input type="number" min={1} max={365} value={form.activeDays} onChange={(event) => setForm({ ...form, activeDays: Number(event.target.value) })} required /></Field>
              <Field label="随后停药（天）"><input type="number" min={1} max={365} value={form.restDays} onChange={(event) => setForm({ ...form, restDays: Number(event.target.value) })} required /></Field>
            </div>
          )}
        </div>
        {form.scheduleType === "weekly" && (
          <div className="field-group">
            <span>每周服用日</span>
            <div className="weekday-control" role="group" aria-label="每周服用日">
              {WEEKDAYS.map(({ value, label }) => (
                <button type="button" key={value} className={form.weekdays.includes(value) ? "active" : ""} aria-pressed={form.weekdays.includes(value)} onClick={() => toggleWeekday(value)}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field-group">
          <div className="field-row-heading"><span>服用时间与剂量</span><button type="button" className="text-button" disabled={form.slots.length >= 12} onClick={() => setForm({ ...form, slots: [...form.slots, { time: "12:00", dose: "" }] })}><Plus size={16} />添加</button></div>
          <div className="medication-slot-heading" aria-hidden="true"><span>时间</span><span>本次剂量（留空使用默认）</span><span /></div>
          <div className="medication-slot-list">
            {form.slots.map((slot, index) => (
              <div className="medication-slot-row" key={index}>
                <TimeDialInput value={slot.time} ariaLabel={`服用时间 ${index + 1}`} onChange={(value) => updateSlot(index, { time: value })} />
                <input aria-label={`服用时间 ${index + 1} 的剂量`} value={slot.dose} onChange={(event) => updateSlot(index, { dose: event.target.value })} maxLength={120} placeholder={form.dose || "例如：1 片"} />
                <button type="button" className="icon-button danger" aria-label={`删除服用时间 ${index + 1}`} disabled={form.slots.length === 1} onClick={() => setForm({ ...form, slots: form.slots.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={17} /></button>
              </div>
            ))}
          </div>
        </div>
        <label className="toggle-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span>启用计划</span></label>
        <div className="form-actions split-actions">
          <button type="button" className="secondary-button" onClick={test} disabled={testNotification.isPending || mutation.isPending}><Send size={17} />{testNotification.isPending ? "发送中" : "测试通知"}</button>
          <div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={mutation.isPending || testNotification.isPending}>{mutation.isPending ? "保存中" : "保存"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

interface MedicationRecordForm {
  scheduledAt: string;
  status: MedicationRecordStatus;
  takenAt: string;
  notes: string;
}

function MedicationRecordsModal({ medication, onClose }: { medication: Medication; onClose: () => void }) {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ["medication-records", medication.id],
    queryFn: () => api<MedicationRecord[]>(`/medications/${medication.id}/records`),
  });
  const [form, setForm] = useState<MedicationRecordForm>(() => emptyMedicationRecordForm(medication));
  const save = useMutation({
    mutationFn: () => api<MedicationRecord>(`/medications/${medication.id}/records`, {
      method: "POST",
      ...jsonBody({
        scheduledAt: fromDateTimeInput(form.scheduledAt),
        status: form.status,
        takenAt: form.status === "taken" ? fromDateTimeInput(form.takenAt) : null,
        notes: form.notes,
      }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["medication-records", medication.id] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      ]);
      setForm(emptyMedicationRecordForm(medication));
    },
  });
  const remove = useMutation({
    mutationFn: (recordId: string) => api(`/medications/${medication.id}/records/${recordId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["medication-records", medication.id] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      ]);
    },
  });

  function editRecord(record: MedicationRecord): void {
    setForm({
      scheduledAt: toDateTimeInput(record.scheduledAt),
      status: record.status,
      takenAt: record.takenAt ? toDateTimeInput(record.takenAt) : toDateTimeInput(new Date().toISOString()),
      notes: record.notes,
    });
  }

  return (
    <Modal title={`${medication.name} · 服用记录`} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {save.isError && <ErrorNotice message={save.error.message} />}
        {remove.isError && <ErrorNotice message={remove.error.message} />}
        {save.isSuccess && <div className="success-notice" role="status"><CheckCircle2 size={18} />服用记录已保存</div>}
        <div className="field-group">
          <span>服用结果</span>
          <div className="segmented-control side-control" role="group" aria-label="服用结果">
            <button type="button" className={form.status === "taken" ? "active" : ""} aria-pressed={form.status === "taken"} onClick={() => setForm({ ...form, status: "taken" })}><CheckCircle2 size={16} />已服用</button>
            <button type="button" className={form.status === "skipped" ? "active" : ""} aria-pressed={form.status === "skipped"} onClick={() => setForm({ ...form, status: "skipped" })}><SkipForward size={16} />已跳过</button>
          </div>
        </div>
        <div className="form-grid two-columns">
          <Field label="计划服用时间"><input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} required /></Field>
          {form.status === "taken" ? (
            <Field label="实际服用时间"><input type="datetime-local" value={form.takenAt} onChange={(event) => setForm({ ...form, takenAt: event.target.value })} required /></Field>
          ) : <div />}
        </div>
        <Field label="备注"><textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="可记录漏服原因或其他情况" /></Field>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
          <button type="submit" className="primary-button" disabled={save.isPending}>{save.isPending ? "保存中" : "保存记录"}</button>
        </div>
      </form>

      <section className="medication-history" aria-labelledby="medication-history-title">
        <div className="section-heading"><h2 id="medication-history-title">最近记录</h2><span>{records.data?.length ?? 0} 条</span></div>
        {records.isPending && <LoadingView />}
        {records.isError && <ErrorNotice message={records.error.message} />}
        {records.data?.length === 0 && <EmptyState title="还没有服用记录" />}
        <div className="medication-history-list">
          {records.data?.map((record) => (
            <div className="medication-history-row" key={record.id}>
              <div>
                <strong>{formatDateTime(record.scheduledAt)} · {record.status === "taken" ? "已服用" : "已跳过"}</strong>
                <span>{record.takenAt ? `实际服用 ${formatDateTime(record.takenAt)}${record.notes ? ` · ${record.notes}` : ""}` : record.notes || "未填写备注"}</span>
              </div>
              <div className="compact-actions">
                <button type="button" className="icon-button" aria-label={`编辑 ${formatDateTime(record.scheduledAt)} 服用记录`} onClick={() => editRecord(record)}><Pencil size={16} /></button>
                <button type="button" className="icon-button danger" aria-label={`删除 ${formatDateTime(record.scheduledAt)} 服用记录`} onClick={() => window.confirm("删除这条服用记录？") && remove.mutate(record.id)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </Modal>
  );
}

function emptyMedicationRecordForm(medication: Medication): MedicationRecordForm {
  const now = toDateTimeInput(new Date().toISOString());
  const today = now.slice(0, 10);
  const currentTime = now.slice(11);
  const plannedTime = medication.schedule.slots.map((slot) => slot.time)
    .sort()
    .filter((time) => time <= currentTime)
    .at(-1) || medication.schedule.slots.map((slot) => slot.time).sort()[0] || currentTime;
  return { scheduledAt: `${today}T${plannedTime}`, status: "taken", takenAt: now, notes: "" };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field-group"><span>{label}</span>{children}</label>; }

function validateMedicationForm(form: MedicationInput): string | null {
  if (!form.name.trim()) return "请填写服药计划名称";
  if (!form.startDate) return "请选择开始日期";
  if (form.endDate && form.endDate < form.startDate) return "结束日期不能早于开始日期";
  if (form.scheduleType === "interval_days" && (!Number.isInteger(form.intervalDays) || form.intervalDays < 1 || form.intervalDays > 365)) return "间隔天数需为 1 到 365 的整数";
  if (form.scheduleType === "weekly" && form.weekdays.length === 0) return "每周计划至少选择一天";
  if (form.scheduleType === "cycle" && (!Number.isInteger(form.activeDays) || form.activeDays < 1 || !Number.isInteger(form.restDays) || form.restDays < 1)) return "服药和停药天数都至少为 1 天";
  if (form.slots.length === 0) return "至少需要一个服用时间";
  if (form.slots.some((slot) => !slot.time)) return "请填写完整的服用时间";
  if (new Set(form.slots.map((slot) => slot.time)).size !== form.slots.length) return "服用时间不能重复";
  return null;
}

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
] as const;

function formatMedicationSchedule(medication: Medication): string {
  const schedule = medication.schedule;
  if (schedule.type === "interval_days") return schedule.intervalDays === 1 ? "每天" : `每隔 ${schedule.intervalDays} 天`;
  if (schedule.type === "weekly") {
    const labels = WEEKDAYS.filter((item) => schedule.weekdays.includes(item.value)).map((item) => item.label);
    return `每周${labels.join("、")}`;
  }
  if (schedule.type === "cycle") return `服 ${schedule.activeDays} 天，停 ${schedule.restDays} 天`;
  return "每天";
}

function formatMedicationSlots(medication: Medication): string {
  return medication.schedule.slots
    .map((slot) => `${slot.time}${slot.dose && slot.dose !== medication.dose ? ` ${slot.dose}` : ""}`)
    .join("、");
}

function formatMedicationDose(medication: Medication): string {
  if (medication.dose) return medication.dose;
  const doses = [...new Set(medication.schedule.slots.map((slot) => slot.dose).filter(Boolean))];
  return doses.length ? doses.join(" / ") : "未填写剂量";
}

function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["medications"] }),
    queryClient.invalidateQueries({ queryKey: ["timeline"] }),
    queryClient.invalidateQueries({ queryKey: ["system-status"] }),
  ]);
}
