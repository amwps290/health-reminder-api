import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, KeyRound, LogIn, WifiOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, jsonBody } from "../api";
import { ErrorNotice } from "../components/StateViews";

export function LoginPage({ connectionError = false }: { connectionError?: boolean }) {
  const [token, setToken] = useState("");
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: () => api<{ authenticated: boolean }>("/auth/login", { method: "POST", ...jsonBody({ token }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand"><HeartPulse size={28} /><span>健康提醒</span></div>
        <div className="login-heading">
          <h1>管理端登录</h1>
          <p>输入 Worker 管理令牌</p>
        </div>
        {connectionError && <ErrorNotice message="暂时无法连接服务" />}
        {login.isError && <ErrorNotice message={login.error.message} />}
        <form onSubmit={submit} className="form-stack">
          <label className="field-label" htmlFor="admin-token">管理令牌</label>
          <div className="input-with-icon">
            <KeyRound size={18} />
            <input
              id="admin-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="current-password"
              minLength={16}
              required
              autoFocus
            />
          </div>
          <button className="primary-button full-width" type="submit" disabled={login.isPending || token.length < 16}>
            {connectionError ? <WifiOff size={18} /> : <LogIn size={18} />}
            <span>{login.isPending ? "正在登录" : "登录"}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
