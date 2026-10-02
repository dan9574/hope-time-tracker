import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function detectLocale(): Locale {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
  },
  lng: detectLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
