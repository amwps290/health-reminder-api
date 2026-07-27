import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, FileText, MessageCircleQuestion, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import { StatusBadge } from "../components/StatusBadge";
import type { HealthEvent, MedicalNote, Question } from "../types";
import { formatDate, fromDateTimeInput, toDateTimeInput } from "../utils";

type Editor = { kind: "note"; item: MedicalNote | null } | { kind: "question"; item: Question | null } | null;

export function MedicalPage() {
  const [tab, setTab] = useState<"notes" | "questions">("notes");
  const [editor, setEditor] = useState<Editor>(null);
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: ["medical-notes"], queryFn: () => api<MedicalNote[]>("/medical-notes") });
  const questions = useQuery({ queryKey: ["questions"], queryFn: () => api<Question[]>("/questions") });
  const events = useQuery({ queryKey: ["events"], queryFn: () => api<HealthEvent[]>("/events") });
  const remove = useMutation({
    mutationFn: ({ kind, id }: { kind: "note" | "question"; id: string }) => api(kind === "note" ? `/medical-notes/${id}` : `/questions/${id}`, { method: "DELETE" }),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: [variables.kind === "note" ? "medical-notes" : "questions"] }),
  });

  const activeCount = questions.data?.filter((item) => item.status === "open").length ?? 0;
  return (
    <div className="page-container">
      <PageHeader title="医嘱与问题" subtitle={`${notes.data?.length ?? 0} 条医嘱 · ${activeCount} 个待询问`} actions={
        <button className="primary-button" aria-label="新增" title="新增记录" onClick={() => setEditor({ kind: tab === "notes" ? "note" : "question", item: null })}><Plus size={18} /><span>新增</span></button>
      } />
      <div className="segmented-control" role="tablist">
        <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")} role="tab"><FileText size={17} />医嘱</button>
        <button className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")} role="tab"><MessageCircleQuestion size={17} />就诊问题</button>
      </div>
      {remove.isError && <ErrorNotice message={remove.error.message} />}

      {tab === "notes" && (
        <section className="content-section unframed">
          {notes.isPending && <LoadingView />}
          {notes.isError && <ErrorNotice message={notes.error.message} />}
          {notes.data?.length === 0 && <EmptyState title="还没有医嘱记录" />}
          <div className="record-list">
            {notes.data?.map((note) => (
              <article className="record-item" key={note.id}>
                <div className="record-rail"><ClipboardList size={18} /></div>
                <div className="record-content">
                  <div className="record-heading"><div><h2>{note.title}</h2><span>{formatDate(note.recordedAt)}{note.source ? ` · ${note.source}` : ""}</span></div><RecordActions onEdit={() => setEditor({ kind: "note", item: note })} onDelete={() => window.confirm(`删除“${note.title}”？`) && remove.mutate({ kind: "note", id: note.id })} /></div>
                  <p>{note.content}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "questions" && (
        <section className="content-section unframed">
          {questions.isPending && <LoadingView />}
          {questions.isError && <ErrorNotice message={questions.error.message} />}
          {questions.data?.length === 0 && <EmptyState title="还没有就诊问题" />}
          <div className="question-list">
            {questions.data?.map((question) => (
              <article className="question-item" key={question.id}>
                <div className="question-check">{question.status === "answered" ? <CheckCircle2 size={20} /> : <MessageCircleQuestion size={20} />}</div>
                <div className="question-main"><div className="question-heading"><h2>{question.content}</h2><StatusBadge status={question.status} /></div>{question.answer && <p><strong>记录：</strong>{question.answer}</p>}</div>
                <RecordActions onEdit={() => setEditor({ kind: "question", item: question })} onDelete={() => window.confirm("删除这个问题？") && remove.mutate({ kind: "question", id: question.id })} />
              </article>
            ))}
          </div>
        </section>
      )}

      {editor?.kind === "note" && <NoteModal note={editor.item} onClose={() => setEditor(null)} />}
      {editor?.kind === "question" && <QuestionModal question={editor.item} events={events.data ?? []} onClose={() => setEditor(null)} />}
    </div>
  );
}

function NoteModal({ note, onClose }: { note: MedicalNote | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: note?.title ?? "",
    content: note?.content ?? "",
    source: note?.source ?? "",
    recordedAt: toDateTimeInput(note?.recordedAt ?? new Date().toISOString()),
  });
  const mutation = useMutation({
    mutationFn: () => api(note ? `/medical-notes/${note.id}` : "/medical-notes", { method: note ? "PUT" : "POST", ...jsonBody({ ...form, recordedAt: fromDateTimeInput(form.recordedAt) }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["medical-notes"] }); onClose(); },
  });
  return (
    <Modal title={note ? "编辑医嘱" : "新增医嘱"} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const error = validateNoteForm(form);
        if (error) {
          setFormError(error);
          return;
        }
        setFormError(null);
        mutation.mutate();
      }}>
        {formError && <ErrorNotice message={formError} />}
        {mutation.isError && <ErrorNotice message={mutation.error.message} />}
        <Field label="标题"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} /></Field>
        <Field label="医嘱原文"><textarea rows={7} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required maxLength={10000} /></Field>
        <div className="form-grid two-columns">
          <Field label="来源"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} maxLength={300} /></Field>
          <Field label="记录时间"><input type="datetime-local" value={form.recordedAt} onChange={(e) => setForm({ ...form, recordedAt: e.target.value })} required /></Field>
        </div>
        <FormActions pending={mutation.isPending} onClose={onClose} />
      </form>
    </Modal>
  );
}

function QuestionModal({ question, events, onClose }: { question: Question | null; events: HealthEvent[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ eventId: question?.eventId ?? null, content: question?.content ?? "", status: question?.status ?? "open", answer: question?.answer ?? "", sortOrder: question?.sortOrder ?? 0 });
  const mutation = useMutation({
    mutationFn: () => api(question ? `/questions/${question.id}` : "/questions", { method: question ? "PUT" : "POST", ...jsonBody(form) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["questions"] }); onClose(); },
  });
  return (
    <Modal title={question ? "编辑问题" : "新增问题"} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const error = validateQuestionForm(form);
        if (error) {
          setFormError(error);
          return;
        }
        setFormError(null);
        mutation.mutate();
      }}>
        {formError && <ErrorNotice message={formError} />}
        {mutation.isError && <ErrorNotice message={mutation.error.message} />}
        <Field label="问题"><textarea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required maxLength={2000} /></Field>
        <div className="form-grid two-columns">
          <Field label="关联事项"><select value={form.eventId ?? ""} onChange={(e) => setForm({ ...form, eventId: e.target.value || null })}><option value="">不关联</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></Field>
          <Field label="状态"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Question["status"] })}><option value="open">待询问</option><option value="answered">已回答</option><option value="archived">已归档</option></select></Field>
        </div>
        <Field label="回答记录"><textarea rows={5} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} maxLength={5000} /></Field>
        <FormActions pending={mutation.isPending} onClose={onClose} />
      </form>
    </Modal>
  );
}

function RecordActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) { return <div className="compact-actions"><button className="icon-button" onClick={onEdit} aria-label="编辑"><Pencil size={16} /></button><button className="icon-button danger" onClick={onDelete} aria-label="删除"><Trash2 size={16} /></button></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field-group"><span>{label}</span>{children}</label>; }
function FormActions({ pending, onClose }: { pending: boolean; onClose: () => void }) { return <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={pending}>{pending ? "保存中" : "保存"}</button></div>; }

function validateNoteForm(form: { title: string; content: string; recordedAt: string }): string | null {
  if (!form.title.trim()) return "请填写医嘱标题";
  if (!form.content.trim()) return "请填写医嘱原文";
  if (!form.recordedAt) return "请选择记录时间";
  return null;
}

function validateQuestionForm(form: { content: string }): string | null {
  if (!form.content.trim()) return "请填写就诊问题";
  return null;
}
