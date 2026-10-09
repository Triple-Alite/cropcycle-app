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

The schema is in `prisma/schema.prisma`; `registerFarmer` in `src/lib/farmers.ts` allocates the permanent farmer code in the same database transaction that creates the farmer.

## Included in this prototype

- Public landing page and sign-up, login and password-reset interaction screens.
- Role selection for Admin, Field Agent, Crop Scientist, Farm Manager and Farmer.
- Farmer registration, search and editing with stable AGR-F identifiers.
- Farm ownership, generated plot records, plot locations and optional GPS coordinates.
- Workspace overview for farmers, farms, plots, active seasons and soil readings.
- Add-farm, add-plot, start-season and record-reading flows linked to registered records.
- Previous/intended crops, crops available, market crops and mono-cropping/mixed-farming fields.
- Soil readings for nitrogen, phosphorus, potassium (ppm), soil temperature (°C) and humidity (%).
- Server-backed, versioned recommendation history with scientist review and sharing.
- Outcome capture for actual planted crops, optional yield, notes and recommendation feedback; actual crops carry into later seasons.
- A browser-local, stable-ID soil-reading queue with batch sync, duplicate detection and visible conflicts for manual resolution.
- Source-cited agricultural knowledge with approval lifecycle; recommendations use only approved rules.
- Responsive layouts, reduced-motion support and English-first UI.

## Prototype boundaries

Production deployment still requires environment-specific security review, database backup/operations, email delivery configuration, and end-to-end validation against the target PostgreSQL instance. Offline readings are held in browser localStorage until batch sync succeeds; conflicting IDs are retained for a user to retry or discard. Agricultural recommendations remain constrained to approved, cited knowledge and require scientist review before sharing.

Apply the Prisma schema before exercising database-backed workflows. Run migrations and validate signup/login, farm and season access controls, outcome capture, recommendation history, and reading synchronization against the configured PostgreSQL database. The browser queue is device-local and is not a substitute for server backup.

The soil reading API and Crop Scientist rule criteria use the same five parameters: nitrogen, phosphorus and potassium in ppm; soil temperature in °C; and humidity in percent. The UI uses Montserrat with the primary brand colors `#CCF863`, `#00410B` and `#FFFFFF`.

## Architecture direction

Keep agricultural knowledge separate from recommendation orchestration and AI-provider adapters. Persist farmer, farm, plot, season, crop history, requirements, soil-reading, device, recommendation, outcome and feedback records with explicit ownership relationships. Keep localization strings outside workflow logic when adding Hausa, Yoruba and Igbo.
