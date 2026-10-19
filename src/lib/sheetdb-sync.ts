import { createHash } from "node:crypto";
import { Prisma, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SheetRow = Record<string, unknown>;
type Candidate = {
  rowNumber: number;
  key: string;
  deviceId: string;
  seasonId: string;
  reading: Prisma.SoilReadingCreateManyInput;
};

export type SheetDbSyncResult = {
  imported: number;
  duplicates: number;
  skipped: number;
  issues: string[];
  diagnostics: {
    rowCount: number;
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
};

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCell(row: SheetRow, aliases: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  for (const alias of aliases) {
    const value = normalized.get(normalizeHeader(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function stringCell(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function readingKey(nodeId: string, recordedAt: Date) {
  const digest = createHash("sha256").update(`${nodeId}\n${recordedAt.toISOString()}`).digest("hex");
  return `sheetdb:${digest}`;
}

function optionalNumber(row: SheetRow, aliases: string[]) {
  const value = getCell(row, aliases);
  return value === undefined ? null : parseNumber(value);
}

function sensorMetadata(row: SheetRow): Prisma.InputJsonObject {
  return {
    source: "sheetdb",
    latitude: optionalNumber(row, ["Latitude"]),
    longitude: optionalNumber(row, ["Longitude"]),
    altitudeMeters: optionalNumber(row, ["Altitude_m", "Altitude"]),
    satellites: stringCell(getCell(row, ["satellites"])) || null,
  };
}

function sameReading(
  existing: {
    deviceId: string | null;
    seasonId: string;
    nitrogen: Prisma.Decimal | null;
    phosphorus: Prisma.Decimal | null;
    potassium: Prisma.Decimal | null;
    moisture: Prisma.Decimal | null;
    soilTemperature: Prisma.Decimal | null;
    humidity: Prisma.Decimal | null;
  },
  candidate: Candidate,
) {
  const data = candidate.reading;
  return existing.deviceId === candidate.deviceId &&
    existing.seasonId === candidate.seasonId &&
    Number(existing.nitrogen) === data.nitrogen &&
    Number(existing.phosphorus) === data.phosphorus &&
    Number(existing.potassium) === data.potassium &&
    Number(existing.moisture) === data.moisture &&
    Number(existing.soilTemperature) === data.soilTemperature &&
    Number(existing.humidity) === data.humidity;
}

function sameCandidateValues(left: Candidate, right: Candidate) {
  return left.deviceId === right.deviceId &&
    left.seasonId === right.seasonId &&
    left.reading.nitrogen === right.reading.nitrogen &&
    left.reading.phosphorus === right.reading.phosphorus &&
    left.reading.potassium === right.reading.potassium &&
    left.reading.moisture === right.reading.moisture &&
    left.reading.soilTemperature === right.reading.soilTemperature &&
    left.reading.humidity === right.reading.humidity;
}

function compoundKey(...values: string[]) {
  return JSON.stringify(values);
}

export async function importSheetDbReadings(): Promise<SheetDbSyncResult> {
  const apiUrl = process.env.SHEETDB_API_URL?.trim();
  if (!apiUrl) throw new Error("SheetDB is not configured. Set the server-side SHEETDB_API_URL environment variable.");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error("SHEETDB_API_URL must be a valid absolute URL.");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
    throw new Error("SHEETDB_API_URL must use HTTPS and must not contain embedded credentials.");
  }

  const headers = new Headers({ Accept: "application/json" });
  const token = process.env.SHEETDB_API_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(parsedUrl, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new Error(`SheetDB returned HTTP ${response.status}. Check the API URL, access token, and SheetDB service status.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("SheetDB returned an unexpected response. Expected a JSON array of rows.");
  }
  if (payload.length > 10_000) {
    throw new Error("This SheetDB response exceeds the 10,000-row safety limit. Split the sheet before syncing.");
  }

  const rows = payload as SheetRow[];
  const result: SheetDbSyncResult = {
    imported: 0,
    duplicates: 0,
    skipped: 0,
    issues: [],
    diagnostics: {
      rowCount: rows.length,
      headers: rows[0] ? Object.keys(rows[0]).slice(0, 20).map((key) => key.slice(0, 80)) : [],
      firstRow: null,
      rowsWithNodeId: 0,
      rowsWithSeason: 0,
      rowsWithTimestamp: 0,
    },
  };
  const issue = (rowNumber: number, reason: string) => {
    result.skipped += 1;
    if (result.issues.length < 20) result.issues.push(`Row ${rowNumber}: ${reason}`);
  };
  const parsedRows = rows.map((row, index) => {
    const nodeIdCell = getCell(row, ["Node_ID", "Node ID"]);
    const seasonCell = getCell(row, ["Season"]);
    const timestampCell = getCell(row, ["TimeStamp", "Timestamp"]);
    const nodeId = stringCell(getCell(row, ["Node_ID", "Node ID"]));
    const seasonName = stringCell(getCell(row, ["Season"]));
    const recordedAt = parseTimestamp(timestampCell);
    const nitrogen = parseNumber(getCell(row, ["Nitrogen_mg_k", "Nitrogen_mg_kg", "Nitrogen"]));
    const phosphorus = parseNumber(getCell(row, ["Phosphorus_ m", "Phosphorus_mg", "Phosphorus_mg_kg", "Phosphorus"]));
    const potassium = parseNumber(getCell(row, ["Potassium_mg", "Potassium_mg_kg", "Potassium"]));
    const moisture = parseNumber(getCell(row, ["Moisture_%", "Moisture"]));
    const soilTemperature = parseNumber(getCell(row, ["Temperature_C", "Temperature"]));
    const humidity = parseNumber(getCell(row, ["Humidity_%", "Humidity"]));
    return {
      rowNumber: index + 2,
      row,
      nodeId,
      nodeIdPresent: stringCell(nodeIdCell).length > 0,
      seasonName,
      seasonPresent: stringCell(seasonCell).length > 0,
      timestampPresent: stringCell(timestampCell).length > 0,
      recordedAt,
      nitrogen,
      phosphorus,
      potassium,
      moisture,
      soilTemperature,
      humidity,
    };
  });
  const firstRow = parsedRows[0];
  if (firstRow) {
    result.diagnostics.firstRow = {
      nodeIdPresent: firstRow.nodeIdPresent,
      seasonPresent: firstRow.seasonPresent,
      timestampPresent: firstRow.timestampPresent,
      timestampValid: firstRow.recordedAt !== null,
    };
  }
  result.diagnostics.rowsWithNodeId = parsedRows.filter((row) => row.nodeIdPresent).length;
  result.diagnostics.rowsWithSeason = parsedRows.filter((row) => row.seasonPresent).length;
  result.diagnostics.rowsWithTimestamp = parsedRows.filter((row) => row.timestampPresent).length;

  const validRows = parsedRows.filter((row) => {
    if (!row.nodeIdPresent || !row.seasonPresent || !row.recordedAt) {
      const missing = [
        !row.nodeIdPresent ? "Node_ID" : "",
        !row.seasonPresent ? "Season" : "",
        !row.recordedAt ? (row.timestampPresent ? "valid TimeStamp" : "TimeStamp") : "",
      ].filter(Boolean);
      issue(row.rowNumber, `Missing or invalid ${missing.join(", ")}.`);
      return false;
    }
    if (
      row.nitrogen === null || row.nitrogen < 0 || row.nitrogen > 1_000_000 ||
      row.phosphorus === null || row.phosphorus < 0 || row.phosphorus > 1_000_000 ||
      row.potassium === null || row.potassium < 0 || row.potassium > 1_000_000 ||
      row.moisture === null || row.moisture < 0 || row.moisture > 100 ||
      row.soilTemperature === null || row.soilTemperature < -50 || row.soilTemperature > 100 ||
      row.humidity === null || row.humidity < 0 || row.humidity > 100
    ) {
      issue(row.rowNumber, "Sensor values are missing or out of range (N/P/K 0–1,000,000 mg/kg; moisture and humidity 0–100%; temperature -50–100 °C).");
      return false;
    }
    return true;
  });

  const nodeIds = [...new Set(validRows.map((row) => row.nodeId))];
  const devices = nodeIds.length
    ? await prisma.device.findMany({
        where: { externalNodeId: { in: nodeIds } },
        select: {
          id: true,
          externalNodeId: true,
          status: true,
          farmId: true,
          plotId: true,
          assignments: {
            where: { releasedAt: null },
            orderBy: { assignedAt: "desc" },
            take: 1,
            select: { farmId: true, plotId: true },
          },
        },
      })
    : [];
  const deviceByNodeId = new Map(devices.map((device) => [device.externalNodeId!, device]));
  const locations = devices.map((device) => {
    const assignment = device.assignments[0];
    return {
      device,
      farmId: assignment?.farmId ?? device.farmId,
      plotId: assignment?.plotId ?? device.plotId,
    };
  }).filter((location): location is typeof location & { farmId: string; plotId: string } =>
    Boolean(location.farmId && location.plotId));
  const farmIds = [...new Set(locations.map((location) => location.farmId))];
  const plotIds = [...new Set(locations.map((location) => location.plotId))];
  const plots = farmIds.length && plotIds.length
    ? await prisma.plot.findMany({
        where: { farmId: { in: farmIds }, id: { in: plotIds } },
        select: { id: true, farmId: true, farm: { select: { ownerFarmerId: true } } },
      })
    : [];
  const plotByLocation = new Map(plots.map((plot) => [compoundKey(plot.farmId, plot.id), plot]));
  const locationByNodeId = new Map(locations.map((location) => [location.device.externalNodeId!, location]));
  const candidateSeasonNames = [...new Set(validRows.map((row) => row.seasonName))];
  const seasons = farmIds.length && plotIds.length && candidateSeasonNames.length
    ? await prisma.season.findMany({
        where: { farmId: { in: farmIds }, plotId: { in: plotIds }, name: { in: candidateSeasonNames } },
        select: { id: true, farmId: true, plotId: true, name: true },
      })
    : [];
  const seasonByLocationAndName = new Map(
    seasons.map((season) => [compoundKey(season.farmId, season.plotId, season.name), season]),
  );

  const candidates: Candidate[] = [];
  for (const row of validRows) {
    const location = locationByNodeId.get(row.nodeId);
    if (!location) {
      const device = deviceByNodeId.get(row.nodeId);
      issue(row.rowNumber, device
        ? `Device "${row.nodeId}" must be assigned to a farm and field.`
        : `No CropCycle device is mapped to Node_ID "${row.nodeId}".`);
      continue;
    }
    if (location.device.status !== "ACTIVE") {
      issue(row.rowNumber, `Mapped device "${row.nodeId}" is not active.`);
      continue;
    }
    const plot = plotByLocation.get(compoundKey(location.farmId, location.plotId));
    if (!plot) {
      issue(row.rowNumber, `The assigned field for device "${row.nodeId}" was not found.`);
      continue;
    }
    const season = seasonByLocationAndName.get(compoundKey(location.farmId, location.plotId, row.seasonName));
    if (!season) {
      issue(row.rowNumber, `Season "${row.seasonName}" was not found for the device's assigned field.`);
      continue;
    }
    const key = readingKey(row.nodeId, row.recordedAt!);
    candidates.push({
      rowNumber: row.rowNumber,
      key,
      deviceId: location.device.id,
      seasonId: season.id,
      reading: {
        idempotencyKey: key,
        farmerId: plot.farm.ownerFarmerId,
        farmId: plot.farmId,
        plotId: plot.id,
        seasonId: season.id,
        deviceId: location.device.id,
        recordedAt: row.recordedAt!,
        nitrogen: row.nitrogen!,
        phosphorus: row.phosphorus!,
        potassium: row.potassium!,
        moisture: row.moisture!,
        soilTemperature: row.soilTemperature!,
        humidity: row.humidity!,
        sensorValues: sensorMetadata(row.row),
        syncStatus: SyncStatus.SYNCED,
        confirmedAt: new Date(),
      },
    });
  }

  const firstByKey = new Map<string, Candidate>();
  const uniqueCandidates: Candidate[] = [];
  for (const candidate of candidates) {
    const first = firstByKey.get(candidate.key);
    if (!first) {
      firstByKey.set(candidate.key, candidate);
      uniqueCandidates.push(candidate);
    } else if (sameCandidateValues(first, candidate)) {
      result.duplicates += 1;
    } else {
      issue(candidate.rowNumber, "Node_ID and TimeStamp identify another row with different sensor values.");
    }
  }

  for (let offset = 0; offset < uniqueCandidates.length; offset += 500) {
    const batch = uniqueCandidates.slice(offset, offset + 500);
    const existingReadings = await prisma.soilReading.findMany({
      where: { idempotencyKey: { in: batch.map((candidate) => candidate.key) } },
      select: {
        idempotencyKey: true,
        deviceId: true,
        seasonId: true,
        nitrogen: true,
        phosphorus: true,
        potassium: true,
        moisture: true,
        soilTemperature: true,
        humidity: true,
      },
    });
    const existingByKey = new Map(existingReadings.map((reading) => [reading.idempotencyKey, reading]));
    const toCreate: Candidate[] = [];
    for (const candidate of batch) {
      const existing = existingByKey.get(candidate.key);
      if (!existing) {
        toCreate.push(candidate);
      } else if (sameReading(existing, candidate)) {
        result.duplicates += 1;
      } else {
        issue(candidate.rowNumber, "Node_ID and TimeStamp already identify a different saved reading.");
      }
    }
    if (toCreate.length) {
      const created = await prisma.soilReading.createMany({
        data: toCreate.map((candidate) => candidate.reading),
        skipDuplicates: true,
      });
      result.imported += created.count;
      result.duplicates += toCreate.length - created.count;
    }
  }

  return result;
}
