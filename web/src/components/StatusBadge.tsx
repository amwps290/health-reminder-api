const labels: Record<string, string> = {
  pending: "待发送",
  processing: "发送中",
  retry: "重试中",
  sent: "已发送",
  failed: "失败",
  canceled: "已取消",
  open: "待询问",
  answered: "已回答",
  archived: "已归档",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status}`}>{labels[status] || status}</span>;
}
