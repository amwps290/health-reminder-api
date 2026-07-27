import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Clock3, MapPin, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { NotificationTestFeedback } from "../components/NotificationTestFeedback";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import { DateTimeDialInput } from "../components/TimeDialInput";
import type { EventInput, EventType, HealthEvent, NotificationTestResult } from "../types";
import { formatDateTime, fromDateTimeInput, toDateTimeInput } from "../utils";

const eventLabels: Record<EventType, string> = {
  registration: "挂号",
  checkup: "检查",
  follow_up: "复诊",
  other: "其他",
};

export function EventsPage() {
  const [editing, setEditing] = useState<HealthEvent | null | "new">(null);
  const queryClient = useQueryClient();
  const events = useQuery({ queryKey: ["events"], queryFn: () => api<HealthEvent[]>("/events") });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/events/${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(queryClient),
  });

  return (
    <div className="page-container">
      <PageHeader title="就诊事项" subtitle={`${events.data?.filter((item) => item.enabled).length ?? 0} 个有效事项`} actions={
        <button className="primary-button" aria-label="新增" title="新增就诊事项" onClick={() => setEditing("new")}><Plus size={18} /><span>新增</span></button>
      } />
      {events.isPending && <LoadingView />}
      {events.isError && <ErrorNotice message={events.error.message} />}
      {remove.isError && <ErrorNotice message={remove.error.message} />}
      {events.data?.length === 0 && <EmptyState title="还没有挂号或检查事项" />}
      <div className="item-grid">
        {events.data?.map((item) => (
          <article className={`item-card ${item.enabled ? "" : "disabled"}`} key={item.id}>
            <div className="item-card-header">
              <div className="item-title"><span className={`item-icon event event-${item.type}`}><CalendarClock size={19} /></span><div><h2>{item.title}</h2><p>{eventLabels[item.type]}</p></div></div>
              <span className={item.enabled ? "enabled-label" : "disabled-label"}>{item.enabled ? "启用" : "停用"}</span>
            </div>
            <div className="event-time">{formatDateTime(item.eventAt)}</div>
            <div className="item-details">
              {item.location && <div><MapPin size={16} /><span>{item.location}</span></div>}
              <div><Clock3 size={16} /><span>{item.reminderTimes.length} 个提醒时间</span></div>
            </div>
            {item.notes && <p className="item-note">{item.notes}</p>}
            <div className="item-actions">
              <button className="text-button" onClick={() => setEditing(item)}><Pencil size={16} />编辑</button>
              <button className="danger-text-button" onClick={() => window.confirm(`删除“${item.title}”？`) && remove.mutate(item.id)}><Trash2 size={16} />删除</button>
            </div>
          </article>
        ))}
      </div>
      {editing && <EventModal event={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EventModal({ event, onClose }: { event: HealthEvent | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const defaultEvent = new Date(Date.now() + 24 * 60 * 60_000);
  const defaultReminder = new Date(defaultEvent.getTime() - 2 * 60 * 60_000);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    type: event?.type ?? "checkup" as EventType,
    title: event?.title ?? "",
    eventAt: toDateTimeInput(event?.eventAt ?? defaultEvent.toISOString()),
    location: event?.location ?? "",
    notes: event?.notes ?? "",
    reminderTimes: (event?.reminderTimes ?? [defaultReminder.toISOString()]).map(toDateTimeInput),
    enabled: event?.enabled ?? true,
  }));
  const mutation = useMutation({
    mutationFn: () => {
      const input = toEventInput(form);
      return api(event ? `/events/${event.id}` : "/events", { method: event ? "PUT" : "POST", ...jsonBody(input) });
    },
    onSuccess: async () => { await refresh(queryClient); onClose(); },
  });
  const testNotification = useMutation({
    mutationFn: () => api<NotificationTestResult>("/events/test-notification", {
      method: "POST",
      ...jsonBody(toEventInput(form)),
    }),
  });

  function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    const error = validateEventForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate();
  }
  function test() {
    const error = validateEventForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    testNotification.mutate();
  }

  return (
    <Modal title={event ? "编辑就诊事项" : "新增就诊事项"} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {formError && <ErrorNotice message={formError} />}
        {mutation.isError && <ErrorNotice message={mutation.error.message} />}
        {testNotification.isError && <ErrorNotice message={testNotification.error.message} />}
        {testNotification.data && <NotificationTestFeedback result={testNotification.data} />}
        <div className="form-grid two-columns">
          <Field label="类型"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}>{Object.entries(eventLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label="标题"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} /></Field>
        </div>
        <div className="field-group">
          <span>事项时间</span>
          <DateTimeDialInput value={form.eventAt} ariaLabel="事项时间" onChange={(value) => setForm({ ...form, eventAt: value })} />
        </div>
        <Field label="地点"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={300} /></Field>
        <Field label="备注"><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} /></Field>
        <div className="field-group">
          <div className="field-row-heading"><span>提醒时间</span><button type="button" className="text-button" onClick={() => setForm({ ...form, reminderTimes: [...form.reminderTimes, form.eventAt] })}><Plus size={16} />添加</button></div>
          <div className="time-list">
            {form.reminderTimes.map((time, index) => (
              <div className="time-input-row wide" key={index}>
                <DateTimeDialInput
                  value={time}
                  max={form.eventAt}
                  ariaLabel={`提醒时间 ${index + 1}`}
                  onChange={(value) => setForm({ ...form, reminderTimes: form.reminderTimes.map((item, itemIndex) => itemIndex === index ? value : item) })}
                />
                <button type="button" className="icon-button danger" aria-label="删除提醒时间" disabled={form.reminderTimes.length === 1} onClick={() => setForm({ ...form, reminderTimes: form.reminderTimes.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={17} /></button>
              </div>
            ))}
          </div>
        </div>
        <label className="toggle-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span>启用事项</span></label>
        <div className="form-actions split-actions">
          <button type="button" className="secondary-button" onClick={test} disabled={testNotification.isPending || mutation.isPending}><Send size={17} />{testNotification.isPending ? "发送中" : "测试通知"}</button>
          <div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={mutation.isPending || testNotification.isPending}>{mutation.isPending ? "保存中" : "保存"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field-group"><span>{label}</span>{children}</label>; }

function validateEventForm(form: {
  title: string;
  eventAt: string;
  reminderTimes: string[];
}): string | null {
  if (!form.title.trim()) return "请填写就诊事项标题";
  if (!form.eventAt) return "请选择事项时间";
  if (form.reminderTimes.length === 0) return "至少需要一个提醒时间";
  if (form.reminderTimes.some((time) => !time)) return "请填写完整的提醒时间";
  const normalized = form.reminderTimes.map((time) => new Date(time).toISOString());
  if (new Set(normalized).size !== normalized.length) return "提醒时间不能重复";
  if (form.reminderTimes.some((time) => Date.parse(time) > Date.parse(form.eventAt))) {
    return "提醒时间不能晚于事项时间";
  }
  return null;
}

function toEventInput(form: {
  type: EventType;
  title: string;
  eventAt: string;
  location: string;
  notes: string;
  reminderTimes: string[];
  enabled: boolean;
}): EventInput {
  return {
    ...form,
    eventAt: fromDateTimeInput(form.eventAt),
    reminderTimes: form.reminderTimes.map(fromDateTimeInput),
  };
}

function refresh(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["events"] }),
    queryClient.invalidateQueries({ queryKey: ["timeline"] }),
    queryClient.invalidateQueries({ queryKey: ["system-status"] }),
  ]);
}
