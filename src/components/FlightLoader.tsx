interface FlightLoaderProps {
  label?: string;
  fullscreen?: boolean;
  overlay?: boolean;
}

/** Suit le vrai chargement, sans délai artificiel ni pourcentage simulé. */
export function FlightLoader({ label = "Chargement de votre espace…", fullscreen = false, overlay = false }: FlightLoaderProps) {
  return (
    <div className={`shena-loading${fullscreen ? " shena-loading-fullscreen" : ""}${overlay ? " shena-loading-overlay" : ""}`} role="status" aria-live="polite" aria-busy="true">
      <div className="shena-loading-brand"><img src="/favicon.svg" alt="" width="54" height="54" /><span>SHENA <em>Express</em></span></div>
      <img className="shena-loading-route" src="/loading-route.svg" alt="Miami → République dominicaine → Haïti" width="360" height="165" />
      <p className="shena-loading-label">{label}</p>
    </div>
  );
}
