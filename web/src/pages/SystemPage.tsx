import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BellRing, CheckCircle2, Clock3, RefreshCw, RotateCcw, Server, TriangleAlert } from "lucide-react";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import type { Delivery, SystemStatus } from "../types";
import { formatDateTime } from "../utils";

export function SystemPage() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api<SystemStatus>("/system/status"),
    refetchInterval: 60_000,
  });
  const deliveries = useQuery({
    queryKey: ["deliveries"],
    queryFn: () => api<Delivery[]>("/deliveries?limit=50"),
  });
  const retryJob = useMutation({
    mutationFn: (jobId: string) => api(`/notification-jobs/${jobId}/retry`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-status"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      ]);
    },
  });
  const retryableJobIds = new Set(
    deliveries.data
      ?.filter((delivery, index, all) =>
        delivery.job_status === "failed" &&
        all.findIndex((candidate) => candidate.job_id === delivery.job_id) === index)
      .map((delivery) => delivery.job_id),
  );

  return (
    <div className="page-container">
      <PageHeader title="系统状态" subtitle="调度与推送记录" actions={
        <button className="secondary-button" aria-label="刷新" title="刷新系统状态" onClick={() => { void status.refetch(); void deliveries.refetch(); }}><RefreshCw size={17} /><span>刷新</span></button>
      } />
      {status.isPending && <LoadingView />}
      {status.isError && <ErrorNotice message={status.error.message} />}
      {retryJob.isError && <ErrorNotice message={retryJob.error.message} />}
      {retryJob.isSuccess && (
        <div className="success-notice" role="status">
          <CheckCircle2 size={18} />通知任务已重新加入发送队列
        </div>
      )}
      {status.data && (
        <section className="system-summary">
          <div className={`system-health ${status.data.status}`}>
            <span className="health-indicator">
              {status.data.status === "healthy" ? <CheckCircle2 size={20} /> : status.data.status === "attention" ? <TriangleAlert size={20} /> : <Activity size={20} />}
            </span>
            <div>
              <strong>{healthLabel(status.data.status)}</strong>
              <span>{status.data.statusMessage}</span>
              <small>{formatBarkStatus(status.data)}</small>
            </div>
          </div>
          <dl className="system-facts">
            <div><dt><Clock3 size={16} />计划任务</dt><dd>{status.data.jobs.pending}</dd></div>
            <div><dt><RefreshCw size={16} />重试中</dt><dd>{status.data.jobs.retrying}</dd></div>
            <div><dt><TriangleAlert size={16} />失败</dt><dd>{status.data.jobs.failed}</dd></div>
            <div><dt><BellRing size={16} />已过期</dt><dd>{status.data.jobs.overdue}</dd></div>
            <div><dt><Server size={16} />最后调度</dt><dd>{formatRunTime(status.data.scheduler.lastRunAt)}</dd></div>
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
              <span className={delivery.success ? "delivery-result success" : "delivery-result failed"}>
                <span>{delivery.success ? "成功" : delivery.error_code || "失败"}</span>
                {retryableJobIds.has(delivery.job_id) && (
                  <button
                    className="text-button"
                    onClick={() => retryJob.mutate(delivery.job_id)}
                    disabled={retryJob.isPending && retryJob.variables === delivery.job_id}
                  >
                    <RotateCcw size={14} />
                    {retryJob.isPending && retryJob.variables === delivery.job_id ? "排队中" : "重新发送"}
                  </button>
                )}
              </span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function healthLabel(status: SystemStatus["status"]): string {
  if (status === "healthy") return "运行正常";
  if (status === "attention") return "需要检查";
  return "暂时不可用";
}

function formatBarkStatus(status: SystemStatus): string {
  if (!status.bark.configured) return "Bark 设备未配置";
  if (!status.bark.lastSuccessfulDeliveryAt) return `${status.timezone} · 尚无成功投递记录`;
  return `${status.timezone} · 最近成功 ${formatDateTime(status.bark.lastSuccessfulDeliveryAt)}`;
}

function formatRunTime(value: string | null): string {
  return value ? formatDateTime(value) : "尚未运行";
}
