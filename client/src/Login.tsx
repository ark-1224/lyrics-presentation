import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";

/** Shown only when the server has APP_PASSWORD set and this browser has no valid session. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Lyric Presenter</h1>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </main>
  );
}
