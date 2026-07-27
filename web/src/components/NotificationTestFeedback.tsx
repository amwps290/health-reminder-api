import { CheckCircle2 } from "lucide-react";
import type { NotificationTestResult } from "../types";

export function NotificationTestFeedback({ result }: { result: NotificationTestResult }) {
  return (
    <div className="notification-test-feedback" role="status">
      <CheckCircle2 size={18} />
      <div>
        <strong>{result.title}</strong>
        <span>{result.body}</span>
      </div>
    </div>
  );
}
