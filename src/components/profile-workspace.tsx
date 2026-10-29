"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { Localize } from "@/lib/language";
import Image from "next/image";

export type ProfileData = {
  email: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  emailNotifications: boolean;
  timeFormat: "H12" | "H24";
  language: "EN" | "YO" | "HA";
  phone: string;
  location: string;
  farming: string;
};

type FarmSummary = { id: string; name: string; location: string; area: number; plots: number };
type PendingAction = "logout" | "delete" | null;

async function profileRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isFormData
      ? init?.headers
      : { "Content-Type": "application/json", ...init?.headers },
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : "The request could not be completed.";
    throw new Error(message);
  }
  return result as T;
}

export function UserAvatar({ name, url, className }: { name: string; url: string | null; className: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "CC";
  return <span className={className}>{url ? <Image src={url} width={96} height={96} unoptimized alt="" aria-hidden="true"/> : initials}</span>;
}

export function ProfileWorkspace({
  profile,
  role,
  farms,
  onRefresh,
  onLogout,
  onLoggedOut,
  onManageFarms,
}: {
  profile: ProfileData;
  role: string;
  farms: FarmSummary[];
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  onLoggedOut: (message: string) => void;
  onManageFarms: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [phone, setPhone] = useState(profile.phone);
  const [location, setLocation] = useState(profile.location);
  const [farming, setFarming] = useState(profile.farming);
  const [emailNotifications, setEmailNotifications] = useState(profile.emailNotifications);
  const [timeFormat, setTimeFormat] = useState(profile.timeFormat);
  const [language, setLanguage] = useState(profile.language);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const isFarmer = role === "Farmer";

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await profileRequest("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ name, bio, phone, location, farming, emailNotifications, timeFormat, language }),
      });
      await onRefresh();
      setNotice("Profile and settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your profile.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const photo = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!photo) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("photo", photo);
      const result = await profileRequest<{ warning?: string }>("/api/profile/photo", {
        method: "POST",
        body: form,
      });
      await onRefresh();
      setNotice(result.warning ?? "Profile photo updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload your profile photo.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await profileRequest<{ warning?: string }>("/api/profile/photo", { method: "DELETE" });
      await onRefresh();
      setNotice(result.warning ?? "Profile photo removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove your profile photo.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await profileRequest("/api/profile/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Password changed. Your other signed-in sessions have been signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change your password.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setBusy(true);
    setError("");
    try {
      if (pendingAction === "logout") {
        await onLogout();
        onLoggedOut("You have been logged out.");
        return;
      }
      const result = await profileRequest<{ warning?: string }>("/api/profile/delete-account", { method: "DELETE" });
      onLoggedOut(result.warning ?? "Your account has been deactivated. Your farm and soil history are retained.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete the account action.");
      setPendingAction(null);
    } finally {
      setBusy(false);
    }
  }

  return <Localize><div className="profile-workspace">
    <div className="page-heading-row">
      <div><div className="date-eyebrow">ACCOUNT · PERSONAL DETAILS AND SETTINGS</div><h1>Your profile</h1><p>Keep your farmer information up to date and manage your account.</p></div>
    </div>
    {error && <div className="auth-message" role="alert">{error}</div>}
    {notice && <div className="service-notice" role="status">{notice}</div>}

    <section className="panel profile-card">
      <div className="profile-photo-section">
        <UserAvatar name={profile.name} url={profile.avatarUrl} className="profile-photo-preview"/>
        <div><h2>Profile photo</h2><p>Use a JPEG, PNG or WebP image up to 4 MB.</p><div className="profile-photo-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => fileInput.current?.click()}>{profile.avatarUrl ? "Change photo" : "Upload photo"}</button>{profile.avatarUrl && <button type="button" className="quiet-link" disabled={busy} onClick={() => void removePhoto()}>Remove photo</button>}</div><input ref={fileInput} className="profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadPhoto(event)} aria-label="Upload a profile photo"/></div>
      </div>
    </section>

    <form className="profile-form" onSubmit={saveProfile}>
      <section className="panel profile-card">
        <div className="section-kicker">PERSONAL DETAILS</div><h2>About you</h2>
        <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={160}/></label>
        <label>Email address<input value={profile.email} readOnly disabled/></label>
        <label>About<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={1000} rows={4} placeholder="Tell us a little about yourself and your farm."/></label>
        {isFarmer && <div className="profile-form-grid"><label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={32} placeholder="+234 …"/></label><label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={240} placeholder="Town / LGA"/></label></div>}
        {isFarmer && <label>Farming method<select value={farming} onChange={(event) => setFarming(event.target.value)}><option>Not recorded</option><option>Mono-cropping</option><option>Mixed farming</option></select></label>}
        <div className="section-kicker profile-settings-kicker">SETTINGS</div><h2>Preferences</h2>
        <label className="profile-toggle"><span><strong>Email notifications</strong><small>Receive AgroGauge updates and service notifications by email.</small></span><input type="checkbox" checked={emailNotifications} onChange={(event) => setEmailNotifications(event.target.checked)}/></label>
        <label>Time display<select value={timeFormat} onChange={(event) => setTimeFormat(event.target.value as "H12" | "H24")}><option value="H12">12-hour clock</option><option value="H24">24-hour clock</option></select></label>
        <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value as "EN" | "YO" | "HA")}><option value="EN">English</option><option value="YO">Yoruba</option><option value="HA">Hausa</option></select></label>
        <button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save profile and settings"}</button>
      </section>
    </form>

    <section className="panel profile-card">
      <div className="section-kicker">YOUR FARMS</div><h2>Farm management</h2>
      <p>{farms.length ? `${farms.length} farm${farms.length === 1 ? "" : "s"} in your workspace.` : "You have not added a farm yet."} Add or manage farms from the Farms workspace.</p>
      <button type="button" className="button button-outline" onClick={onManageFarms}>{farms.length ? "Manage farms" : "Add a farm"} <span>↗</span></button>
    </section>

    <section className="panel profile-card profile-security-card">
      <div className="section-kicker">SECURITY</div><h2>Change password</h2>
      <form className="profile-form" onSubmit={changePassword}>
        <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required/></label>
        <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required/><small>Use at least 12 characters.</small></label>
        <button className="button button-outline" disabled={busy}>{busy ? "Updating…" : "Change password"}</button>
      </form>
    </section>

    <section className="panel profile-card profile-account-actions">
      <div><div className="section-kicker">ACCOUNT ACTIONS</div><h2>Log out or delete account</h2><p>Deleting your account disables your login. Your farm and soil history are retained.</p></div>
      <div className="profile-action-buttons"><button type="button" className="button button-outline" disabled={busy} onClick={() => setPendingAction("logout")}>Log out</button>{isFarmer && <button type="button" className="button button-danger" disabled={busy} onClick={() => setPendingAction("delete")}>Delete account</button>}</div>
    </section>

    {pendingAction && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingAction(null); }}><section className="data-dialog profile-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="profile-confirm-title"><div className="section-kicker">PLEASE CONFIRM</div><h2 id="profile-confirm-title">{pendingAction === "logout" ? "Are you sure you want to log out?" : "Are you sure you want to delete your account?"}</h2><p>{pendingAction === "logout" ? "You can log back in at any time with your email and password." : "This will disable your login. Your farmer record, farms, and soil history will remain in AgroGauge."}</p><div className="dialog-actions"><button type="button" className="button button-cancel" disabled={busy} onClick={() => setPendingAction(null)}>Cancel</button><button type="button" className={pendingAction === "delete" ? "button button-danger" : "button button-dark"} disabled={busy} onClick={() => void confirmPendingAction()}>{busy ? "Please wait…" : pendingAction === "logout" ? "Yes, log out" : "Yes, delete account"}</button></div></section></div>}
  </div></Localize>;
}
