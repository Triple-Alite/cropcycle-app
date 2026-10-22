# CropCycle

A field-focused CropCycle MVP prototype built with Next.js, React and TypeScript.

## Run locally

```powershell
cd cropcycle-app
docker compose up -d
Copy-Item .env.example .env
npm install
npm run db:generate
npm run db:migrate -- --name init
npm run dev
```

Open http://localhost:3000. The Compose file starts PostgreSQL with a persistent local Docker volume. `.env.example` is for local development only; replace those credentials outside this environment.

## Database deployment

Set both `DATABASE_URL` and `DIRECT_URL` in `.env`. For local PostgreSQL, both can use the same local connection string. For Neon, use its pooled connection string for `DATABASE_URL` and its direct (unpooled) connection string for `DIRECT_URL`. Keep real connection strings in environment variables or ignored `.env` files; never commit them.

Before the first deployment, temporarily set the Neon URLs in your local `.env` and run `npm run db:deploy` to create the tables in Neon. Then set the same two values in Vercel under Project Settings → Environment Variables. Run `npm run db:deploy` again whenever you add a migration. `npm run db:generate` runs automatically after dependency installation.

The schema is in `prisma/schema.prisma`; `registerFarmer` in `src/lib/farmers.ts` allocates the permanent farmer code in the same database transaction that creates the farmer.

## Farmer profiles and profile photos

The signed-in avatar opens the profile workspace. Farmers can edit their name, bio, phone, location and farming method; upload a JPEG, PNG or WebP profile photo (up to 4 MB); manage email-notification, 12/24-hour display, and English/Yoruba/Hausa language preferences; change their password; and manage farms through the Farms workspace. Language changes apply to the application interface after saving; farmer-entered records and expert-authored recommendation content remain unchanged. Log out and account deactivation both require confirmation. Deactivation disables login and revokes sessions while retaining the farmer, farm and soil-history records.

Profile photos use Vercel Blob. Create or connect a Blob store in Vercel and make its `BLOB_READ_WRITE_TOKEN` available to the production deployment (and Preview if needed). Profile images are stored with public access so they can display in the avatar. Apply pending Prisma migrations with `npm run db:deploy` before deploying profile APIs. Email notification preferences are saved, but notification delivery must be configured separately.

## Included in this prototype

- Public landing page and sign-up, login and password-reset interaction screens.
- Role selection for Admin, Field Agent, Crop Scientist, Farm Manager and Farmer.
- Farmer registration, search and editing with stable AGR-F identifiers.
- Farm ownership with one Farms page; optional fields/plots are managed inside their farm and can have locations and GPS coordinates.
- Workspace overview for farmers, farms, active seasons and soil readings.
- Add-farm, add-field, start-season and record-reading flows linked to registered records.
- Farmer and field-agent service requests with farm-scoped visit status and schedule visibility; CropCycle administrators handle visit scheduling, staff assignment, device linkage, and operations notes.
- Admin-only device operations for registering service devices, recording ownership and firmware, assigning or releasing devices to farms and fields, and tracking active, inactive, maintenance, or retired status.
- Previous/intended crops, crops available, market crops and mono-cropping/mixed-farming fields.
- Farmer crop selections are limited to Yam, Maize, Beans, Guinea Corn, Rice, Groundnut, Soya Beans, Tomatoes, Pepper, Millet, Okro, Bambara nut, Cassava, Spinach, Hibiscus, Potatoes, Sheanut, Sesame, Sugarcane, Gardenegg and Onions; season, outcome and agricultural-knowledge APIs enforce this same list.
- Soil readings for nitrogen, phosphorus, potassium (ppm), soil temperature (°C) and humidity (%).
- Server-backed, versioned recommendation history with scientist review and sharing.
- Outcome capture for actual planted crops, optional yield, notes and recommendation feedback; actual crops carry into later seasons.
- A browser-local, stable-ID soil-reading queue with batch sync, duplicate detection and visible conflicts for manual resolution.
- Source-cited agricultural knowledge with approval lifecycle; recommendations use only approved rules.
- Responsive layouts, reduced-motion support and English-first UI.

## Prototype boundaries

Production deployment still requires environment-specific security review, database backup/operations, email delivery configuration, and end-to-end validation against the target PostgreSQL instance. Offline readings are held in browser localStorage until batch sync succeeds; conflicting IDs are retained for a user to retry or discard. Agricultural recommendations remain constrained to approved, cited knowledge and require scientist review before sharing.

Production password resets require `PASSWORD_RESET_EMAIL_ENDPOINT`, `PASSWORD_RESET_EMAIL_API_KEY`, and the public HTTPS base URL in `CROPCYCLE_APP_URL`. The email endpoint must accept a bearer-authenticated `POST` with the recipient, the `cropcycle-password-reset` template name, and a `resetUrl` in its template data. For account privacy, reset requests return the same generic response whether or not an account exists; email delivery failures are recorded in the server logs.

Apply the Prisma schema before exercising database-backed workflows. Vercel Production builds run `prisma migrate deploy` before building the app; Preview builds skip migrations. Other deployment targets must run `npm run db:deploy` against the intended database. Validate signup/login, farm and season access controls, outcome capture, recommendation history, and reading synchronization against the configured PostgreSQL database. The browser queue is device-local and is not a substitute for server backup.

## Importing soil readings from SheetDB

Create an API for the Google Sheet in the SheetDB dashboard and keep the API URL and any access token in server-only Vercel environment variables:

- `SHEETDB_API_URL`: the HTTPS SheetDB API URL, such as `https://sheetdb.io/api/v1/<api-id>`.
- `SHEETDB_NODE_ID`: the exact `Node_ID` value to import (currently `NODE_03`). Other device rows are ignored.
- `SHEETDB_API_TOKEN`: optional; set this if access-token authentication is enabled for the SheetDB API.
- `CRON_SECRET`: a long random secret used to authenticate Vercel's scheduled sync.

Never add the SheetDB URL or token to client-side code or share its credentials in chat. In **Device operations**, set `SHEETDB_NODE_ID` to the exact node you want imported and set that device's **SheetDB Node ID** to the same value. Assign the device to its farm and field. The importer ignores all other Node_ID rows, then matches the `Season` cell exactly to a season created for that field. It imports timestamps and N/P/K (mg/kg), moisture (%), temperature (°C), and humidity (%); latitude, longitude, altitude, and satellite count are retained as sensor metadata. Rows that cannot be mapped or have invalid values are skipped with reasons shown after a manual sync.

Once the variables and database migration are deployed, admins can select **Sync SheetDB** in Device operations. Vercel also runs the sync once daily at approximately 04:00 UTC; Vercel Hobby plans only support daily schedules, while higher plans can be configured for more frequent schedules. The sync is idempotent by Node ID and timestamp, so importing the same rows again does not create duplicate readings.

The soil reading API and Crop Scientist rule criteria use the same five parameters: nitrogen, phosphorus and potassium in ppm; soil temperature in °C; and humidity in percent. The UI uses Montserrat with the primary brand colors `#CCF863`, `#00410B` and `#FFFFFF`.

## Hardware soil-reading endpoint

The device firmware sends one JSON `POST` for each completed sensor reading to:

```text
https://<your-deployed-app-domain>/api/hardware/readings
```

Authenticate with the device-specific bearer key issued from the admin **Device operations** page:

```http
Authorization: Bearer <device-api-key>
Content-Type: application/json
```

Example JSON body:

```json
{
  "readingId": "soil-cc-0001-00000042",
  "recordedAt": "2026-10-16T05:10:00.000Z",
  "nitrogen": 42.5,
  "phosphorus": 18.2,
  "potassium": 105.7,
  "soilTemperature": 26.4,
  "humidity": 61.2
}
```

`readingId` must be unique and stable across retries. `recordedAt` is optional and must be an ISO 8601 timestamp if supplied. Nitrogen, phosphorus and potassium use ppm; soil temperature uses °C; humidity uses percent. The device must be active, have an API key, and be assigned to a farm field with an active or planned season. The server derives the farm, field, season and farmer from that assignment; firmware must not send those IDs.

Successful responses return HTTP `201` with `status: "accepted"`; an identical retry returns HTTP `200` with `status: "duplicate"`. Reusing a `readingId` with different values returns HTTP `409`. Device keys are shown only when issued or rotated; store them securely in device configuration, and use HTTPS for all transmissions. The signed-in application refreshes its workspace every 15 seconds so persisted hardware readings appear in the soil readings view.

## Architecture direction

Keep agricultural knowledge separate from recommendation orchestration and AI-provider adapters. Persist farmer, farm, plot, season, crop history, requirements, soil-reading, device, recommendation, outcome and feedback records with explicit ownership relationships. Keep localization strings outside workflow logic when adding Hausa, Yoruba and Igbo.

Service visits are farm-linked records: farmers and field agents can request and view visits for farms available in their workspace, while administrators control scheduling, staff assignments, device links, visit status and internal notes. Device registration and assignment are restricted to administrators and remain separate from farmer farm management.
