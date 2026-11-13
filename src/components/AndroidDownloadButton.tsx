import { Capacitor } from "@capacitor/core";
import { Download } from "lucide-react";

/** Téléchargement du fichier local : aucun compte Drive ni redirection requise. */
export function AndroidDownloadButton({ className = "" }: { className?: string }) {
  if (Capacitor.isNativePlatform()) return null;
  return (
    <a className={`android-download ${className}`} href="/downloads/SHENA-Express-1.1.apk" download="SHENA-Express-1.1.apk">
      <Download size={22} aria-hidden="true" />
      <span><strong>Télécharger l’application Android</strong><small>Version 1.1 · APK · 6,3 Mo</small></span>
    </a>
  );
}
