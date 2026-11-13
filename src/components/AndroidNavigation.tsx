import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';

/** Le bouton Retour Android suit la navigation React avant de quitter. */
export function AndroidNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let disposed = false;
    let listener: PluginListenerHandle | undefined;
    void App.addListener('backButton', () => {
      if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
      else void App.exitApp();
    }).then(handle => {
      if (disposed) void handle.remove();
      else listener = handle;
    });
    return () => { disposed = true; void listener?.remove(); };
  }, [navigate]);
  return null;
}
