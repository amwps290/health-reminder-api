import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Clock3, MapPin, Pencil, Plus, Repeat2, Send, Syringe, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { NotificationTestFeedback } from "../components/NotificationTestFeedback";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import { TimeDialInput } from "../components/TimeDialInput";
import type { Injection, InjectionInput, InjectionSide, NotificationTestResult } from "../types";

const sideLabels: Record<InjectionSide, string> = { left: "左侧", right: "右侧" };

export function InjectionsPage() {
  const [editing, setEditing] = useState<Injection | null | "new">(null);
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
              <div><Repeat2 size={16} /><span>首次{sideLabels[item.firstSide]}，以后每次交替</span></div>
              <div><MapPin size={16} /><span>{item.site || "未指定部位"}</span></div>
              <div><CalendarRange size={16} /><span>{item.startDate} 至 {item.endDate || "长期"}</span></div>
            </div>
            {item.instructions && <p className="item-note">{item.instructions}</p>}
            <div className="item-actions">
              <button className="text-button" onClick={() => setEditing(item)}><Pencil size={16} />编辑</button>
              <button className="danger-text-button" onClick={() => window.confirm(`删除“${item.name}”？`) && remove.mutate(item.id)}><Trash2 size={16} />删除</button>
            </div>
          </article>
        ))}
      </div>
      {editing && <InjectionModal injection={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function InjectionModal({ injection, onClose }: { injection: Injection | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
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
