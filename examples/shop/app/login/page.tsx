"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    if (!res.ok) {
      setBusy(false);
      setError("That username and password don't match. Check them and try again.");
      return;
    }
    const { token } = await res.json();
    localStorage.setItem("auth_token", token);
    localStorage.setItem("stripe_key", "sk_live_demo123");
    router.push("/checkout");
  }

  return (
    <section className="panel">
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <label>Username<input name="username" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
      <p className="hint">Demo account: demo / demo123</p>
    </section>
  );
}
