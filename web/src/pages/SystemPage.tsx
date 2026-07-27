import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BellRing, CheckCircle2, Clock3, FileJson, FileUp, RefreshCw, RotateCcw, Server, Table2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { api, downloadApiFile, jsonBody } from "../api";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorNotice, LoadingView } from "../components/StateViews";
import type { Delivery, SystemStatus } from "../types";
import { formatDateTime } from "../utils";

export function SystemPage() {
  const queryClient = useQueryClient();
  const [restoreCandidate, setRestoreCandidate] = useState<RestoreCandidate | null>(null);
  const restoreFileInput = useRef<HTMLInputElement>(null);
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
  const backup = useMutation({
    mutationFn: (format: "json" | "csv") => downloadApiFile(`/backup/export?format=${format}`),
    onSuccess: ({ blob, filename }) => saveFile(blob, filename),
  });
  const validateRestore = useMutation({
    mutationFn: async (file: File): Promise<RestoreCandidate> => {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("请选择 JSON 备份文件");
      const text = await file.text();
      let document: unknown;
      try {
        document = JSON.parse(text);
      } catch {
        throw new Error("备份文件不是有效 JSON");
      }
      const preview = await api<BackupPreview>("/backup/validate", {
        method: "POST",
        body: text,
        headers: { "Content-Type": "application/json" },
      });
      return { filename: file.name, document, preview };
    },
    onSuccess: setRestoreCandidate,
  });
  const restore = useMutation({
    mutationFn: () => api<{ restoredAt: string }>("/backup/restore", {
      method: "POST",
      ...jsonBody({ backup: restoreCandidate?.document, confirm: "RESTORE" }),
    }),
    onSuccess: async () => {
      setRestoreCandidate(null);
      await queryClient.invalidateQueries();
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
        <>
          <button className="secondary-button" aria-label="刷新" title="刷新系统状态" onClick={() => { void status.refetch(); void deliveries.refetch(); }}><RefreshCw size={17} /><span>刷新</span></button>
        </>
      } />
      {status.isPending && <LoadingView />}
      {status.isError && <ErrorNotice message={status.error.message} />}
      {retryJob.isError && <ErrorNotice message={retryJob.error.message} />}
      {backup.isError && <ErrorNotice message={backup.error.message} />}
      {validateRestore.isError && <ErrorNotice message={validateRestore.error.message} />}
      {restore.isError && <ErrorNotice message={restore.error.message} />}
      {backup.isSuccess && (
        <div className="success-notice" role="status">
          <CheckCircle2 size={18} />备份文件已下载
        </div>
      )}
      {retryJob.isSuccess && (
        <div className="success-notice" role="status">
          <CheckCircle2 size={18} />通知任务已重新加入发送队列
        </div>
      )}
      {restore.isSuccess && <div className="success-notice" role="status"><CheckCircle2 size={18} />备份已恢复</div>}
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

      <section className="content-section backup-section">
        <div className="section-heading"><h2>备份与恢复</h2><span>不包含 Secrets 和 Bark device key</span></div>
        <div className="backup-actions">
          <div>
            <strong>导出当前数据</strong>
            <span>JSON 可恢复；CSV 便于用表格工具审阅</span>
          </div>
          <button className="secondary-button" onClick={() => backup.mutate("json")} disabled={backup.isPending}><FileJson size={17} />导出 JSON</button>
          <button className="secondary-button" onClick={() => backup.mutate("csv")} disabled={backup.isPending}><Table2 size={17} />导出 CSV</button>
          <button type="button" className="secondary-button" onClick={() => restoreFileInput.current?.click()} disabled={validateRestore.isPending}>
            <FileUp size={17} />{validateRestore.isPending ? "校验中" : "校验并恢复"}
          </button>
          <input ref={restoreFileInput} className="visually-hidden" type="file" accept="application/json,.json" disabled={validateRestore.isPending} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) validateRestore.mutate(file);
              event.currentTarget.value = "";
            }} />
        </div>
      </section>

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
      {restoreCandidate && (
        <RestorePreviewModal
          candidate={restoreCandidate}
          pending={restore.isPending}
          onClose={() => setRestoreCandidate(null)}
          onRestore={() => restore.mutate()}
        />
      )}
    </div>
  );
}

interface BackupPreview {
  valid: true;
  version: number;
  exportedAt: string;
  timezone: string;
  incoming: Record<string, number>;
  existing: Record<string, number>;
  warnings: string[];
}

interface RestoreCandidate {
  filename: string;
  document: unknown;
  preview: BackupPreview;
}

const backupTableLabels: Record<string, string> = {
  profiles: "成员配置",
  notificationTargets: "通知目标",
  medications: "服药",
  medicationSchedules: "服药日程",
  medicationTimes: "服药时间",
  medicationRecords: "服药记录",
  injectionPlans: "注射计划",
  injectionRecords: "注射记录",
  events: "就诊事项",
  eventReminders: "就诊提醒",
  medicalNotes: "医嘱",
  questions: "问题",
  pregnancySettings: "孕周设置",
  weightRecords: "体重记录",
  notificationJobs: "通知任务",
  notificationDeliveries: "投递记录",
  schedulerDailyStats: "调度日统计",
};

function RestorePreviewModal({ candidate, pending, onClose, onRestore }: {
  candidate: RestoreCandidate;
  pending: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  const rows = Object.entries(backupTableLabels).map(([key, label]) => ({
    key,
    label,
    existing: candidate.preview.existing[key] || 0,
    incoming: candidate.preview.incoming[key] || 0,
  })).filter((row) => row.existing || row.incoming);
  return (
    <Modal title="确认恢复备份" onClose={onClose}>
      <div className="restore-summary">
        <div><span>文件</span><strong>{candidate.filename}</strong></div>
        <div><span>导出时间</span><strong>{formatDateTime(candidate.preview.exportedAt)}</strong></div>
        <div><span>业务时区</span><strong>{candidate.preview.timezone}</strong></div>
      </div>
      <div className="restore-table" role="table" aria-label="恢复记录数预览">
        <div className="restore-table-header" role="row"><span role="columnheader">数据</span><span role="columnheader">当前</span><span role="columnheader">恢复后</span></div>
        {rows.map((row) => <div role="row" key={row.key}><strong role="cell">{row.label}</strong><span role="cell">{row.existing}</span><span role="cell">{row.incoming}</span></div>)}
      </div>
      <ul className="restore-warnings">{candidate.preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>取消</button>
        <button type="button" className="primary-button danger-confirm" onClick={onRestore} disabled={pending}>{pending ? "恢复中" : "确认替换并恢复"}</button>
      </div>
    </Modal>
  );
}

function healthLabel(status: SystemStatus["status"]): string {
  if (status === "healthy") return "运行正常";
  if (status === "attention") return "需要检查";
  return "暂时不可用";
}

function formatBarkStatus(status: SystemStatus): string {
  if (!status.bark.configured) return "Bark 设备未配置";
  if (!status.bark.lastSuccessfulAt) return `${status.timezone} · 尚无成功测试或投递记录`;
  const source = status.bark.lastSuccessfulSource === "test" ? "测试" : "投递";
  return `${status.timezone} · 最近${source}被 Bark 接受于 ${formatDateTime(status.bark.lastSuccessfulAt)}；不代表 iPhone 已展示`;
}

function formatRunTime(value: string | null): string {
  return value ? formatDateTime(value) : "尚未运行";
}

function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
