import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb, firebaseState } from "@/lib/firebase";
import { statusLabel, type PublicSettingsDoc, type StatusCode } from "@shared/index";

const DEFAULT_SETTINGS: PublicSettingsDoc = {
  companyName: "SHENA Express",
  logoUrl: null,
  whatsappNumber: "50956125356",
  contactEmail: "shenyderj2000@gmail.com",
  address: null,
  serviceArea: null,
  currency: "USD",
  openingHours: null,
  serviceMessage: null,
  pickupInstructions: null,
  modules: { finance: true },
  statusLabels: {},
  disabledStatuses: [],
};

interface SettingsContextValue {
  settings: PublicSettingsDoc;
  loading: boolean;
  labelForStatus: (code: StatusCode) => string;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loading: false,
  labelForStatus: (c) => statusLabel(c),
});

export function SettingsProvider({
  children,
  staticSettings,
}: {
  children: ReactNode;
  staticSettings?: Partial<PublicSettingsDoc>;
}) {
  const [settings, setSettings] = useState<PublicSettingsDoc>({
    ...DEFAULT_SETTINGS,
    ...staticSettings,
  });
  const [loading, setLoading] = useState<boolean>(!staticSettings && firebaseState.mode !== "unconfigured");

  useEffect(() => {
    if (staticSettings || firebaseState.mode === "unconfigured") {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(getFirebaseDb(), "settings", "public"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<PublicSettingsDoc>;
          setSettings({
            ...DEFAULT_SETTINGS,
            ...data,
            whatsappNumber: data.whatsappNumber || DEFAULT_SETTINGS.whatsappNumber,
            contactEmail: data.contactEmail || DEFAULT_SETTINGS.contactEmail,
            modules: { finance: data.modules?.finance ?? true },
          });
        } else {
          setSettings(DEFAULT_SETTINGS);
        }
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const labelForStatus = (code: StatusCode) => statusLabel(code, settings.statusLabels);

  return (
    <SettingsContext.Provider value={{ settings, loading, labelForStatus }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
