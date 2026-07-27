import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";

export function LoadingView({ label = "正在加载" }: { label?: string }) {
  return <div className="state-view"><LoaderCircle className="spin" size={24} /><span>{label}</span></div>;
}

export function EmptyState({ title }: { title: string }) {
  return <div className="empty-state"><Inbox size={24} /><span>{title}</span></div>;
}

export function ErrorNotice({ message }: { message: string }) {
  return <div className="error-notice" role="alert"><AlertCircle size={18} /><span>{message}</span></div>;
}
