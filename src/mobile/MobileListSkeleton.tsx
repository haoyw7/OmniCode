/** Reuse the real row layout so the first response keeps its loading geometry. */
export function MobileListSkeleton({
  kind,
  label,
  rows = 5,
}: {
  kind: "projects" | "sessions";
  label: string;
  rows?: number;
}) {
  const projects = kind === "projects";
  const pauseOffscreen = usePauseOffscreenAnimation<HTMLDivElement>();
  return (
    <div ref={pauseOffscreen} className="mobile-list-skeleton" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className={projects ? "mobile-home-project" : "mobile-home-session"}
          >
            <span className="mobile-skeleton-bar mobile-skeleton-icon" />
            {projects ? (
              <span className="mobile-skeleton-project-text">
                <strong><span className="mobile-skeleton-bar">&nbsp;</span></strong>
                <small><span className="mobile-skeleton-bar">&nbsp;</span></small>
              </span>
            ) : (
              <>
                <strong><span className="mobile-skeleton-bar">&nbsp;</span></strong>
                <time><span className="mobile-skeleton-bar mobile-skeleton-age">&nbsp;</span></time>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
import { usePauseOffscreenAnimation } from "../shared/hooks/usePauseOffscreenAnimation";
