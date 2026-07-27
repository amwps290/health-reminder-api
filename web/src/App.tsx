import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, ApiError } from "./api";
import { AppLayout } from "./components/AppLayout";
import { LoadingView } from "./components/StateViews";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EventsPage } from "./pages/EventsPage";
import { InjectionsPage } from "./pages/InjectionsPage";
import { MedicalPage } from "./pages/MedicalPage";
import { MedicationsPage } from "./pages/MedicationsPage";
import { SystemPage } from "./pages/SystemPage";
import { WeightsPage } from "./pages/WeightsPage";

export function App() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ authenticated: boolean }>("/auth/session"),
    retry: false,
  });

  if (session.isPending) return <LoadingView label="正在检查登录状态" />;
  if (session.error instanceof ApiError && session.error.status === 401) return <LoginPage />;
  if (session.isError) return <LoginPage connectionError />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="medications" element={<MedicationsPage />} />
        <Route path="injections" element={<InjectionsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="medical" element={<MedicalPage />} />
        <Route path="weights" element={<WeightsPage />} />
        <Route path="system" element={<SystemPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
