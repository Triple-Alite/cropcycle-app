"use client";

import { FormEvent, useEffect, useState } from "react";

type FarmOption = { id: string; name: string };
type PlotOption = { id: string; farmId?: string; name: string };
type ServiceVisit = {
  id: string;
  serviceType: string;
  description: string;
  status: "REQUESTED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  scheduledAt: string | null;
  completedAt: string | null;
  operationsNotes: string;
  createdAt: string;
  farmId: string;
  farm: string;
  plotId: string | null;
  plot: string;
  deviceCode: string;
  requestedBy: string;
  assignedToId: string;
  assignedTo: string;
};
type StaffOption = { id: string; name: string; role: string };
type DeviceOption = { deviceCode: string; farmCode: string; status: string };
type DeviceRecord = {
  id: string;
  deviceCode: string;
  externalNodeId: string;
  apiKeyConfigured: boolean;
  type: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "RETIRED";
  ownership: "CROPCYCLE" | "CUSTOMER";
  firmware: string;
  lastConnectedAt: string | null;
  farmCode: string;
  farm: string;
  plotCode: string;
  plot: string;
};
type Inventory = {
  devices: DeviceRecord[];
  farms: Array<{ id: string; farmCode: string; name: string }>;
  plots: Array<{ plotCode: string; farmCode: string; name: string }>;
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "The request could not be completed.";
    throw new Error(message);
  }
  return payload as T;
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const serviceLabels: Record<string, string> = {
  DEVICE_SUPPORT: "Device support",
  SOIL_TESTING: "Soil testing",
  MAINTENANCE: "Maintenance",
  FARM_VISIT: "Farm visit",
  OTHER: "Other",
};

const statusLabels: Record<ServiceVisit["status"], string> = {
  REQUESTED: "Requested",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function ServiceVisitsWorkspace({
  farms,
  plots,
  visits,
  isAdmin,
  onRefresh,
}: {
  farms: FarmOption[];
  plots: PlotOption[];
  visits: ServiceVisit[];
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [farmId, setFarmId] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [loadingOperations, setLoadingOperations] = useState(isAdmin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    let mounted = true;
    void Promise.all([
      apiRequest<{ staff: StaffOption[] }>("/api/service-visits"),
      apiRequest<{ devices: Array<{ deviceCode: string; farmCode: string; status: string }> }>("/api/devices"),
    ]).then(([operations, inventory]) => {
      if (!mounted) return;
      setStaff(operations.staff);
      setDevices(inventory.devices.filter((device) => device.status !== "RETIRED"));
    }).catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : "Unable to load service operations options.");
    }).finally(() => {
      if (mounted) setLoadingOperations(false);
    });
    return () => { mounted = false; };
  }, [isAdmin]);

  async function requestVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(form);
    try {
      await apiRequest("/api/service-visits", {
        method: "POST",
        body: JSON.stringify({
          farmCode: String(data.get("farmCode") ?? ""),
          plotCode: String(data.get("plotCode") ?? "") || undefined,
          serviceType: String(data.get("serviceType") ?? ""),
          description: String(data.get("description") ?? ""),
        }),
      });
      form.reset();
      setFarmId("");
      setNotice("Service visit requested.");
      try {
        await onRefresh();
      } catch {
        setError("The visit was requested, but the list could not refresh. Use Refresh to reload it.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request a service visit.");
    } finally {
      setSaving(false);
    }
  }

  async function updateVisit(event: FormEvent<HTMLFormElement>, visit: ServiceVisit) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    const localSchedule = String(data.get("scheduledAt") ?? "");
    const status = String(data.get("status") ?? "");
    if (status === "SCHEDULED" && !localSchedule) {
      setError("Set a date and time before scheduling the service visit.");
      setSaving(false);
      return;
    }
    try {
      await apiRequest(`/api/service-visits/${visit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          scheduledAt: localSchedule ? new Date(localSchedule).toISOString() : null,
          assignedToId: String(data.get("assignedToId") ?? ""),
          deviceCode: String(data.get("deviceCode") ?? ""),
          operationsNotes: String(data.get("operationsNotes") ?? ""),
        }),
      });
      setNotice("Service visit updated.");
      try {
        await onRefresh();
      } catch {
        setError("The visit was updated, but the list could not refresh. Use Refresh to reload it.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the service visit.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="service-workspace">
    <div className="page-heading-row">
      <div><div className="date-eyebrow">{isAdmin ? "CROPCYCLE OPERATIONS" : "FARM SUPPORT"}</div><h1>Service visits</h1><p>{isAdmin ? "Schedule requests, assign service staff and track maintenance through completion." : "Request a visit for your farm and follow its status here."}</p></div>
    </div>
    <div className="service-workspace-grid">
      <section className="panel service-request-panel">
        <div className="section-kicker">NEW SERVICE REQUEST</div>
        <h2>What support does the farm need?</h2>
        <form className="data-form" onSubmit={requestVisit}>
          <label>Farm<select name="farmCode" value={farmId} onChange={(event) => setFarmId(event.target.value)} required><option value="">Select a farm</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label>
          <label>Field (optional)<select name="plotCode" defaultValue=""><option value="">Farm-wide visit</option>{plots.filter((plot) => plot.farmId === farmId).map((plot) => <option key={plot.id} value={plot.id}>{plot.name}</option>)}</select></label>
          <label>Service type<select name="serviceType" required defaultValue=""><option value="" disabled>Select support needed</option>{Object.entries(serviceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Describe the issue<textarea name="description" rows={4} minLength={5} maxLength={5000} placeholder="Tell the service team what happened or what support is needed." required/></label>
          {error && <div className="auth-message" role="alert">{error}</div>}
          {notice && <div className="service-notice" role="status">{notice}</div>}
          <button className="button button-dark" disabled={saving || farms.length === 0}>{saving ? "Sending…" : "Request a visit"} <span>↗</span></button>
        </form>
      </section>
      <section className="panel service-visits-panel">
        <div className="panel-header"><div><div className="section-kicker">{isAdmin ? "SERVICE OPERATIONS REGISTER" : "YOUR REQUESTS"}</div><h2>{visits.length} service {visits.length === 1 ? "visit" : "visits"}</h2></div><button className="quiet-link" type="button" onClick={() => void onRefresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to refresh service visits."))}>Refresh ↻</button></div>
        {visits.length === 0 ? <div className="empty-state"><span>⌂</span><h3>No service visits yet</h3><p>New requests and scheduled visits will appear here.</p></div> : visits.map((visit) => <article className="service-visit-card" key={visit.id}>
          <div className="service-visit-heading"><div><strong>{serviceLabels[visit.serviceType] ?? visit.serviceType}</strong><small>{visit.farm}{visit.plot ? ` · ${visit.plot}` : ""}</small></div><span className={`service-status service-status-${visit.status.toLowerCase().replace("_", "-")}`}>{statusLabels[visit.status]}</span></div>
          <p>{visit.description}</p>
          <div className="service-visit-meta"><span>Requested by {visit.requestedBy}</span><span>{visit.createdAt ? new Date(visit.createdAt).toLocaleDateString() : ""}</span>{visit.scheduledAt && <span>Scheduled {new Date(visit.scheduledAt).toLocaleString()}</span>}{visit.assignedTo && <span>Assigned to {visit.assignedTo}</span>}{visit.deviceCode && <span>Device {visit.deviceCode}</span>}</div>
          {visit.operationsNotes && <div className="service-operations-note"><strong>Update from service operations</strong><p>{visit.operationsNotes}</p></div>}
          {isAdmin && <form className="service-operations-form" onSubmit={(event) => void updateVisit(event, visit)}>
            <div className="form-grid"><label>Status<select name="status" defaultValue={visit.status}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Schedule date and time<input type="datetime-local" name="scheduledAt" defaultValue={localDateTime(visit.scheduledAt)}/></label></div>
            <div className="form-grid"><label>Assigned service staff<select name="assignedToId" defaultValue={visit.assignedToId}><option value="">Unassigned</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role.replace("_", " ")}</option>)}</select></label><label>Device (optional)<select name="deviceCode" defaultValue={visit.deviceCode}><option value="">No device linked</option>{devices.filter((device) => device.farmCode === visit.farmId).map((device) => <option key={device.deviceCode} value={device.deviceCode}>{device.deviceCode}</option>)}</select></label></div>
            <label>Service update (visible to the farm)<textarea name="operationsNotes" rows={2} maxLength={5000} defaultValue={visit.operationsNotes} placeholder="Share the visit outcome, maintenance performed, or next steps with the farm."/></label>
            <button className="button button-outline" disabled={saving || loadingOperations}>{saving ? "Saving…" : "Save operations update"}</button>
          </form>}
        </article>)}
      </section>
    </div>
  </div>;
}

export function DeviceManagementWorkspace() {
  const [inventory, setInventory] = useState<Inventory>({ devices: [], farms: [], plots: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [farmId, setFarmId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncingSheetDb, setSyncingSheetDb] = useState(false);
  const [issuedCredential, setIssuedCredential] = useState<{ deviceCode: string; apiKey: string } | null>(null);

  async function refreshInventory() {
    const result = await apiRequest<Inventory>("/api/devices");
    setInventory(result);
  }

  useEffect(() => {
    let mounted = true;
    void apiRequest<Inventory>("/api/devices").then((result) => {
      if (mounted) setInventory(result);
    }).catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : "Unable to load device inventory.");
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  async function registerDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError("");
    setNotice("");
    setIssuedCredential(null);
    const data = new FormData(form);
    try {
      const result = await apiRequest<{ deviceCode: string; apiKey: string }>("/api/devices", {
        method: "POST",
        body: JSON.stringify({
          deviceCode: String(data.get("deviceCode") ?? ""),
          type: String(data.get("type") ?? ""),
          ownership: String(data.get("ownership") ?? "CROPCYCLE"),
          firmware: String(data.get("firmware") ?? ""),
          externalNodeId: String(data.get("externalNodeId") ?? ""),
          farmCode: String(data.get("farmCode") ?? ""),
          plotCode: String(data.get("plotCode") ?? ""),
        }),
      });
      form.reset();
      setFarmId("");
      setNotice("Device registered.");
      setIssuedCredential({ deviceCode: result.deviceCode, apiKey: result.apiKey });
      try {
        await refreshInventory();
      } catch {
        setError("The device was registered, but inventory could not refresh. Use Refresh to reload it.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to register device.");
    } finally {
      setSaving(false);
    }
  }

  async function updateDevice(event: FormEvent<HTMLFormElement>, device: DeviceRecord) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest(`/api/devices/${encodeURIComponent(device.deviceCode)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: String(data.get("status") ?? ""),
          ownership: String(data.get("ownership") ?? ""),
          externalNodeId: String(data.get("externalNodeId") ?? ""),
          farmCode: String(data.get("farmCode") ?? ""),
          plotCode: String(data.get("plotCode") ?? ""),
        }),
      });
      setNotice(`${device.deviceCode} updated.`);
      try {
        await refreshInventory();
      } catch {
        setError("The device was updated, but inventory could not refresh. Use Refresh to reload it.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update device.");
    } finally {
      setSaving(false);
    }
  }

  async function rotateDeviceKey(device: DeviceRecord) {
    setSaving(true);
    setError("");
    setNotice("");
    setIssuedCredential(null);
    try {
      const result = await apiRequest<{ deviceCode: string; apiKey: string }>(
        `/api/devices/${encodeURIComponent(device.deviceCode)}/credentials`,
        { method: "POST" },
      );
      setIssuedCredential(result);
      setNotice(`A new key was issued for ${device.deviceCode}. The previous key no longer works.`);
      try {
        await refreshInventory();
      } catch {
        setError("The key was issued, but inventory could not refresh.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to issue device credentials.");
    } finally {
      setSaving(false);
    }
  }

  async function syncSheetDb() {
    setSyncingSheetDb(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        imported: number;
        duplicates: number;
        skipped: number;
        issues: string[];
        diagnostics: {
          rowCount: number;
          matchedRows: number;
          ignoredRows: number;
          targetNodeId: string;
          headers: string[];
          firstRow: {
            nodeIdPresent: boolean;
            seasonPresent: boolean;
            timestampPresent: boolean;
            timestampValid: boolean;
          } | null;
          rowsWithNodeId: number;
          rowsWithSeason: number;
          rowsWithTimestamp: number;
        };
      }>(
        "/api/integrations/sheetdb/sync",
        { method: "POST", body: JSON.stringify({}) },
      );
      const row = result.diagnostics.firstRow;
      const diagnostics = ` Only Node_ID "${result.diagnostics.targetNodeId}" is imported; ${result.diagnostics.matchedRows} matched and ${result.diagnostics.ignoredRows} other rows ignored out of ${result.diagnostics.rowCount}.` +
        (result.skipped
          ? ` Headers: ${result.diagnostics.headers.join(", ") || "none"}. First matching row fields: Node ID ${row?.nodeIdPresent ? "present" : "missing"}, Season ${row?.seasonPresent ? "present" : "missing"}, Timestamp ${row?.timestampPresent ? (row.timestampValid ? "valid" : "present but invalid") : "missing"}.`
          : "");
      setNotice(`SheetDB sync complete: ${result.imported} imported, ${result.duplicates} already present, ${result.skipped} skipped.${result.issues.length ? ` First issue: ${result.issues[0]}` : ""}${diagnostics}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sync SheetDB readings.");
    } finally {
      setSyncingSheetDb(false);
    }
  }

  return <div className="service-workspace">
    <div className="page-heading-row"><div><div className="date-eyebrow">CROPCYCLE ADMIN · SERVICE ASSETS</div><h1>Device operations</h1><p>Register CropCycle equipment, manage farm assignments and track device status.</p></div></div>
    <div className="device-workspace-grid">
      <section className="panel device-register-panel">
        <div className="section-kicker">REGISTER DEVICE</div><h2>Add a service asset</h2>
        <form className="data-form" onSubmit={registerDevice}>
          <label>Device code<input name="deviceCode" minLength={2} maxLength={100} required placeholder="e.g. CC-SOIL-0001"/></label>
          <label>Device type<input name="type" minLength={2} maxLength={80} required placeholder="e.g. Soil sensor"/></label>
          <label>SheetDB Node ID (optional)<input name="externalNodeId" maxLength={100} placeholder="Matches Node_ID in SheetDB"/></label>
          <div className="form-grid"><label>Ownership<select name="ownership" defaultValue="CROPCYCLE"><option value="CROPCYCLE">CropCycle</option><option value="CUSTOMER">Customer-owned</option></select></label><label>Firmware version<input name="firmware" maxLength={80} placeholder="Optional"/></label></div>
          <label>Assign to farm (optional)<select name="farmCode" value={farmId} onChange={(event) => setFarmId(event.target.value)}><option value="">Unassigned</option>{inventory.farms.map((farm) => <option key={farm.farmCode} value={farm.farmCode}>{farm.name}</option>)}</select></label>
          <label>Assign to field (optional)<select name="plotCode" defaultValue=""><option value="">Farm-wide assignment</option>{inventory.plots.filter((plot) => plot.farmCode === farmId).map((plot) => <option key={plot.plotCode} value={plot.plotCode}>{plot.name}</option>)}</select></label>
          {error && <div className="auth-message" role="alert">{error}</div>}
          {notice && <div className="service-notice" role="status">{notice}</div>}
          <button className="button button-dark" disabled={saving}>{saving ? "Registering…" : "Register device"} <span>↗</span></button>
        </form>
      </section>
      <section className="panel device-inventory-panel">
        <div className="panel-header"><div><div className="section-kicker">DEVICE INVENTORY</div><h2>{inventory.devices.length} registered {inventory.devices.length === 1 ? "device" : "devices"}</h2></div><div><button className="quiet-link" type="button" disabled={syncingSheetDb} onClick={() => void syncSheetDb()}>{syncingSheetDb ? "Syncing SheetDB…" : "Sync SheetDB ↻"}</button> <button className="quiet-link" type="button" onClick={() => void refreshInventory().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to refresh device inventory."))}>Refresh ↻</button></div></div>
        {loading ? <p>Loading device inventory…</p> : inventory.devices.length === 0 ? <div className="empty-state"><span>▣</span><h3>No devices registered</h3><p>Newly registered equipment will appear here for assignment and service tracking.</p></div>                 : inventory.devices.map((device) => <DeviceRecordCard key={device.id} device={device} inventory={inventory} saving={saving} onSubmit={updateDevice} onRotateKey={rotateDeviceKey}/>)}
      </section>
    </div>
    {issuedCredential && <section className="panel device-key-panel"><div><div className="section-kicker">DEVICE API CREDENTIAL · SHOWN ONCE</div><h2>{issuedCredential.deviceCode}</h2><p>Copy this key to the device configuration now. It will not be shown again; issuing another key revokes this one.</p></div><code>{issuedCredential.apiKey}</code><button type="button" className="quiet-link" onClick={() => setIssuedCredential(null)}>Hide key</button></section>}
  </div>;
}

function DeviceRecordCard({
  device,
  inventory,
  saving,
  onSubmit,
  onRotateKey,
}: {
  device: DeviceRecord;
  inventory: Inventory;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>, device: DeviceRecord) => void;
  onRotateKey: (device: DeviceRecord) => void;
}) {
  const [farmCode, setFarmCode] = useState(device.farmCode);
  const [plotCode, setPlotCode] = useState(device.plotCode);
  return <article className="device-record">
    <div className="device-record-heading"><div><strong>{device.deviceCode}</strong><small>{device.type} · {device.ownership === "CROPCYCLE" ? "CropCycle-owned" : "Customer-owned"}</small></div><span className={`service-status service-status-${device.status.toLowerCase().replace("_", "-")}`}>{device.status.replace("_", " ")}</span></div>
    <div className="device-record-meta"><span>{device.farm || "Unassigned"}{device.plot ? ` · ${device.plot}` : ""}</span><span>{device.firmware ? `Firmware ${device.firmware}` : "Firmware not recorded"}</span><span>{device.lastConnectedAt ? `Last connected ${new Date(device.lastConnectedAt).toLocaleString()}` : "No connection recorded"}</span></div>
    <div className="device-record-meta"><span>SheetDB Node ID: {device.externalNodeId || "Not mapped"}</span></div>
    <div className="device-key-actions"><span>{device.apiKeyConfigured ? "API key configured" : "No API key issued"}</span><button type="button" className="quiet-link" disabled={saving} onClick={() => onRotateKey(device)}>{device.apiKeyConfigured ? "Rotate API key" : "Issue API key"}</button></div>
    <form className="device-update-form" onSubmit={(event) => onSubmit(event, device)}>
      <div className="form-grid"><label>Status<select name="status" defaultValue={device.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="MAINTENANCE">Maintenance</option><option value="RETIRED">Retired</option></select></label><label>Ownership<select name="ownership" defaultValue={device.ownership}><option value="CROPCYCLE">CropCycle</option><option value="CUSTOMER">Customer-owned</option></select></label></div>
      <div className="form-grid"><label>Farm assignment<select name="farmCode" value={farmCode} onChange={(event) => { setFarmCode(event.target.value); setPlotCode(""); }}><option value="">Unassigned</option>{inventory.farms.map((farm) => <option key={farm.farmCode} value={farm.farmCode}>{farm.name}</option>)}</select></label><label>Field assignment<select name="plotCode" value={plotCode} onChange={(event) => setPlotCode(event.target.value)}><option value="">Farm-wide assignment</option>{inventory.plots.filter((plot) => plot.farmCode === farmCode).map((plot) => <option key={plot.plotCode} value={plot.plotCode}>{plot.name}</option>)}</select></label></div>
      <label>SheetDB Node ID<input name="externalNodeId" maxLength={100} defaultValue={device.externalNodeId} placeholder="Matches Node_ID in SheetDB"/></label>
      <button className="button button-outline" disabled={saving}>{saving ? "Saving…" : "Save device changes"}</button>
    </form>
  </article>;
}
