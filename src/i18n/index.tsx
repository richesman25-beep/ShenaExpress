import { createContext, useContext, useState, type ReactNode } from "react";
import { getMessages, LOCALE_NAMES, type Locale, type Messages } from "./messages";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
  locales: typeof LOCALE_NAMES;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "fr",
  setLocale: () => undefined,
  t: getMessages("fr"),
  locales: LOCALE_NAMES,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("fr");
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    if (typeof document !== "undefined") document.documentElement.lang = next;
  };
  return (
    <I18nContext.Provider value={{ locale, setLocale, t: getMessages(locale), locales: LOCALE_NAMES }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
