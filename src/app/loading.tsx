import Image from "next/image";

export default function Loading() {
  return (
    <main className="app-loading" aria-label="Loading CropCycle">
      <div className="app-loading-content" role="status" aria-live="polite">
        <Image
          src="/cropcycle-logo-white.png"
          alt="CropCycle"
          width={386}
          height={111}
          className="app-loading-logo"
        />
        <span className="app-loading-indicator" aria-hidden="true" />
        <span className="app-loading-message">Preparing your growing season</span>
      </div>
    </main>
  );
}
