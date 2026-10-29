"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CROP_OPTIONS } from "@/lib/crops";
import PasswordVisibilityToggle from "@/components/password-visibility-toggle";
import { DeviceManagementWorkspace, ServiceVisitsWorkspace } from "@/components/service-workspaces";
import { ProfileWorkspace, UserAvatar, type ProfileData } from "@/components/profile-workspace";
import { Localize, LocalizedContent } from "@/lib/language";

type Role = "Admin" | "Field Agent" | "Crop Scientist" | "Farm Manager" | "Farmer";
type Farmer = { id: string; name: string; phone: string; location: string; farming: string };
type Farm = { id: string; ownerId?: string; name: string; location: string; area: number; plots: number };
type Plot = { id: string; farmId?: string; farm: string; name: string; area: number; location: string; latitude?: number; longitude?: number };
type Season = { id: string; farmId?: string; plotId?: string; farm: string; plot: string; name: string; crop: string; previousCrops?: string[]; latestReadingAt?: string | null; hasAssessmentCrops?: boolean; available?: string; market?: string; method: string; status: string };
type Reading = { id: string; farmerId?: string; farmId?: string; farm?: string; plotId?: string; seasonId?: string; deviceId?: string; timestamp?: string; plot: string; date: string; nitrogen: number | null; phosphorus: number | null; potassium: number | null; soilTemperature: number | null; humidity: number | null; sync: string };
type SoilDevice = { id: string; deviceCode: string; externalNodeId: string; farmId: string; farm: string };
type QueuedReading = {
  idempotencyKey: string;
  plotCode: string;
  seasonId: string;
  deviceId?: string;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  soilTemperature: number;
  humidity: number;
  recordedAt: string;
  syncStatus: "PENDING" | "FAILED" | "CONFLICT";
  syncError?: string;
};
type Outcome = {
  id: string;
  seasonId: string;
  recommendationId: string | null;
  farm: string;
  plot: string;
  season: string;
  actualCrops: string[];
  yieldQuantity: number | null;
  yieldUnit: string | null;
  notes: string | null;
  recordedAt: string;
  feedback: Array<{ rating: number | null; comment: string | null }>;
};
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
type RecommendationResult = {
  notice: string;
  candidates: Array<{
    crop: string;
    suitability: "supported" | "review-needed" | "insufficient-data" | "unsuitable";
    reasons: string[];
    alternatives: string[];
    considerations: string[];
    knowledge: Array<{ id: string; title: string; source: string; version: number }>;
  }>;
  dataUsed: {
    soil: { moisture?: number | null; pH?: number | null; electricalConductivity?: number | null; nitrogen: number | null; phosphorus: number | null; potassium: number | null; soilTemperature: number | null; humidity: number | null; recordedAt: string | null };
    previousCrops: string[];
    intendedCrops: string[];
    availableCrops: string[];
    marketableCrops: string[];
    preferredMethod: string | null;
    otherRequirements: string | null;
  };
};
type SavedRecommendation = {
  id: string;
  version: number;
  status: string;
  provider: string | null;
  createdAt: string;
  reviewedAt: string | null;
  farm: string;
  farmId: string;
  plot: string;
  plotId: string;
  season: string;
  seasonId: string;
  result: RecommendationResult;
  knowledge: Array<{ id: string; title: string; source: string; version: number }>;
};
type KnowledgeRuleRecord = {
  id: string;
  key: string;
  version: number;
  title: string;
  body: unknown;
  sourceCitation: string;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  approvedAt: string | null;
};
type View = "overview" | "farmers" | "farms" | "seasons" | "soil" | "recommendations" | "knowledge" | "serviceVisits" | "devices" | "profile";
type Modal = "farmer" | "farm" | "plot" | "season" | "reading" | "outcome" | null;
type Store = { farmers: Farmer[]; farms: Farm[]; plots: Plot[]; seasons: Season[]; readings: Reading[]; devices: SoilDevice[]; recommendations: SavedRecommendation[]; outcomes: Outcome[]; serviceVisits: ServiceVisit[]; farmer: string; role: Role; profile: ProfileData };
const seed: Store = {
  farmer: "Amina Yusuf", role: "Field Agent",
  profile: { email: "", name: "Amina Yusuf", bio: "", avatarUrl: null, emailNotifications: true, timeFormat: "H12", language: "EN", phone: "", location: "", farming: "Mixed farming" },
  farmers: [{ id: "AGR-F-000001", name: "Amina Yusuf", phone: "+234 803 000 1280", location: "Kaduna North, Kaduna", farming: "Mixed farming" }, { id: "AGR-F-000002", name: "Musa Ibrahim", phone: "+234 806 000 9200", location: "Zaria, Kaduna", farming: "Mono-cropping" }],
  farms: [{ id: "AGR-FM-000128", name: "Green Valley Farm", location: "Kaduna North, Kaduna", area: 18.5, plots: 4 }, { id: "AGR-FM-000092", name: "Riverbend Fields", location: "Zaria, Kaduna", area: 12, plots: 3 }],
  plots: [{ id: "AGR-PL-000401", farm: "Green Valley Farm", name: "North Field", area: 6, location: "Kaduna North" }, { id: "AGR-PL-000402", farm: "Green Valley Farm", name: "South Ridge", area: 4.5, location: "Kaduna North" }, { id: "AGR-PL-000403", farm: "Green Valley Farm", name: "East Meadow", area: 3.5, location: "Kaduna North" }, { id: "AGR-PL-000404", farm: "Green Valley Farm", name: "River Flat", area: 4.5, location: "Kaduna North" }, { id: "AGR-PL-000501", farm: "Riverbend Fields", name: "Plot 01", area: 4, location: "Zaria" }, { id: "AGR-PL-000502", farm: "Riverbend Fields", name: "Plot 02", area: 4, location: "Zaria" }, { id: "AGR-PL-000503", farm: "Riverbend Fields", name: "Plot 03", area: 4, location: "Zaria" }],
  seasons: [{ id: "S-2026-014", farm: "Green Valley Farm", plot: "North Field", name: "2026 wet season", crop: "Maize + cowpea", method: "Mixed farming", status: "In progress" }, { id: "S-2026-011", farm: "Riverbend Fields", plot: "Plot 02", name: "2026 wet season", crop: "Sorghum", method: "Mono-cropping", status: "Review due" }, { id: "S-2025-037", farm: "Green Valley Farm", plot: "North Field", name: "2025 dry season", crop: "Groundnut", method: "Mono-cropping", status: "Completed" }],
  readings: [],
  devices: [],
  recommendations: [],
  outcomes: [],
  serviceVisits: [],
};
const navigation: { id: View; name: string; icon: string }[] = [{ id: "overview", name: "Overview", icon: "◫" }, { id: "farmers", name: "Farmers", icon: "♙" }, { id: "farms", name: "Farms", icon: "⌂" }, { id: "seasons", name: "Seasons", icon: "◷" }, { id: "soil", name: "Soil readings", icon: "⌁" }, { id: "serviceVisits", name: "Service visits", icon: "⚒" }, { id: "recommendations", name: "Recommendations", icon: "✳" }, { id: "knowledge", name: "Agricultural knowledge", icon: "✳" }, { id: "devices", name: "Device operations", icon: "▣" }];

function subscribeToOnlineStatus(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "The request could not be completed.";
    throw new Error(message);
  }
  return payload as T;
}

function isQueuedReading(value: unknown): value is QueuedReading {
  if (!value || typeof value !== "object") return false;
  const reading = value as Record<string, unknown>;
  return typeof reading.idempotencyKey === "string" &&
    typeof reading.plotCode === "string" &&
    typeof reading.seasonId === "string" &&
    typeof reading.nitrogen === "number" &&
    typeof reading.phosphorus === "number" &&
    typeof reading.potassium === "number" &&
    typeof reading.soilTemperature === "number" &&
    typeof reading.humidity === "number" &&
    typeof reading.recordedAt === "string" &&
    (reading.syncStatus === "PENDING" || reading.syncStatus === "FAILED" || reading.syncStatus === "CONFLICT");
}

type QueueSnapshot = { readings: QueuedReading[]; error?: string };
const emptyQueueSnapshot: QueueSnapshot = { readings: [] };
let queueSnapshot = emptyQueueSnapshot;
let queueLoaded = false;
const queueListeners = new Set<() => void>();

function parseQueueSnapshot(): QueueSnapshot {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem("cropcycle:queuedReadings") ?? "[]");
    if (!Array.isArray(saved) || !saved.every(isQueuedReading)) {
      return { readings: [], error: "Offline queue contains invalid records; existing local data was left untouched." };
    }
    return { readings: saved as QueuedReading[] };
  } catch (error) {
    return {
      readings: [],
      error: error instanceof Error ? `Could not restore queued readings: ${error.message}` : "Could not restore queued readings.",
    };
  }
}

function getQueueSnapshot() {
  if (typeof window !== "undefined" && !queueLoaded) {
    queueSnapshot = parseQueueSnapshot();
    queueLoaded = true;
  }
  return queueSnapshot;
}

function subscribeToQueue(onChange: () => void) {
  queueListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "cropcycle:queuedReadings") return;
    queueSnapshot = parseQueueSnapshot();
    queueLoaded = true;
    queueListeners.forEach((listener) => listener());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    queueListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerQueueSnapshot() {
  return emptyQueueSnapshot;
}

function publishQueueSnapshot(snapshot: QueueSnapshot) {
  queueSnapshot = snapshot;
  queueLoaded = true;
  queueListeners.forEach((listener) => listener());
}

export default function Home() {
  const [store, setStore] = useState<Store>(seed);
  const [signedIn, setSignedIn] = useState(false);
  const [auth, setAuth] = useState<"login" | "signup" | "reset" | null>(null);
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [plotFarmId, setPlotFarmId] = useState("");
  const [farmerDraft, setFarmerDraft] = useState<Farmer | null>(null);
  const [selectedOutcomeSeasonId, setSelectedOutcomeSeasonId] = useState("");
  const [recommendationDialog, setRecommendationDialog] = useState<SavedRecommendation | null>(null);
  const [recommendingSeasonId, setRecommendingSeasonId] = useState<string | null>(null);
  const [syncingSheetDbDevices, setSyncingSheetDbDevices] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const online = useSyncExternalStore(
    subscribeToOnlineStatus,
    () => navigator.onLine,
    () => true,
  );
  const offline = !online;
  const [query, setQuery] = useState("");
  const queueState = useSyncExternalStore(subscribeToQueue, getQueueSnapshot, getServerQueueSnapshot);
  const queuedReadings = queueState.readings;
  const syncInProgress = useRef(false);
  const QUEUE_KEY = "cropcycle:queuedReadings";
  const refreshWorkspace = useCallback(async () => {
    setStore(await requestJson<Store>("/api/workspace"));
  }, []);
  const recommendCrops = useCallback(async (seasonId: string) => {
    setRecommendingSeasonId(seasonId);
    try {
      await requestJson("/api/recommendations", {
        method: "POST",
        body: JSON.stringify({ seasonId, automatic: true }),
      });
      const updatedWorkspace = await requestJson<Store>("/api/workspace");
      setStore(updatedWorkspace);
      const season = updatedWorkspace.seasons.find((item) => item.id === seasonId);
      const recommendation = updatedWorkspace.recommendations.find((item) =>
        item.seasonId === seasonId &&
        item.provider === "cropcycle-crop-knowledge-base" &&
        item.result.dataUsed.soil.recordedAt === season?.latestReadingAt,
      );
      if (!recommendation) {
        throw new Error("The crop recommendation was prepared, but it could not be loaded. Refresh and try again.");
      }
      setRecommendationDialog(recommendation);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to prepare crop recommendations.");
    } finally {
      setRecommendingSeasonId(null);
    }
  }, []);
  const syncSheetDbDevice = useCallback(async (device: SoilDevice) => {
    setSyncingSheetDbDevices((current) => ({ ...current, [device.id]: true }));
    try {
      const result = await requestJson<{
        imported: number;
        duplicates: number;
        skipped: number;
        recommendationsPrepared: number;
      }>("/api/integrations/sheetdb/sync", {
        method: "POST",
        body: JSON.stringify({ deviceId: device.id }),
      });
      await refreshWorkspace();
      setNotice(
        `${device.deviceCode} sync complete: ${result.imported} imported, ${result.duplicates} already present, ${result.skipped} skipped, ${result.recommendationsPrepared} recommendation drafts prepared.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Unable to sync readings for ${device.deviceCode}.`);
    } finally {
      setSyncingSheetDbDevices((current) => ({ ...current, [device.id]: false }));
    }
  }, [refreshWorkspace]);
  const persistQueuedReadings = useCallback((next: QueuedReading[]) => {
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
      publishQueueSnapshot({ readings: next });
      return true;
    } catch {
      publishQueueSnapshot({ readings: queuedReadings, error: "Could not save the offline reading queue on this device." });
      return false;
    }
  }, [queuedReadings]);
  const syncQueuedReadings = useCallback(async () => {
    if (!navigator.onLine || !signedIn || syncInProgress.current) return;
    const pending = queuedReadings.filter((reading) => reading.syncStatus === "PENDING");
    if (!pending.length) return;
    syncInProgress.current = true;
    try {
      const { results } = await requestJson<{
        results: Array<{ idempotencyKey: string; status: "SYNCED" | "DUPLICATE" | "CONFLICT" | "FAILED"; message?: string }>;
      }>("/api/sync/readings", {
        method: "POST",
        body: JSON.stringify({
          readings: pending.map((reading) => ({
            idempotencyKey: reading.idempotencyKey,
            plotCode: reading.plotCode,
            seasonId: reading.seasonId,
            deviceId: reading.deviceId,
            nitrogen: reading.nitrogen,
            phosphorus: reading.phosphorus,
            potassium: reading.potassium,
            soilTemperature: reading.soilTemperature,
            humidity: reading.humidity,
            recordedAt: reading.recordedAt,
          })),
        }),
      });
      const resolved = new Map(results.map((result) => [result.idempotencyKey, result]));
      const remaining = queuedReadings.flatMap((reading) => {
        const result = resolved.get(reading.idempotencyKey);
        if (reading.syncStatus !== "PENDING") return [reading];
        if (result?.status === "SYNCED" || result?.status === "DUPLICATE") return [];
        return [{
          ...reading,
          syncStatus: result?.status === "CONFLICT" ? "CONFLICT" as const : "FAILED" as const,
          syncError: result?.message ?? "No sync status was returned. Retry when ready.",
        }];
      });
      persistQueuedReadings(remaining);
      const synced = results.filter((result) => result.status === "SYNCED" || result.status === "DUPLICATE").length;
      if (synced > 0) await refreshWorkspace();
      if (remaining.some((item) => item.syncStatus === "CONFLICT")) {
        setNotice("Some queued readings conflict with records already on the server. Review them before discarding.");
      } else if (remaining.length) {
        setNotice(`${synced} reading(s) synced; ${remaining.length} still need attention.`);
      } else if (synced > 0) {
        setNotice(`${synced} queued reading(s) synced.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to sync queued readings.");
    } finally {
      syncInProgress.current = false;
    }
  }, [queuedReadings, refreshWorkspace, signedIn, persistQueuedReadings]);
  useEffect(() => {
    if (online && signedIn && queuedReadings.some((reading) => reading.syncStatus === "PENDING")) {
      const timer = window.setTimeout(() => void syncQueuedReadings(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [online, signedIn, queuedReadings, syncQueuedReadings]);
  async function generateRecommendation(seasonId: string) {
    try {
      await requestJson("/api/recommendations", {
        method: "POST",
        body: JSON.stringify({ seasonId }),
      });
      await refreshWorkspace();
      setNotice("Assessment saved with its approved knowledge and season context.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to assess this season.");
    }
  }
  async function reviewRecommendation(recommendationId: string, action: "approve" | "share") {
    try {
      await requestJson(`/api/recommendations/${recommendationId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      await refreshWorkspace();
      setNotice(action === "approve" ? "Assessment approved by the Crop Scientist." : "Assessment shared with the farm.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to review this assessment.");
    }
  }
  useEffect(() => {
    let mounted = true;
    void requestJson<{ user: { name: string } | null }>("/api/auth/session")
      .then(async ({ user }) => {
        if (!user || !mounted) return;
        const workspace = await requestJson<Store>("/api/workspace");
        if (!mounted) return;
        setStore(workspace);
        setSignedIn(true);
      })
      .catch((error: unknown) => {
        if (mounted) setNotice(error instanceof Error ? error.message : "Could not restore your session.");
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
  if (!signedIn) return;
  let refreshing = false;
  const refreshWhenVisible = async () => {
    if (document.visibilityState !== "visible" || refreshing) return;
    refreshing = true;
    try {
      await refreshWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? `Live readings refresh failed: ${error.message}` : "Live readings refresh failed.");
    } finally {
      refreshing = false;
    }
  };
  const interval = window.setInterval(() => void refreshWhenVisible(), 15_000);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
  };
  }, [signedIn, refreshWorkspace]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3000); return () => window.clearTimeout(timer); }, [notice]);

  async function saveAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), email = String(data.get("email") ?? ""), password = String(data.get("password") ?? "");
    try {
      if (auth === "reset") {
        const result = await requestJson<{ message: string; resetUrl?: string }>("/api/auth/password-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setAuth(null);
        if (result.resetUrl) window.location.assign(result.resetUrl);
        else setNotice(result.message);
        return;
      }
      const name = String(data.get("name") ?? "").trim();
      await requestJson(auth === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      await refreshWorkspace();
      setSignedIn(true);
      setAuth(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to sign in.");
    }
  }
  async function saveFarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      await requestJson("/api/farms", {
        method: "POST",
        body: JSON.stringify({
          ownerCode: String(data.get("ownerId")),
          name: String(data.get("name")).trim(),
          location: String(data.get("location")).trim(),
          area: Number(data.get("area")),
        }),
      });
      await refreshWorkspace();
      setModal(null);
      setNotice("Farm added. You can add its fields from the farm page.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save farm.");
    }
  }
  async function saveFarmer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const values = {
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(),
      location: String(data.get("location")).trim(),
      farming: String(data.get("farming")),
    };
    try {
      if (farmerDraft) {
        await requestJson("/api/farmers", {
          method: "PATCH",
          body: JSON.stringify({ id: farmerDraft.id, ...values }),
        });
      } else {
        await requestJson("/api/farmers", { method: "POST", body: JSON.stringify(values) });
      }
      await refreshWorkspace();
      setModal(null);
      setNotice(farmerDraft ? `${farmerDraft.id} updated.` : "Farmer registered.");
      setFarmerDraft(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save farmer.");
    }
  }
  async function savePlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget), farmCode = String(data.get("farm"));
    const farmRecord = store.farms.find((record) => record.id === farmCode);
    if (!farmRecord) { setNotice("Choose a registered farm for this plot."); return; }
    try {
      await requestJson("/api/plots", {
        method: "POST",
        body: JSON.stringify({
          farmCode: farmRecord.id,
          name: String(data.get("name")).trim(),
          area: Number(data.get("area")),
          location: String(data.get("location")).trim(),
          latitude: data.get("latitude") ? Number(data.get("latitude")) : undefined,
          longitude: data.get("longitude") ? Number(data.get("longitude")) : undefined,
        }),
      });
      await refreshWorkspace();
      setModal(null);
      setNotice("Plot added to its farm.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save plot.");
    }
  }
  async function saveSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const plot = store.plots.find((record) => record.id === String(data.get("plotId")));
    if (!plot) { setNotice("Choose a registered plot for this season."); return; }
    const previousSeasonText = String(data.get("previousSeason") ?? "").trim();
    const previousCrops = previousSeasonText
      ? previousSeasonText
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const preferredCrops = data.getAll("preferredCrops").map(String);
    const available: string[] = [];
    const market = preferredCrops;
    try {
      await requestJson("/api/seasons", {
        method: "POST",
        body: JSON.stringify({
          plotCode: plot.id,
          name: String(data.get("name")).trim(),
          method: String(data.get("method")),
          preferredMethod: String(data.get("preferredMethod")),
          preferredCrops,
          intendedCrops: preferredCrops,
          previousSeason: previousSeasonText,
          previousCrops,
          available,
          market,
        }),
      });
      await refreshWorkspace();
      setModal(null);
      setNotice("Season saved. Its history will carry forward.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save season.");
    }
  }
  function startOutcome(seasonId: string) {
    setSelectedOutcomeSeasonId(seasonId);
    setModal("outcome");
  }
  async function saveOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const actualCrops = data.getAll("actualCrops").map(String);
    const yieldValue = String(data.get("yieldQuantity") ?? "").trim();
    try {
      await requestJson("/api/outcomes", {
        method: "POST",
        body: JSON.stringify({
          seasonId: String(data.get("seasonId") ?? ""),
          recommendationId: String(data.get("recommendationId") ?? "") || undefined,
          actualCrops,
          yieldQuantity: yieldValue ? Number(yieldValue) : undefined,
          yieldUnit: yieldValue ? String(data.get("yieldUnit") ?? "").trim() : undefined,
          notes: String(data.get("notes") ?? "").trim() || undefined,
          rating: String(data.get("rating") ?? "") ? Number(data.get("rating")) : undefined,
          comment: String(data.get("comment") ?? "").trim() || undefined,
        }),
      });
      await refreshWorkspace();
      setModal(null);
      setNotice("Outcome and actual crop history recorded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to record outcome.");
    }
  }
  async function saveReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const keyField = form.elements.namedItem("idempotencyKey");
    let idempotencyKey = String(data.get("idempotencyKey") ?? "");
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      if (keyField instanceof HTMLInputElement) keyField.value = idempotencyKey;
    }
    const plot = store.plots.find((record) => record.id === String(data.get("plotId")));
    if (!plot) { setNotice("Choose a registered plot for this reading."); return; }
    const seasonId = String(data.get("seasonId") || "") || undefined;
    if (!seasonId) { setNotice("Choose a season so the reading is saved to the right field history."); return; }
    const payload = {
      idempotencyKey,
      plotCode: plot.id,
      seasonId,
      deviceId: String(data.get("deviceId") || "") || undefined,
      nitrogen: Number(data.get("nitrogen")),
      phosphorus: Number(data.get("phosphorus")),
      potassium: Number(data.get("potassium")),
      soilTemperature: Number(data.get("soilTemperature")),
      humidity: Number(data.get("humidity")),
      recordedAt: new Date().toISOString(),
    };
    if (offline) {
      if (!persistQueuedReadings([...queuedReadings, { ...payload, syncStatus: "PENDING" }])) return;
      setModal(null);
      setNotice("Reading queued locally. It will sync when you reconnect.");
      return;
    }
    try {
      await requestJson("/api/soil-readings", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refreshWorkspace();
      setModal(null);
      setNotice("Soil reading saved.");
    } catch (error) {
      if (error instanceof TypeError || !navigator.onLine) {
        if (!persistQueuedReadings([...queuedReadings, { ...payload, syncStatus: "PENDING" }])) return;
        setModal(null);
        setNotice("The connection failed. Reading saved locally for retry.");
        return;
      }
      setNotice(error instanceof Error ? error.message : "Unable to save soil reading.");
    }
  }
  function retryQueuedReading(idempotencyKey: string) {
    persistQueuedReadings(queuedReadings.map((reading) => reading.idempotencyKey === idempotencyKey
      ? { ...reading, syncStatus: "PENDING", syncError: undefined }
      : reading));
  }
  function discardQueuedReading(idempotencyKey: string) {
    persistQueuedReadings(queuedReadings.filter((reading) => reading.idempotencyKey !== idempotencyKey));
  }
  const farms = useMemo(() => store.farms.filter((item) => `${item.name} ${item.location} ${item.id}`.toLowerCase().includes(query.toLowerCase())), [store.farms, query]);
  async function logout() {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
      setSignedIn(false);
      setView("overview");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to log out.");
    }
  }

  const pendingQueueCount = queuedReadings.filter((reading) => reading.syncStatus === "PENDING").length;
  const conflictQueueCount = queuedReadings.filter((reading) => reading.syncStatus === "CONFLICT").length;
  const failedQueueCount = queuedReadings.filter((reading) => reading.syncStatus === "FAILED").length;
  if (!signedIn) return <LocalizedContent language={store.profile.language}><><Localize><Landing onAuth={setAuth} /></Localize>{auth && <Localize><AuthDialog mode={auth} onModeChange={setAuth} onClose={() => setAuth(null)} onSubmit={saveAuth} /></Localize>}{notice && <Toast>{notice}</Toast>}</></LocalizedContent>;
  return <LocalizedContent language={store.profile.language}><Localize><div className="app-shell">
    <aside className="sidebar"><button className="brand-lockup" onClick={() => setView("overview")}><span className="brand-mark">c</span><span className="brand-name">AgroGauge<span>.</span></span></button><div className="workspace-label">WORKSPACE</div><div className="workspace-switch"><span className="workspace-avatar">{initials(store.farms[0]?.name ?? store.farmer)}</span><span><strong>{store.farms[0]?.name ?? "My workspace"}</strong><small>{store.farms[0]?.location ?? store.role}</small></span><span className="switch-caret">⌄</span></div><nav className="side-nav" aria-label="Workspace navigation">{navigation.filter((item) => (item.id !== "knowledge" || store.role === "Admin" || store.role === "Crop Scientist") && (item.id !== "devices" || store.role === "Admin") && (item.id !== "serviceVisits" || store.role !== "Crop Scientist")).map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "selected" : ""}`} onClick={() => setView(item.id)}><span className="nav-glyph">{item.icon}</span>{item.name}{item.id === "soil" && (store.readings.some((reading) => reading.sync !== "Synced") || queuedReadings.length > 0) && <span className="nav-count">{queuedReadings.length || 1}</span>}</button>)}</nav><div className="sidebar-spacer"/><div className="field-tip"><span className="tip-sprout">✳</span><strong>In the field?</strong><p>Capture readings offline; they’ll sync when connectivity returns.</p><span className="tip-link">{offline ? "Offline · queue enabled" : "Server synced"} <i className={offline ? "" : "online-dot"}/></span></div><button className="sidebar-link" onClick={() => setNotice("Help centre is being prepared for your team.")}>◌ <span>Help & support</span></button><button className="profile-row" onClick={() => setView("profile")}><UserAvatar name={store.profile.name} url={store.profile.avatarUrl} className="profile-avatar"/><span className="profile-copy"><strong>{store.farmer}</strong><small>{store.role}</small></span><span className="profile-menu">···</span></button></aside>
    <main className="workspace-main"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>{view === "profile" ? "Profile" : navigation.find((item) => item.id === view)?.name}</strong></div><div className="topbar-actions"><span className={`connection-pill ${offline || conflictQueueCount || failedQueueCount ? "is-offline" : ""}`}><i/>{offline ? `Offline · ${queuedReadings.length} queued` : conflictQueueCount ? `${conflictQueueCount} conflict(s) need review` : failedQueueCount ? `${failedQueueCount} sync failure(s)` : pendingQueueCount ? `${pendingQueueCount} pending sync` : "All changes saved"}</span><button className="icon-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up.")}>♧<i className="notification-dot"/></button><button className="top-avatar" onClick={() => setView("profile")} aria-label="View profile"><UserAvatar name={store.profile.name} url={store.profile.avatarUrl} className="avatar-image"/></button></div></header><div className="page-content">
      {view === "overview" && <Overview store={store} setView={setView} setModal={setModal}/>}
      {view === "farmers" && <Farmers farmers={store.farmers} canRegister={store.role === "Admin" || store.role === "Field Agent"} canEdit={store.role === "Admin" || store.role === "Field Agent" || store.role === "Farmer"} onNew={() => { setFarmerDraft(null); setModal("farmer"); }} onEdit={(farmer) => { setFarmerDraft(farmer); setModal("farmer"); }}/ >}
      {view === "farms" && <Farms farms={farms} total={store.farms.length} query={query} setQuery={setQuery} plots={store.plots} setModal={setModal} seasons={store.seasons} onAddPlot={(farmId) => { setPlotFarmId(farmId); setModal("plot"); }}/>}
      {view === "seasons" && <Seasons seasons={store.seasons} setModal={setModal}/>}
      {view === "soil" && <Soil farms={store.farms} seasons={store.seasons} devices={store.devices} readings={store.readings} queuedReadings={queuedReadings} offline={offline} syncingDevices={syncingSheetDbDevices} onSyncDevice={(device) => void syncSheetDbDevice(device)} setModal={setModal} onRetry={retryQueuedReading} onDiscard={discardQueuedReading}/>}
      {view === "recommendations" && <Recommendations seasons={store.seasons} recommendations={store.recommendations} outcomes={store.outcomes} isFarmer={store.role === "Farmer"} recommendingSeasonId={recommendingSeasonId} onRecommend={recommendCrops} canReview={store.role === "Admin" || store.role === "Crop Scientist"} pendingReview={store.role === "Farmer" && store.seasons.some((season) => season.latestReadingAt && (season.status === "In progress" || season.status === "Planning") && !store.recommendations.some((recommendation) => recommendation.seasonId === season.id && recommendation.result.dataUsed.soil.recordedAt === season.latestReadingAt))} setModal={setModal} onGenerate={generateRecommendation} onReview={reviewRecommendation} onRecordOutcome={startOutcome}/>}
      {view === "serviceVisits" && store.role !== "Crop Scientist" && <ServiceVisitsWorkspace farms={store.farms} plots={store.plots} visits={store.serviceVisits} isAdmin={store.role === "Admin"} onRefresh={refreshWorkspace}/>}
      {view === "devices" && store.role === "Admin" && <DeviceManagementWorkspace onRefresh={refreshWorkspace}/>}
      {view === "knowledge" && (store.role === "Admin" || store.role === "Crop Scientist") && <KnowledgeLibrary setNotice={setNotice}/>}
      {view === "profile" && <ProfileWorkspace profile={store.profile} role={store.role} farms={store.farms} onRefresh={refreshWorkspace} onLogout={logout} onLoggedOut={(message) => { setSignedIn(false); setView("overview"); setNotice(message); }} onManageFarms={() => setView("farms")}/>}
    </div></main>
    {modal && <DataDialog key={selectedOutcomeSeasonId} kind={modal} farms={store.farms} farmers={store.farmers} plots={store.plots} seasons={store.seasons} recommendations={store.recommendations} selectedOutcomeSeasonId={selectedOutcomeSeasonId} initialFarmId={plotFarmId} farmerRecord={farmerDraft} onClose={() => { setModal(null); setFarmerDraft(null); }} onFarmer={saveFarmer} onFarm={saveFarm} onPlot={savePlot} onSeason={saveSeason} onReading={saveReading} onOutcome={saveOutcome}/>}
    {recommendationDialog && <RecommendationDialog recommendation={recommendationDialog} onClose={() => setRecommendationDialog(null)}/>}
    {notice && <Toast>{notice}</Toast>}
    {queueState.error && <Toast>{queueState.error}</Toast>}
  </div></Localize></LocalizedContent>;
}

function initials(name: string) { return name.split(" ").map((word) => word[0]).slice(0, 2).join("").toUpperCase(); }
function Landing({ onAuth }: { onAuth: (mode: "login" | "signup") => void }) {
  return <Localize><main className="landing-page"><header className="landing-nav"><a className="landing-brand" href="#top"><span className="brand-mark">c</span><span>AgroGauge<span className="brand-period">.</span></span></a><nav><a href="#approach">Our approach</a><a href="#benefits">Why AgroGauge</a><button className="nav-login" onClick={() => onAuth("login")}>Log in</button><button className="button nav-signup" onClick={() => onAuth("signup")}>Get started <span>↗</span></button></nav></header><section className="landing-hero" id="top"><div className="hero-image"/><div className="hero-shade"/><div className="hero-inner"><div className="hero-copy"><div className="eyebrow hero-eyebrow"><i/>A clearer picture of every season</div><h1>Grow smarter,<br/>season after season<span>.</span></h1><p>Soil data, farm history and trusted agricultural knowledge, brought together to help every decision take root.</p><div className="hero-actions"><button className="button button-lime" onClick={() => onAuth("signup")}>Create your workspace <span>↗</span></button><a className="hero-secondary" href="#approach">See how it works <span>↓</span></a></div><div className="hero-proof"><div className="proof-avatars"><span>AY</span><span>JM</span><span>FO</span></div><span>Built for the people<br/>who grow our future.</span></div></div><div className="hero-caption"><i/><span>Field notes, Kaduna State</span><span>10°31′N · 7°26′E</span></div></div><div className="hero-side-note">ROOTED IN YOUR LAND <span>·</span> READY FOR WHAT’S NEXT</div></section><section className="trust-strip"><div><i>01</i><strong>Know your soil</strong><span>Turn readings into a season-long record.</span></div><div><i>02</i><strong>Keep your history</strong><span>Every plot, crop and season in one place.</span></div><div><i>03</i><strong>Decide with context</strong><span>Recommendations grounded in expert knowledge.</span></div><div className="trust-side">Made for real farms.<br/><span>Designed for the field.</span></div></section><section className="approach-section" id="approach"><div className="approach-heading"><div><div className="eyebrow dark-eyebrow">A better season starts with better context</div><h2>Good decisions don’t<br/>start with a guess.</h2></div><p>AgroGauge connects what’s happening beneath the soil with what’s happened on your farm, so the next step is easier to see.</p></div><div className="approach-grid"><article className="approach-image-card"><div className="approach-photo"/><div className="photo-label"><span>FIELD RECORD · 2026</span><strong>Every plot tells a story.</strong></div></article><div className="approach-steps"><Step number="01" title="Bring your farm into focus" body="Set up farms, plots and seasons once. Your field history stays connected as the years move on."/><Step number="02" title="Add the details that matter" body="Record previous crops, farming methods, soil readings and the crops you can actually grow and sell."/><Step number="03" title="Review a recommendation" body="See the data behind each suggestion. Agricultural knowledge stays expert-approved; AI helps interpret it."/><button className="text-link" onClick={() => onAuth("signup")}>Start your farm record <span>↗</span></button></div></div></section><section className="benefit-band" id="benefits"><span className="benefit-kicker">BUILT AROUND YOUR FARM</span><p>Not just the weather.<br/><em>The whole season.</em></p><div className="benefit-bottom"><span>Made for field agents, farm managers and the farmers they work alongside.</span><button className="button button-lime" onClick={() => onAuth("signup")}>Get started <span>↗</span></button></div></section><footer className="landing-footer"><a className="landing-brand" href="#top"><span className="brand-mark">c</span><span>AgroGauge<span className="brand-period">.</span></span></a><span>Better context for every growing season.</span><span>© 2026 AgroGauge · Built for the field</span>  </footer></main></Localize>;
}
function Step({ number, title, body }: { number: string; title: string; body: string }) { return <Localize><article className="approach-step"><i>{number}</i><div><h3>{title}</h3><p>{body}</p></div><span>↗</span></article></Localize>; }

function AuthDialog({ mode, onModeChange, onClose, onSubmit }: { mode: "login" | "signup" | "reset"; onModeChange: (mode: "login" | "signup" | "reset" | null) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const [visible, setVisible] = useState(false), [error, setError] = useState("");
  const title = mode === "signup" ? "Start with your farm." : mode === "reset" ? "Reset your password." : "Welcome back.";
  return <Localize>{(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <span className="brand-mark" role="img" aria-label="AgroGauge logo"/>
        <div className="auth-kicker">AGROGAUGE WORKSPACE</div>
        <h2 id="auth-title">{title}</h2>
        <p className="auth-subtitle">{mode === "reset" ? "We’ll send a secure, one-time password reset link." : "Your farm’s story, all in one place."}</p>
        <form className="auth-form" onSubmit={(event) => {
          const password = String(new FormData(event.currentTarget).get("password") ?? "");
          if (mode === "signup" && password.length < 12) {
            event.preventDefault();
            setError("Use at least 12 characters for your password.");
            return;
          }
          setError("");
          void onSubmit(event);
        }}>
          {mode === "signup" && <label>Your name<input name="name" autoComplete="name" placeholder="e.g. Amina Yusuf" required/></label>}
          <label>Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required/></label>
          {mode !== "reset" && (
            <label>Password
              <div className="password-field">
                <input type={visible ? "text" : "password"} name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} placeholder={mode === "signup" ? "At least 12 characters" : "Your password"} required/>
                <PasswordVisibilityToggle visible={visible} onToggle={() => setVisible(!visible)}/>
              </div>
            </label>
          )}
          {mode === "signup" && <p className="auth-privacy">New accounts start as farmers. An administrator can grant team roles.</p>}
          {error && <div className="auth-message" role="alert">{error}</div>}
          <button className="button button-dark auth-submit">{mode === "signup" ? "Create workspace" : mode === "reset" ? "Send reset instructions" : "Log in"}<span>↗</span></button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? <>
            New to AgroGauge? <button onClick={() => { setError(""); onModeChange("signup"); }}>Create an account</button>
            <button className="forgot-link" onClick={() => { setError(""); onModeChange("reset"); }}>Forgot password?</button>
          </> : <button onClick={() => { setError(""); onModeChange("login"); }}>Back to log in</button>}
        </div>
        <p className="auth-privacy">Secure sessions are stored on the server, not in your browser.</p>
      </section>
    </div>
  )}</Localize>;
}

function Overview({ store, setView, setModal }: { store: Store; setView: (view: View) => void; setModal: (modal: Modal) => void }) {
  const [now, setNow] = useState<Date | null>(null);
  const dateLocale = store.profile.language === "YO" ? "yo-NG" : store.profile.language === "HA" ? "ha-NG" : "en-NG";
  useEffect(() => {
    const updateTime = () => setNow(new Date());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const active = store.seasons.filter((season) => season.status !== "Completed").length, pending = store.readings.filter((reading) => reading.sync !== "Synced").length;
  const hour = now?.getHours();
  const greeting = hour === undefined
    ? "Good day"
    : hour >= 5 && hour < 12
      ? "Good morning"
      : hour >= 12 && hour < 17
        ? "Good afternoon"
        : "Good evening";
  const dateTime = now
    ? `${new Intl.DateTimeFormat(dateLocale, { weekday: "long", month: "long", day: "2-digit", year: "numeric" }).format(now)} · ${new Intl.DateTimeFormat(dateLocale, { hour: "numeric", minute: "2-digit", hour12: store.profile.timeFormat === "H12" }).format(now)}`
    : "Local date and time";
  const farmLocation = store.farms[0]?.location.trim() || "Farm location not set";
  return <Localize><><div className="welcome-row"><div><div className="date-eyebrow">{dateTime} <span>·</span> {farmLocation}</div><h1>{greeting}, {store.farmer.split(" ")[0]}<span className="wave-mark">.</span></h1><p>Here’s what’s happening across your farms today.</p></div><button className="button button-dark" onClick={() => setModal("season")}>＋ Start a season</button></div><div className="stat-grid"><Stat label="Farms" value={store.farms.length} detail="Across your workspace" tone="green" icon="⌂"/><Stat label="Plots tracked" value={store.farms.reduce((sum, farm) => sum + farm.plots, 0)} detail="Across all farms" tone="blue" icon="▦"/><Stat label="Active seasons" value={active} detail="Currently growing" tone="orange" icon="◷"/><Stat label="Readings to sync" value={pending} detail={pending ? "Saved on this device" : "Everything is up to date"} tone="yellow" icon="⌁"/></div><div className="dashboard-grid"><section className="panel season-panel"><PanelHead kicker="IN THE FIELD" title="Current seasons" action="All seasons" onClick={() => setView("seasons")}/>{store.seasons.filter((season) => season.status !== "Completed").slice(0,3).map((season,index) => <div className="season-row" key={season.id}><span className={`crop-thumbnail crop-${index%3}`}>{index === 0 ? "GV" : "RB"}</span><div className="season-main"><div className="season-title">{season.name}<Badge text={season.status}/></div><div className="season-meta">{season.farm}<span>·</span>{season.plot}</div></div><div className="season-crop"><small>GROWING</small><strong>{season.crop}</strong></div><button className="row-arrow" onClick={() => setView("seasons")}>↗</button></div>)}<button className="panel-footer-link" onClick={() => setModal("season")}>＋ Add another season</button></section><section className="panel reading-panel"><PanelHead kicker="SOIL SNAPSHOT" title="Latest readings" action="View history" onClick={() => setView("soil")}/>{store.readings.slice(0,2).map((reading) => <div className="reading-item" key={reading.id}><div className="reading-item-top"><strong>{reading.plot}</strong><SyncStatus value={reading.sync}/></div><div className="metric-row"><Metric label="NITROGEN" value={`${reading.nitrogen} ppm`}/><Metric label="PHOSPHORUS" value={`${reading.phosphorus} ppm`}/><Metric label="POTASSIUM" value={`${reading.potassium} ppm`}/><Metric label="SOIL TEMP" value={`${reading.soilTemperature} °C`}/><Metric label="HUMIDITY" value={`${reading.humidity}%`}/><span className="reading-date">{reading.date}</span></div></div>)}<button className="record-reading" onClick={() => setModal("reading")}>＋ Record a soil reading</button></section></div><div className="lower-grid"><section className="panel farms-panel"><PanelHead kicker="YOUR LAND" title="Farm overview" action="Manage farms" onClick={() => setView("farms")}/><div className="farm-table"><div className="farm-table-head"><span>FARM</span><span>LOCATION</span><span>AREA</span><span>PLOTS</span><span>STATUS</span></div>{store.farms.slice(0,3).map((farm,index) => <div className="farm-table-row" key={farm.id}><div className="farm-name-cell"><span className={`farm-mini-mark mark-${index%3}`}>⌂</span><span><strong>{farm.name}</strong><small>{farm.id}</small></span></div><span className="farm-location">{farm.location}</span><span>{farm.area} ha</span><span>{String(farm.plots).padStart(2,"0")}</span><span className="farm-status"><i/>Active</span></div>)}</div></section><aside className="panel recommendation-teaser"><div className="section-kicker">SCIENTIST-APPROVED KNOWLEDGE</div><div className="rec-icon">✳</div><h2>Better decisions<br/>start with context.</h2><p>Bring soil, crop history and farmer requirements together before a recommendation is made.</p><button className="button button-outline" onClick={() => setView("recommendations")}>Explore recommendations <span>↗</span></button><small className="teaser-foot">AI interprets approved knowledge. It isn’t the source of truth.</small></aside></div><footer className="dashboard-footer"><span>AgroGauge <i>·</i> Season after season</span><span>Last synced just now <i className="online-dot"/></span></footer></></Localize>;
}
function PanelHead({ kicker, title, action, onClick }: { kicker: string; title: string; action: string; onClick: () => void }) { return <Localize><div className="panel-header"><div><div className="section-kicker">{kicker}</div><h2>{title}</h2></div><button className="quiet-link" onClick={onClick}>{action} <span>↗</span></button></div></Localize>; }
function Stat({ label, value, detail, tone, icon }: { label: string; value: number; detail: string; tone: string; icon: string }) { return <Localize><article className="stat-card"><div className="stat-top"><span>{label}</span><i className={`stat-icon icon-${tone}`}>{icon}</i></div><div className="stat-value">{String(value).padStart(2,"0")}</div><div className="stat-detail">{detail}</div></article></Localize>; }
function Metric({ label, value }: { label: string; value: string }) { return <Localize><div className="metric"><span>{label}</span><strong>{value}</strong></div></Localize>; }
function measurement(value: number | null, unit: string) { return value === null ? "Not recorded" : `${value} ${unit}`; }
function Badge({ text }: { text: string }) { return <Localize><span className={`status ${text === "Review due" ? "status-review" : text === "Completed" ? "status-complete" : "status-active"}`}>{text}</span></Localize>; }
function SyncStatus({ value }: { value: string }) { return <Localize><span className={`sync-status ${value === "Synced" ? "" : "sync-pending"}`}><i/>{value}</span></Localize>; }
function CropListField({ name, label, hint, required = false, selectedCrops, onSelectionChange }: { name: string; label: string; hint?: string; required?: boolean; selectedCrops?: string[]; onSelectionChange?: (crops: string[]) => void }) {
  const [localSelection, setLocalSelection] = useState<string[]>([]);
  const selected = selectedCrops ?? localSelection;
  function updateSelection(crop: string, checked: boolean) {
    const next = checked ? [...selected, crop] : selected.filter((item) => item !== crop);
    if (onSelectionChange) onSelectionChange(next);
    else setLocalSelection(next);
  }
  return <Localize><div className="crop-list-field"><div className="crop-list-header"><strong>{label}</strong>{hint && <small>{hint}</small>}</div><details className="crop-selector-dropdown"><summary>{selected.length ? `${selected.length} crop${selected.length === 1 ? "" : "s"} selected` : "Select crops"}<span aria-hidden="true">⌄</span></summary><div className="crop-selector-grid" role="group" aria-label={label}>{CROP_OPTIONS.map((crop) => <label className="crop-option" key={crop}><input type="checkbox" name={name} value={crop} checked={selected.includes(crop)} required={required && selected.length === 0 && crop === CROP_OPTIONS[0]} onChange={(event) => updateSelection(crop, event.target.checked)}/><span>{crop}</span></label>)}</div></details></div></Localize>;
}

function Farmers({ farmers, canRegister, canEdit, onNew, onEdit }: { farmers: Farmer[]; canRegister: boolean; canEdit: boolean; onNew: () => void; onEdit: (farmer: Farmer) => void }) {
  const [query, setQuery] = useState("");
  const filtered = farmers.filter((farmer) => `${farmer.id} ${farmer.name} ${farmer.phone} ${farmer.location}`.toLowerCase().includes(query.toLowerCase()));
  return <Localize><><div className="page-heading-row"><div><div className="date-eyebrow">PEOPLE · FARMER REGISTER</div><h1>Farmers</h1><p>Permanent farmer records connected to farms, seasons and field history.</p></div>{canRegister && <button className="button button-dark" onClick={onNew}>＋ Register farmer</button>}</div><section className="panel list-page-panel"><div className="panel-header list-toolbar"><div><div className="section-kicker">FARMER DIRECTORY</div><h2>{filtered.length} of {farmers.length} farmers</h2></div><label className="search-field"><span>⌕</span><input aria-label="Search farmers" placeholder="Search name, ID or location" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div>{filtered.map((farmer) => <article className="farmer-row" key={farmer.id}><span className="profile-avatar">{initials(farmer.name)}</span><div className="farmer-main"><strong>{farmer.name}</strong><small>{farmer.id}</small></div><div className="farmer-contact"><small>PHONE</small><strong>{farmer.phone}</strong></div><div className="farmer-contact"><small>LOCATION</small><strong>{farmer.location}</strong></div><span className="method-tag">{farmer.farming}</span>{canEdit && <button className="quiet-link" onClick={() => onEdit(farmer)}>Edit</button>}</article>)}</section><Note text="Farmer IDs are assigned once at registration and remain attached to their record."/></></Localize>;
}
function Farms({ farms, total, query, setQuery, plots, setModal, seasons, onAddPlot }: { farms: Farm[]; total: number; query: string; setQuery: (value: string) => void; plots: Plot[]; setModal: (modal: Modal) => void; seasons: Season[]; onAddPlot: (farmId: string) => void }) {
  return <Localize><><PageTitle kicker="YOUR LAND · FARM MANAGEMENT" title="Farms" description="Each farm keeps its fields, seasons and soil history together." action="＋ Add a farm" onClick={() => setModal("farm")}/><section className="panel list-page-panel"><div className="panel-header list-toolbar"><div><div className="section-kicker">FARM REGISTER</div><h2>{total} farms</h2></div><label className="search-field"><span>⌕</span><input aria-label="Search farms" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search farms or locations"/></label></div>{farms.length ? farms.map((farm,index) => {
    const farmPlots = plots.filter((plot) => plot.farmId ? plot.farmId === farm.id : plot.farm === farm.name);
    return <article className="farm-card-row" key={farm.id}>
      <span className={`farm-large-mark mark-${index%3}`}>⌂</span>
      <div className="farm-card-main">
        <div className="farm-card-title"><h3>{farm.name}</h3><Badge text="Active"/></div>
        <p>{farm.location} <span>·</span> {farm.id}</p>
        <div className="farm-card-facts"><span><strong>{farm.area}</strong> hectares</span><span><strong>{farmPlots.length}</strong> fields</span><span><strong>{seasons.filter((season) => season.farm === farm.name).length}</strong> seasons</span></div>
        <div className="farm-fields">
          <div className="farm-fields-heading"><strong>Fields / plots</strong><button className="quiet-link" onClick={() => onAddPlot(farm.id)}>＋ Add field</button></div>
          {farmPlots.length ? farmPlots.map((plot) => <div className="farm-field-row" key={plot.id}>
            <span className="farm-field-icon">▦</span>
            <strong>{plot.name}</strong>
            <span>{plot.area} ha</span>
            <small>{plot.location}</small>
          </div>) : <p className="farm-fields-empty">No fields added yet. Add a field when the farm has separate areas to track.</p>}
        </div>
      </div>
      <div className="farm-quick-actions">
        <button className="button button-outline farm-quick-action" onClick={() => setModal("season")}>＋ Add season</button>
      </div>
    </article>;
  }) : <Empty title="No farms match that search" detail="Try another name or location." action="Clear search" onClick={() => setQuery("")}/>}</section><Note text="A farm is the main record. Add fields / plots only when you need to track distinct areas separately."/></></Localize>;
}
function Seasons({ seasons, setModal }: { seasons: Season[]; setModal: (modal: Modal) => void }) {
  return <Localize><><PageTitle kicker="SEASONAL MEMORY · HISTORY THAT CARRIES FORWARD" title="Seasons" description="Past and present, recorded without overwriting what came before." action="＋ Start a season" onClick={() => setModal("season")}/><section className="panel list-page-panel"><div className="panel-header"><div><div className="section-kicker">ALL SEASONS</div><h2>{seasons.length} records</h2></div><span className="table-caption">FARM · PLOT · CROP · METHOD</span></div>{seasons.length ? seasons.map((season,index) => <article className="season-history-row" key={season.id}><span className={`history-number history-${index%3}`}>{String(seasons.length-index).padStart(2,"0")}</span><div className="history-main"><div className="season-title">{season.name}<Badge text={season.status}/></div><div className="season-meta">{season.farm}<span>·</span>{season.plot}</div></div><div className="history-crop"><small>CROP(S)</small><strong>{season.crop}</strong></div><div className="history-method"><small>METHOD</small><strong>{season.method}</strong></div><span className="history-id">{season.id}</span></article>) : <Empty title="Your season history starts here" detail="Create a season to record crops, farming methods and requirements." action="＋ Start a season" onClick={() => setModal("season")}/>}</section><Note text="New seasons can reuse previous crop history automatically. Each season keeps its own soil readings and requirements."/></></Localize>;
}
function Soil({ farms, seasons, devices, readings, queuedReadings, offline, syncingDevices, onSyncDevice, setModal, onRetry, onDiscard }: { farms: Farm[]; seasons: Season[]; devices: SoilDevice[]; readings: Reading[]; queuedReadings: QueuedReading[]; offline: boolean; syncingDevices: Record<string, boolean>; onSyncDevice: (device: SoilDevice) => void; setModal: (modal: Modal) => void; onRetry: (idempotencyKey: string) => void; onDiscard: (idempotencyKey: string) => void }) {
  const [selectedFarmId, setSelectedFarmId] = useState("ALL");
  const selectedReadings = readings.filter((reading) =>
    selectedFarmId === "ALL" || reading.farmId === selectedFarmId,
  );
  const selectedQueuedReadings = queuedReadings.filter((reading) => {
    if (selectedFarmId === "ALL") return true;
    const season = seasons.find((item) => item.id === reading.seasonId);
    return season?.farmId === selectedFarmId;
  });
  const selectedDevices = devices.filter((device) =>
    selectedFarmId === "ALL" || device.farmId === selectedFarmId,
  );
  return <Localize><>
    <PageTitle kicker="FIELD DATA · PLOT-SPECIFIC HISTORY" title="Soil readings" description="Record NPK, soil temperature and humidity for each plot and season." action="＋ Record reading" onClick={() => setModal("reading")} />
    <div className="soil-intro-grid">
      <div className="soil-intro panel"><div className="section-kicker">FIELD COLLECTION</div><h2>Capture first.<br />Sync when you can.</h2><p>Readings are stored locally when offline and synced with their stable IDs when connectivity returns.</p><div className={`offline-banner ${offline ? "offline-now" : ""}`}><i />{offline ? `${selectedQueuedReadings.length} reading(s) saved on this device.` : "Online. Pending readings sync automatically."}</div></div>
      <div className="soil-stat panel"><span>⌁</span><small>SERVER READINGS</small><strong>{String(selectedReadings.length).padStart(2, "0")}</strong><span>{selectedFarmId === "ALL" ? "Across all tracked farms" : farms.find((farm) => farm.id === selectedFarmId)?.name ?? "Selected farm"}</span></div>
    </div>
    <section className="panel list-page-panel readings-table-panel">
      <div className="panel-header"><div><div className="section-kicker">READING HISTORY</div><h2>Recent measurements</h2></div><label className="soil-farm-filter">Farm<select value={selectedFarmId} onChange={(event) => setSelectedFarmId(event.target.value)}><option value="ALL">All farms</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label></div>
      {selectedDevices.length > 0 && <div className="soil-device-sync-list" aria-label="Sync readings by device">{selectedDevices.map((device) => <article className="soil-device-sync-row" key={device.id}><span className="soil-device-icon">▣</span><div><strong>{device.deviceCode}</strong><small>{device.farm} · Node {device.externalNodeId}</small></div><button type="button" className="button button-outline" disabled={offline || syncingDevices[device.id]} onClick={() => onSyncDevice(device)}>{syncingDevices[device.id] ? "Syncing…" : "Sync readings ↻"}</button></article>)}</div>}
      <div className="readings-table-head"><span>READING / PLOT</span><span>NITROGEN</span><span>PHOSPHORUS</span><span>POTASSIUM</span><span>TEMP · HUMIDITY</span><span>SYNC STATUS</span></div>
      {selectedReadings.map((reading) => <div className="readings-table-row" key={reading.id}><div><strong>{reading.id}</strong><small>{reading.farm ? `${reading.farm} · ` : ""}{reading.plot} <span>·</span> {reading.date}</small></div><strong>{measurement(reading.nitrogen, "ppm")}</strong><strong>{measurement(reading.phosphorus, "ppm")}</strong><strong>{measurement(reading.potassium, "ppm")}</strong><strong>{reading.soilTemperature === null || reading.humidity === null ? "Not recorded" : `${reading.soilTemperature} °C · ${reading.humidity}%`}</strong><SyncStatus value={reading.sync} /></div>)}
      {selectedQueuedReadings.map((reading) => <div className="readings-table-row" key={reading.idempotencyKey}><div><strong>{reading.idempotencyKey.slice(0, 12)}</strong><small>{reading.plotCode} <span>·</span> {new Date(reading.recordedAt).toLocaleString()}</small>{reading.syncError && <small role="alert">{reading.syncError}</small>}</div><strong>{reading.nitrogen} ppm</strong><strong>{reading.phosphorus} ppm</strong><strong>{reading.potassium} ppm</strong><strong>{reading.soilTemperature} °C · {reading.humidity}%</strong><div className="queued-reading-actions"><SyncStatus value={reading.syncStatus === "PENDING" ? "Pending sync" : reading.syncStatus === "CONFLICT" ? "Conflict" : "Failed"} />{reading.syncStatus === "FAILED" && <button type="button" className="quiet-link" onClick={() => onRetry(reading.idempotencyKey)}>Retry</button>}{reading.syncStatus === "CONFLICT" && <small>Discard to resolve</small>}<button type="button" className="quiet-link" onClick={() => onDiscard(reading.idempotencyKey)}>Discard</button></div></div>)}
      {selectedReadings.length === 0 && selectedQueuedReadings.length === 0 && <p className="science-caveat">No soil readings are recorded for this farm yet.</p>}
    </section>
    <p className="science-caveat">Measurements are recorded as provided by the field team. Interpretation requires scientist-approved methods.</p>
  </></Localize>;
}
function Recommendations({ seasons, recommendations, outcomes, isFarmer, recommendingSeasonId, onRecommend, canReview, pendingReview, setModal, onGenerate, onReview, onRecordOutcome }: { seasons: Season[]; recommendations: SavedRecommendation[]; outcomes: Outcome[]; isFarmer: boolean; recommendingSeasonId: string | null; onRecommend: (seasonId: string) => void; canReview: boolean; pendingReview: boolean; setModal: (modal: Modal) => void; onGenerate: (seasonId: string) => void; onReview: (recommendationId: string, action: "approve" | "share") => void; onRecordOutcome: (seasonId: string) => void }) {
  const activeRecommendations = recommendations.filter((recommendation) => recommendation.status !== "ARCHIVED");
  const badgeText = (recommendation: SavedRecommendation) => recommendation.provider === "cropcycle-crop-knowledge-base" ? "UNCONFIRMED · PROVISIONAL" : recommendation.status === "SHARED" ? "REVIEWED & SHARED" : recommendation.status === "APPROVED" ? "APPROVED · NOT SHARED" : "SCIENTIST REVIEW REQUIRED";
  return <Localize><>
    <PageTitle kicker="DECISION SUPPORT · EXPERT KNOWLEDGE FIRST" title="Recommendations" description="Every assessment cites approved knowledge and the plot-season data used." action="＋ Prepare a season" onClick={() => setModal("season")}/>
    <div className="recommendation-banner"><div className="rec-banner-symbol">✳</div><div><span className="banner-label">CROP SCIENTIST KNOWLEDGE</span><h2>Experts define the ranges.<br/>Every assessment shows its work.</h2><p>New synced readings are compared with the crop scientist&apos;s Minna knowledge base. Missing soil evidence stays visible; assessments are provisional until required checks are available.</p></div><div className="banner-stamp">EXPERT SOURCES<br/><span>→</span> EXPLAINABLE REVIEW</div></div>
    <section className="panel list-page-panel"><div className="panel-header"><div><div className="section-kicker">RECOMMENDATION HISTORY</div><h2>{activeRecommendations.length} saved assessments</h2></div><span className="table-caption">{seasons.length} SEASONS</span></div>{seasons.length ? seasons.map((season) => { const canRecommend = Boolean(season.latestReadingAt) && (season.status === "In progress" || season.status === "Planning"); return <article className="recommendation-context-row" key={season.id}><span className="rec-row-symbol">✳</span><div className="history-main"><strong>{season.farm} · {season.plot}</strong><div className="season-meta">{season.name}<span>·</span>{season.method}</div></div><div className="history-crop"><small>{isFarmer ? "LATEST SOIL READING" : "FARMER-LISTED CROP(S)"}</small><strong>{isFarmer ? (season.latestReadingAt ? new Date(season.latestReadingAt).toLocaleString() : "Sync a reading first") : season.crop}</strong></div><div className="recommendation-actions">{isFarmer ? <button className="button button-dark" disabled={!canRecommend || recommendingSeasonId !== null} onClick={() => onRecommend(season.id)}>{recommendingSeasonId === season.id ? "Preparing…" : "Recommend"}</button> : <button className="button button-outline" onClick={() => onGenerate(season.id)}>Assess this season</button>}{!isFarmer && <button className="button button-outline quiet" onClick={() => onRecordOutcome(season.id)}>Record outcome</button>}</div></article>; }) : <Empty title="Start with a season record" detail="Add the plot, previous crop, farming method and requirements first." action="＋ Start a season" onClick={() => setModal("season")}/>}</section>
    {outcomes.length > 0 && <section className="panel list-page-panel"><div className="panel-header"><div><div className="section-kicker">PLANTED CROPS & FARMER FEEDBACK</div><h2>{outcomes.length} recorded outcomes</h2></div><span className="table-caption">ACTUAL CROPS · SEASONAL MEMORY</span></div>{outcomes.map((outcome) => { const recommendation = recommendations.find((item) => item.id === outcome.recommendationId); return <article className="recommendation-context-row" key={outcome.id}><span className="rec-row-symbol">✓</span><div className="history-main"><strong>{outcome.farm} · {outcome.plot}</strong><div className="season-meta">{outcome.season} · Recorded {new Date(outcome.recordedAt).toLocaleDateString()}</div></div><div className="history-crop"><small>ACTUALLY PLANTED</small><strong>{outcome.actualCrops.join(" + ")}</strong></div><div className="history-crop"><small>RECOMMENDATION</small><strong>{recommendation ? `Version ${recommendation.version}` : "Not linked"}</strong></div><div className="history-method"><small>FEEDBACK</small><strong>{outcome.feedback.map((feedback) => [feedback.rating ? `${feedback.rating}/5` : "", feedback.comment].filter(Boolean).join(" · ")).filter(Boolean).join(" / ") || outcome.notes || "None recorded"}</strong></div></article>; })}</section>}
    {!isFarmer && activeRecommendations.map((recommendation) => <section className="panel recommendation-result-card" key={recommendation.id}>
      <div className="panel-header"><div><div className="section-kicker">SAVED ASSESSMENT · VERSION {recommendation.version}</div><h2>{recommendation.farm} · {recommendation.plot}</h2><p>{recommendation.season} · {new Date(recommendation.createdAt).toLocaleString()}</p></div><span className="review-badge">{badgeText(recommendation)}</span></div>
      <p className="science-caveat">{recommendation.result.notice}</p>
      {recommendation.result.candidates.length ? recommendation.result.candidates.map((candidate) => <article className="assessment-crop" key={candidate.crop}>
        <div className="assessment-crop-title"><h3>{candidate.crop}</h3><span className={`assessment-status assessment-${candidate.suitability}`}>{candidate.suitability === "supported" ? "Within approved criteria" : candidate.suitability === "review-needed" ? "Review needed" : candidate.suitability === "unsuitable" ? "Not suitable as-is" : "Insufficient data"}</span></div>
        {candidate.reasons.length > 0 && <p><strong>Reasons:</strong> {candidate.reasons.join(" · ")}</p>}
        {candidate.alternatives.length > 0 && <p><strong>Expert-listed alternatives:</strong> {candidate.alternatives.join(", ")}</p>}
        {candidate.considerations.length > 0 && <p><strong>Considerations:</strong> {candidate.considerations.join(" · ")}</p>}
        {candidate.knowledge.length > 0 && <ul>{candidate.knowledge.map((source) => <li key={source.id}>{source.title} (v{source.version}) — {source.source}</li>)}</ul>}
      </article>) : <p className="science-caveat">No candidate crop was recorded. Add intended, available, or marketable crops to the season first.</p>}
      <div className="assessment-data"><strong>Data used</strong><span>Nitrogen: {recommendation.result.dataUsed.soil.nitrogen ?? "not recorded"} ppm</span><span>Phosphorus: {recommendation.result.dataUsed.soil.phosphorus ?? "not recorded"} ppm</span><span>Potassium: {recommendation.result.dataUsed.soil.potassium ?? "not recorded"} ppm</span><span>Soil moisture: {recommendation.result.dataUsed.soil.moisture ?? "not recorded"}%</span><span>Soil temperature: {recommendation.result.dataUsed.soil.soilTemperature ?? "not recorded"} °C</span><span>pH: {recommendation.result.dataUsed.soil.pH ?? "not recorded"}</span><span>EC: {recommendation.result.dataUsed.soil.electricalConductivity ?? "not recorded"}</span><span>Humidity: {recommendation.result.dataUsed.soil.humidity ?? "not recorded"}%</span><span>Previous crops: {recommendation.result.dataUsed.previousCrops.join(", ") || "not recorded"}</span><span>Intended: {recommendation.result.dataUsed.intendedCrops.join(", ") || "not recorded"}</span><span>Available: {recommendation.result.dataUsed.availableCrops.join(", ") || "not recorded"}</span><span>Market: {recommendation.result.dataUsed.marketableCrops.join(", ") || "not recorded"}</span><span>Preferred method: {recommendation.result.dataUsed.preferredMethod ?? "not recorded"}</span>{recommendation.result.dataUsed.otherRequirements && <span>Other requirements: {recommendation.result.dataUsed.otherRequirements}</span>}</div>
      {canReview && <div className="knowledge-actions">{recommendation.status === "NEEDS_REVIEW" && (recommendation.provider === "cropcycle-crop-knowledge-base" ? <small>Provisional only: collect soil pH and EC before approval.</small> : <button className="button button-dark" onClick={() => onReview(recommendation.id, "approve")}>Approve assessment</button>)}{recommendation.status === "APPROVED" && <button className="button button-dark" onClick={() => onReview(recommendation.id, "share")}>Share with farm</button>}{recommendation.reviewedAt && <small>Reviewed {new Date(recommendation.reviewedAt).toLocaleString()}</small>}</div>}
    </section>)}
    {pendingReview && <Note text="Your latest soil reading is synced and awaiting assessment and Crop Scientist review. Crop suggestions will appear here after the assessment is approved and shared."/ >}
    {activeRecommendations.length === 0 && !pendingReview && <Note text="No active assessments yet. New synced soil readings will be assessed against the crop scientist's crop knowledge base."/ >}
  </></Localize>;
}

function RecommendationDialog({ recommendation, onClose }: { recommendation: SavedRecommendation; onClose: () => void }) {
  return <Localize><div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="data-dialog recommendation-dialog" role="dialog" aria-modal="true" aria-labelledby="recommendation-dialog-title">
      <div className="recommendation-dialog-header"><div><div className="section-kicker">CROP RECOMMENDATION · {recommendation.farm}</div><h2 id="recommendation-dialog-title">Crops to consider for {recommendation.plot}</h2><p>{recommendation.season} · Reading from {new Date(recommendation.result.dataUsed.soil.recordedAt ?? recommendation.createdAt).toLocaleString()}</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close recommendations">×</button></div>
      <div className="recommendation-provisional-note"><strong>UNCONFIRMED · PROVISIONAL</strong><p>{recommendation.result.notice}</p></div>
      <div className="recommendation-reading-summary" aria-label="Synced soil reading used for these suggestions">
        <strong>Synced reading used</strong>
        <span>Nitrogen: {recommendation.result.dataUsed.soil.nitrogen ?? "not recorded"} ppm</span>
        <span>Phosphorus: {recommendation.result.dataUsed.soil.phosphorus ?? "not recorded"} ppm</span>
        <span>Potassium: {recommendation.result.dataUsed.soil.potassium ?? "not recorded"} ppm</span>
        <span>Moisture: {recommendation.result.dataUsed.soil.moisture ?? "not recorded"}%</span>
        <span>Temperature: {recommendation.result.dataUsed.soil.soilTemperature ?? "not recorded"} °C</span>
      </div>
      <div className="recommendation-dialog-list" aria-label="Recommended crops">
        {recommendation.result.candidates.map((candidate, index) => <article className="recommendation-dialog-crop" key={candidate.crop}>
          <span className="recommendation-rank">{String(index + 1).padStart(2, "0")}</span>
          <div className="recommendation-dialog-crop-copy"><div className="assessment-crop-title"><h3>{candidate.crop}</h3><span className={`assessment-status assessment-${candidate.suitability}`}>{candidate.suitability === "supported" ? "Within approved criteria" : candidate.suitability === "review-needed" ? "Review needed" : candidate.suitability === "unsuitable" ? "Not suitable as-is" : "Needs more soil data"}</span></div>
            {candidate.reasons.length > 0 && <p><strong>Why it is listed:</strong> {candidate.reasons.join(" · ")}</p>}
            {candidate.considerations.length > 0 && <p><strong>Check before planting:</strong> {candidate.considerations.join(" · ")}</p>}
          </div>
        </article>)}
      </div>
      <div className="recommendation-dialog-footer"><p>Use this shortlist as decision support, not a guarantee of yield. Confirm soil pH and EC with a soil test and consult local extension guidance before planting.</p><button type="button" className="button button-dark" onClick={onClose}>Done</button></div>
    </section>
  </div></Localize>;
}

function KnowledgeLibrary({ setNotice }: { setNotice: (message: string) => void }) {
  const [rules, setRules] = useState<KnowledgeRuleRecord[]>([]);
  const [editing, setEditing] = useState<KnowledgeRuleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestJson<{ rules: KnowledgeRuleRecord[] }>("/api/knowledge");
      setRules(result.rules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load agricultural knowledge.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ rules: KnowledgeRuleRecord[] }>("/api/knowledge")
      .then((result) => {
        if (!cancelled) setRules(result.rules);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load agricultural knowledge.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let body: unknown;
    try {
      body = JSON.parse(String(data.get("body") ?? ""));
    } catch {
      setError("Knowledge conditions must be valid JSON.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const values = {
        title: String(data.get("title") ?? "").trim(),
        sourceCitation: String(data.get("sourceCitation") ?? "").trim(),
        effectiveFrom: String(data.get("effectiveFrom") ?? "") || null,
        effectiveTo: String(data.get("effectiveTo") ?? "") || null,
        body,
      };
      await requestJson(editing ? `/api/knowledge/${editing.id}` : "/api/knowledge", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(editing ? { ...values, action: "update" } : values),
      });
      setEditing(null);
      setNotice(editing ? "Draft knowledge updated." : "Knowledge draft created.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save agricultural knowledge.");
    } finally {
      setSaving(false);
    }
  }

  async function review(rule: KnowledgeRuleRecord, action: "approve" | "retire") {
    setError("");
    try {
      await requestJson(`/api/knowledge/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setNotice(action === "approve" ? "Knowledge approved and versioned." : "Knowledge retired.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update knowledge status.");
    }
  }

  const initialBody = JSON.stringify({
    crop: "",
    region: "",
    farmingMethods: ["MONO_CROPPING"],
    soil: { nitrogen: { min: 0, max: 1000 } },
    avoidAfter: [],
    reasons: [""],
    considerations: [""],
    alternatives: [],
  }, null, 2);

  return <Localize><><div className="page-heading-row"><div><div className="date-eyebrow">CROP SCIENTIST WORKSPACE · SOURCE-TRACEABLE RULES</div><h1>Agricultural knowledge</h1><p>Draft, version, approve and retire cited rules. Only approved rules inform assessments.</p></div></div><div className="knowledge-layout"><section className="panel knowledge-editor"><div className="section-kicker">{editing ? `EDIT DRAFT · VERSION ${editing.version}` : "NEW KNOWLEDGE DRAFT"}</div><h2>{editing ? editing.title : "Record an expert rule"}</h2><p>Use measured conditions and cite the source. Do not encode unreviewed recommendations.</p><form className="data-form" onSubmit={save}><label>Rule title<input name="title" required minLength={3} maxLength={200} defaultValue={editing?.title ?? ""} key={editing?.id ?? "new-title"}/></label><label>Source citation<input name="sourceCitation" required minLength={4} maxLength={4000} defaultValue={editing?.sourceCitation ?? ""} key={editing?.id ?? "new-source"}/></label><div className="form-grid"><label>Effective from<input name="effectiveFrom" type="date" defaultValue={editing?.effectiveFrom?.slice(0, 10) ?? ""} key={editing?.id ?? "new-from"}/></label><label>Effective until<input name="effectiveTo" type="date" defaultValue={editing?.effectiveTo?.slice(0, 10) ?? ""} key={editing?.id ?? "new-to"}/></label></div><label>Structured rule (JSON)<textarea name="body" rows={14} required defaultValue={editing ? JSON.stringify(editing.body, null, 2) : initialBody} key={editing?.id ?? "new-body"}/></label><p className="knowledge-help">Body format: crop, optional region and farmingMethods, any range(s) for N, P, K (ppm), soilTemperature (°C, -50 to 100), or humidity (%); optional avoidAfter and expert-listed alternatives; and reasons and considerations. Methods: MONO_CROPPING and MIXED_FARMING.</p>{error && <div role="alert" className="auth-message">{error}</div>}<div className="dialog-actions">{editing && <button type="button" className="button button-cancel" onClick={() => setEditing(null)}>Cancel edit</button>}<button className="button button-dark" disabled={saving}>{saving ? "Saving…" : editing ? "Save draft" : "Save draft for review"}</button></div></form></section><section className="panel list-page-panel knowledge-list"><div className="panel-header"><div><div className="section-kicker">KNOWLEDGE REGISTER</div><h2>{rules.length} versioned rules</h2></div><button className="quiet-link" onClick={() => void refresh()}>Refresh ↻</button></div>{loading ? <p>Loading approved knowledge and drafts…</p> : rules.length === 0 ? <Empty title="No expert rules yet" detail="Add a source-cited draft before generating assessments." action="Create a draft" onClick={() => document.querySelector(".knowledge-editor")?.scrollIntoView({ behavior: "smooth" })}/> : rules.map((rule) => <article className="knowledge-rule-row" key={rule.id}><div className="knowledge-rule-title"><div><strong>{rule.title}</strong><small>{rule.key} · Version {rule.version}</small></div><span className={`knowledge-status knowledge-${rule.status.toLowerCase()}`}>{rule.status.replace("_", " ")}</span></div><p>{rule.sourceCitation}</p><details><summary>View structured criteria</summary><pre>{JSON.stringify(rule.body, null, 2)}</pre></details>{rule.effectiveFrom && <small>Effective from {new Date(rule.effectiveFrom).toLocaleDateString()}</small>}{rule.status === "DRAFT" && <div className="knowledge-actions"><button className="quiet-link" onClick={() => setEditing(rule)}>Edit draft</button><button className="button button-dark" onClick={() => void review(rule, "approve")}>Approve rule</button></div>}{rule.status === "APPROVED" && <div className="knowledge-actions"><span>Approved {rule.approvedAt ? new Date(rule.approvedAt).toLocaleDateString() : ""}</span><button className="quiet-link" onClick={() => void review(rule, "retire")}>Retire rule</button></div>}</article>)}</section></div><Note text="Approving a new version retires the prior approved version for the same crop and region. Saved assessments preserve the exact source-rule versions they used."/ ></></Localize>;
}
function PageTitle({ kicker, title, description, action, onClick }: { kicker: string; title: string; description: string; action: string; onClick: () => void }) { return <Localize><div className="page-heading-row"><div><div className="date-eyebrow">{kicker}</div><h1>{title}</h1><p>{description}</p></div><button className="button button-dark" onClick={onClick}>{action}</button></div></Localize>; }
function Empty({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) { return <Localize><div className="empty-state"><span>＋</span><h3>{title}</h3><p>{detail}</p><button className="quiet-link" onClick={onClick}>{action} ↗</button></div></Localize>; }
function Note({ text }: { text: string }) { return <Localize><div className="note-strip"><span>i</span><p>{text}</p></div></Localize>; }

function DataDialog({ kind, farms, farmers, plots, seasons, recommendations, selectedOutcomeSeasonId, initialFarmId, farmerRecord, onClose, onFarmer, onFarm, onPlot, onSeason, onReading, onOutcome }: { kind: Exclude<Modal, null>; farms: Farm[]; farmers: Farmer[]; plots: Plot[]; seasons: Season[]; recommendations: SavedRecommendation[]; selectedOutcomeSeasonId: string; initialFarmId: string; farmerRecord: Farmer | null; onClose: () => void; onFarm: (event: FormEvent<HTMLFormElement>) => void; onFarmer: (event: FormEvent<HTMLFormElement>) => void; onPlot: (event: FormEvent<HTMLFormElement>) => void; onSeason: (event: FormEvent<HTMLFormElement>) => void; onReading: (event: FormEvent<HTMLFormElement>) => void; onOutcome: (event: FormEvent<HTMLFormElement>) => void }) {
  const [selectedFarm, setSelectedFarm] = useState(initialFarmId);
  const [outcomeSeasonId, setOutcomeSeasonId] = useState(selectedOutcomeSeasonId);
  const [preferredCropSelections, setPreferredCropSelections] = useState<string[]>([]);
  const title = kind === "farmer" ? farmerRecord ? "Edit farmer" : "Register a farmer" : kind === "farm" ? "Add a farm" : kind === "plot" ? "Add a plot" : kind === "season" ? "Start a season" : kind === "outcome" ? "Record season outcome" : "Record soil reading";
  return <Localize><div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="data-dialog" role="dialog" aria-modal="true" aria-labelledby="data-title"><div className="dialog-head"><div><div className="section-kicker">AGROGAUGE · FIELD RECORD</div><h2 id="data-title">{title}</h2></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div>
    {kind === "farmer" && <form className="data-form" onSubmit={onFarmer}>{farmerRecord && <div className="history-hint">Permanent Farmer ID: {farmerRecord.id}</div>}<label>Farmer name<input name="name" defaultValue={farmerRecord?.name} placeholder="Full name" required autoFocus/></label><div className="form-grid"><label>Phone number<input name="phone" type="tel" defaultValue={farmerRecord?.phone} placeholder="+234 …" required/></label><label>Location<input name="location" defaultValue={farmerRecord?.location} placeholder="Town / LGA" required/></label></div><label>Farming method<select name="farming" defaultValue={farmerRecord?.farming ?? "Mono-cropping"}><option>Mono-cropping</option><option>Mixed farming</option><option>Not recorded</option></select></label>{!farmerRecord && <div className="history-hint">A permanent AGR-F ID will be assigned when this record is saved.</div>}<Actions onClose={onClose}/></form>}
    {kind === "farm" && <form className="data-form" onSubmit={onFarm}><label>Farm name<input name="name" placeholder="e.g. Green Valley Farm" required autoFocus/></label><label>Owner<select name="ownerId" required defaultValue={farmers[0]?.id ?? ""}>{farmers.map((farmer) => <option key={farmer.id} value={farmer.id}>{farmer.name} · {farmer.id}</option>)}</select></label><label>Location<input name="location" placeholder="Town or local government area" required/></label><label>Farm area (hectares)<input name="area" type="number" min="0.1" step="0.1" required/></label><div className="history-hint">Add fields / plots to this farm after saving, only if you need to track separate areas.</div><Actions onClose={onClose}/></form>}
    {kind === "plot" && <form className="data-form" onSubmit={onPlot}><label>Farm<select name="farm" required value={selectedFarm} onChange={(event) => setSelectedFarm(event.target.value)}><option value="" disabled>Select a farm</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label><label>Field / plot name<input name="name" placeholder="e.g. North Field" required autoFocus/></label><div className="form-grid"><label>Area (hectares)<input name="area" type="number" min="0.1" step="0.1" required/></label><label>Location<input name="location" placeholder="Optional locality"/></label></div><div className="form-grid"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="0.000001" placeholder="Optional"/></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="0.000001" placeholder="Optional"/></label></div><Actions onClose={onClose}/></form>}
    {kind === "season" && <form className="data-form" onSubmit={onSeason}><label>Farm<select name="farm" required value={selectedFarm} onChange={(event) => setSelectedFarm(event.target.value)}><option value="">Select a farm</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label><label>Plot<select name="plotId" required defaultValue=""><option value="">Select a registered plot</option>{plots.filter((plot) => plot.farmId === selectedFarm).map((plot) => <option key={plot.id} value={plot.id}>{plot.name} · {plot.area} ha</option>)}</select></label><div className="form-grid"><label>Season name<input name="name" placeholder="e.g. 2026 wet season" required/></label><label>Farming method<select name="method"><option value="Mono-cropping">Mono-cropping</option><option value="Mixed farming">Mixed farming</option></select></label></div><div className="form-grid"><label>Preferred method<select name="preferredMethod"><option value="Mono-cropping">Mono-cropping</option><option value="Mixed farming">Mixed farming</option></select></label><label>Previous season<input name="previousSeason" placeholder="e.g. maize, beans or groundnut"/><small>For new users, type the crop(s) planted last season. If left blank, recent field history is used automatically for returning users.</small></label></div><CropListField name="preferredCrops" label="List of crops" hint="Select the crop(s) to prioritise for this season." selectedCrops={preferredCropSelections} onSelectionChange={setPreferredCropSelections}/><div className="crop-list-field"><div className="crop-list-header"><strong>Marketable crops</strong><small>Automatically includes the crops selected above.</small></div><div className="marketable-crop-summary" aria-live="polite">{preferredCropSelections.length ? preferredCropSelections.map((crop) => <span className="marketable-crop-chip" key={crop}>{crop}</span>) : <span className="marketable-crop-empty">Select crops above to add them here.</span>}</div></div><div className="history-hint">↗ {seasons.length} prior season records will remain available as history.</div><Actions onClose={onClose}/></form>}
    {kind === "reading" && <form className="data-form" onSubmit={onReading}><input type="hidden" name="idempotencyKey"/><label>Farm<select value={selectedFarm} onChange={(event) => setSelectedFarm(event.target.value)} required><option value="">Select a farm</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label><label>Plot<select name="plotId" required defaultValue=""><option value="">Select a registered plot</option>{plots.filter((plot) => plot.farmId === selectedFarm).map((plot) => <option key={plot.id} value={plot.id}>{plot.name} · {plot.area} ha</option>)}</select></label><label>Season<select name="seasonId" required defaultValue=""><option value="">Select the plot season</option>{seasons.filter((season) => season.farmId === selectedFarm && season.status !== "Completed").map((season) => <option key={season.id} value={season.id}>{season.name} · {season.plot}</option>)}</select></label><div className="form-grid"><label>Nitrogen (ppm)<input name="nitrogen" type="number" min="0" step="0.1" required/></label><label>Phosphorus (ppm)<input name="phosphorus" type="number" min="0" step="0.1" required/></label></div><div className="form-grid"><label>Potassium (ppm)<input name="potassium" type="number" min="0" step="0.1" required/></label><label>Soil temperature (°C)<input name="soilTemperature" type="number" min="-50" max="100" step="0.1" required/></label></div><label>Humidity (%)<input name="humidity" type="number" min="0" max="100" step="0.1" required/></label><label>Device ID (optional)<input name="deviceId" placeholder="Device code"/></label><div className="history-hint">Record all five sensor readings. NPK values use ppm; temperature uses °C; humidity uses percent. Offline readings retain their stable ID and timestamp.</div><Actions onClose={onClose}/></form>}
    {kind === "outcome" && <form className="data-form" onSubmit={onOutcome}><label>Season<select name="seasonId" value={outcomeSeasonId} onChange={(event) => setOutcomeSeasonId(event.target.value)} required><option value="">Select a season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.farm} · {season.plot} · {season.name}</option>)}</select></label><label>Recommendation (optional)<select name="recommendationId" defaultValue=""><option value="">Not linked to a recommendation</option>{recommendations.filter((recommendation) => recommendation.seasonId === outcomeSeasonId).map((recommendation) => <option key={recommendation.id} value={recommendation.id}>Version {recommendation.version} · {new Date(recommendation.createdAt).toLocaleDateString()}</option>)}</select></label><CropListField name="actualCrops" label="Actual crops planted" hint="Select all crops planted during this season." required/><div className="form-grid"><label>Yield quantity (optional)<input name="yieldQuantity" type="number" min="0" step="0.001"/></label><label>Yield unit<input name="yieldUnit" maxLength={40} placeholder="e.g. kg"/></label></div><label>Outcome notes (optional)<textarea name="notes" rows={3} maxLength={10000} placeholder="What happened during this season?"/></label><label>Recommendation rating (optional)<select name="rating" defaultValue=""><option value="">No rating</option><option value="1">1 · Not useful</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · Very useful</option></select></label><label>Feedback comment (optional)<textarea name="comment" rows={3} maxLength={10000} placeholder="Share feedback on the recommendation"/></label><div className="history-hint">Actual crops are saved to this season’s crop history for future planning.</div><Actions onClose={onClose}/></form>}
  </section></div></Localize>;
}
function Actions({ onClose }: { onClose: () => void }) { return <div className="dialog-actions"><button type="button" className="button button-cancel" onClick={onClose}>Cancel</button><button className="button button-dark">Save record <span>↗</span></button></div>; }
function Toast({ children }: { children: string }) { return <div className="toast" role="status"><span>✓</span>{children}</div>; }