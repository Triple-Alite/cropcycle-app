"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import PasswordVisibilityToggle from "@/components/password-visibility-toggle";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Password could not be updated.",
        );
      }
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password could not be updated.");
    }
  }

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link className="landing-brand" href="/">
          <span className="brand-mark">c</span>
          <span>cropcycle<span className="brand-period">.</span></span>
        </Link>
      </header>
      <section className="auth-page-wrap">
        <section className="auth-dialog" aria-labelledby="reset-title">
          <span className="brand-mark" role="img" aria-label="CropCycle logo"/>
          <div className="auth-kicker">CROPCYCLE WORKSPACE</div>
          <h1 id="reset-title">{complete ? "Password updated." : "Choose a new password."}</h1>
          {complete ? (
            <>
              <p className="auth-subtitle">Your password has been changed. Sign in with your new password.</p>
              <Link className="button button-dark auth-submit" href="/">Return to CropCycle <span>↗</span></Link>
            </>
          ) : !token ? (
            <>
              <p className="auth-subtitle">This password reset link is invalid or missing.</p>
              <Link className="button button-dark auth-submit" href="/">Return to CropCycle <span>↗</span></Link>
            </>
          ) : (
            <>
              <p className="auth-subtitle">Choose a strong password with at least 12 characters.</p>
              <form className="auth-form" onSubmit={submit}>
                <label>New password
                  <div className="password-field">
                    <input type={visible ? "text" : "password"} name="password" autoComplete="new-password" minLength={12} maxLength={128} required/>
                    <PasswordVisibilityToggle visible={visible} onToggle={() => setVisible(!visible)}/>
                  </div>
                </label>
                <label>Confirm new password<input type={visible ? "text" : "password"} name="confirmation" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
                {error && <div className="auth-message" role="alert">{error}</div>}
                <button className="button button-dark auth-submit">Update password <span>↗</span></button>
              </form>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
