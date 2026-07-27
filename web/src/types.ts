export interface Medication {
  id: string;
  name: string;
  dose: string;
  instructions: string;
  enabled: boolean;
  schedule: {
    id: string;
    type: string;
    timezone: string;
    startDate: string;
    endDate: string | null;
    times: string[];
    version: number;
    materializedThrough: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MedicationInput {
  name: string;
  dose: string;
  instructions: string;
  startDate: string;
  endDate: string | null;
  times: string[];
  enabled: boolean;
}

export type InjectionSide = "left" | "right";

export interface Injection {
  id: string;
  name: string;
  dose: string;
  site: string;
  instructions: string;
  startDate: string;
  endDate: string | null;
  localTime: string;
  timezone: string;
  intervalDays: number;
  firstSide: InjectionSide;
  nextSide: InjectionSide;
  enabled: boolean;
  version: number;
  materializedThrough: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InjectionInput {
  name: string;
  dose: string;
  site: string;
  instructions: string;
  startDate: string;
  endDate: string | null;
  localTime: string;
  intervalDays: number;
  firstSide: InjectionSide;
  enabled: boolean;
}

export type EventType = "registration" | "checkup" | "follow_up" | "other";

export interface HealthEvent {
  id: string;
  type: EventType;
  title: string;
  eventAt: string;
  timezone: string;
  location: string;
  notes: string;
  enabled: boolean;
  version: number;
  reminderTimes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EventInput {
  type: EventType;
  title: string;
  eventAt: string;
  location: string;
  notes: string;
  reminderTimes: string[];
  enabled: boolean;
}

export interface MedicalNote {
  id: string;
  title: string;
  content: string;
  source: string;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Question {
  id: string;
  eventId: string | null;
  content: string;
  status: "open" | "answered" | "archived";
  answer: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineJob {
  id: string;
  source_type: "medication" | "event" | "injection";
  source_id: string;
  scheduled_at: string;
  title: string;
  body: string;
  group_name: string;
  status: "pending" | "processing" | "retry" | "sent" | "failed" | "canceled";
  attempts: number;
  sent_at: string | null;
  last_error: string | null;
}

export interface SystemStatus {
  status: "healthy" | "attention" | "unavailable";
  statusMessage: string;
  timezone: string;
  currentTime: string;
  jobs: { pending: number; retrying: number; failed: number; overdue: number };
  scheduler: {
    state: "healthy" | "running" | "missing" | "stale" | "failed";
    lastRunAt: string | null;
    outcome: string | null;
    errorCode: string | null;
  };
  bark: {
    configured: boolean;
    state: "healthy" | "not_configured" | "unverified" | "stale";
    lastSuccessfulAt: string | null;
    lastSuccessfulSource: "delivery" | "test" | null;
  };
  lastSchedulerRun: Record<string, unknown> | null;
}

export type InjectionRecordStatus = "completed" | "skipped" | "rescheduled";

export interface InjectionRecord {
  id: string;
  planId: string;
  scheduledDate: string;
  status: InjectionRecordStatus;
  completedAt: string | null;
  actualSide: InjectionSide | null;
  rescheduledTo: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InjectionRecordInput {
  scheduledDate: string;
  status: InjectionRecordStatus;
  completedAt: string | null;
  actualSide: InjectionSide | null;
  rescheduledTo: string | null;
  notes: string;
}

export interface Delivery {
  id: string;
  job_id: string;
  attempted_at: string;
  success: number;
  http_status: number | null;
  provider_code: number | null;
  error_code: string | null;
  source_type: string;
  scheduled_at: string;
  title: string;
  job_status: TimelineJob["status"];
  attempts: number;
}

export interface WeightRecord {
  id: string;
  measuredOn: string;
  weightKg: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeightInput {
  measuredOn: string;
  weightKg: number;
  note: string;
}

export interface NotificationTestResult {
  accepted: boolean;
  title: string;
  body: string;
  httpStatus: number | null;
  providerCode: number | null;
  providerMessage: string | null;
  errorCode: string | null;
  scheduledDate?: string;
  side?: InjectionSide;
}

export type PregnancyStatus =
  | {
      configured: false;
      today: string;
    }
  | {
      configured: true;
      today: string;
      calibratedOn: string;
      calibrationWeeks: number;
      calibrationDays: number;
      currentWeeks: number;
      currentDays: number;
      currentTotalDays: number;
      dueDate: string;
      daysUntilDue: number;
      updatedAt: string;
    };
