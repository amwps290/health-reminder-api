import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Pill,
  Settings,
  Scale,
  Syringe,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import type { SystemStatus } from "../types";

const navigation = [
  { to: "/", label: "今日", icon: LayoutDashboard, end: true },
  { to: "/medications", label: "服药", icon: Pill },
  { to: "/injections", label: "注射", icon: Syringe },
  { to: "/events", label: "就诊", icon: CalendarDays },
  { to: "/weights", label: "体重", icon: Scale },
  { to: "/medical", label: "医嘱", icon: ClipboardList },
  { to: "/system", label: "系统", icon: Settings },
];

export function AppLayout() {
  const queryClient = useQueryClient();
  const systemStatus = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api<SystemStatus>("/system/status"),
    refetchInterval: 60_000,
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] }),
  });
  const health = getSidebarHealth(systemStatus.data, systemStatus.isError);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><HeartPulse size={22} /></span>
          <span>健康提醒</span>
        </div>
        <nav className="side-nav" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink to="/system" className={`sidebar-status ${health.tone}`}>
          <BellRing size={17} />
          <span>{health.label}</span>
        </NavLink>
        <button className="nav-link logout-button" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut size={19} />
          <span>退出</span>
        </button>
      </aside>

      <main className="main-content"><Outlet /></main>

      <nav className="bottom-nav" aria-label="主导航">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? "bottom-link active" : "bottom-link"}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function getSidebarHealth(
  status: SystemStatus | undefined,
  requestFailed: boolean,
): { tone: SystemStatus["status"] | "checking"; label: string } {
  if (requestFailed) return { tone: "unavailable", label: "状态不可用" };
  if (!status) return { tone: "checking", label: "正在检查调度" };
  if (status.status === "healthy") return { tone: "healthy", label: "调度正常" };
  if (status.status === "attention") return { tone: "attention", label: "需要检查" };
  return { tone: "unavailable", label: "服务不可用" };
}
