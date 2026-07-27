import { useQuery } from "@tanstack/react-query";
import { Activity, BellRing, CheckCircle2, Clock3, RefreshCw, Server, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import type { Delivery, SystemStatus } from "../types";
import { formatDateTime } from "../utils";

export function SystemPage() {
  const status = useQuery({ queryKey: ["system-status"], queryFn: () => api<SystemStatus>("/system/status") });
  const deliveries = useQuery({ queryKey: ["deliveries"], queryFn: () => api<Delivery[]>("/deliveries?limit=50") });

  return (
    <div className="page-container">
      <PageHeader title="系统状态" subtitle="调度与推送记录" actions={
        <button className="secondary-button" aria-label="刷新" title="刷新系统状态" onClick={() => { void status.refetch(); void deliveries.refetch(); }}><RefreshCw size={17} /><span>刷新</span></button>
      } />
      {status.isPending && <LoadingView />}
      {status.isError && <ErrorNotice message={status.error.message} />}
      {status.data && (
        <section className="system-summary">
          <div className="system-health"><span className="health-indicator"><Activity size={20} /></span><div><strong>Worker 正常</strong><span>{status.data.timezone}</span></div></div>
          <dl className="system-facts">
            <div><dt><Clock3 size={16} />待发送</dt><dd>{status.data.jobs.pending}</dd></div>
            <div><dt><RefreshCw size={16} />重试中</dt><dd>{status.data.jobs.retrying}</dd></div>
            <div><dt><TriangleAlert size={16} />失败</dt><dd>{status.data.jobs.failed}</dd></div>
            <div><dt><Server size={16} />最后调度</dt><dd>{formatRunTime(status.data.lastSchedulerRun)}</dd></div>
          </dl>
        </section>
      )}

      <section className="content-section">
        <div className="section-heading"><h2>最近投递</h2><span>{deliveries.data?.length ?? 0} 条</span></div>
        {deliveries.isPending && <LoadingView />}
        {deliveries.isError && <ErrorNotice message={deliveries.error.message} />}
        {deliveries.data?.length === 0 && <EmptyState title="还没有投递记录" />}
        <div className="delivery-list">
          {deliveries.data?.map((delivery) => (
            <article className="delivery-row" key={delivery.id}>
              <span className={delivery.success ? "delivery-icon success" : "delivery-icon failed"}>{delivery.success ? <CheckCircle2 size={18} /> : <BellRing size={18} />}</span>
              <div><strong>{delivery.title}</strong><span>{formatDateTime(delivery.attempted_at)}</span></div>
              <span className={delivery.success ? "delivery-result success" : "delivery-result failed"}>{delivery.success ? "成功" : delivery.error_code || "失败"}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatRunTime(run: Record<string, unknown> | null): string {
  const value = run?.finished_at;
  return typeof value === "string" ? formatDateTime(value) : "尚未运行";
}
