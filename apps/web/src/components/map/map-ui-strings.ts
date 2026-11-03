import "server-only";
import { getTranslations } from "next-intl/server";

/**
 * Подписи встроенных элементов MapLibre (кнопки зума, геолокации, атрибуции, полноэкранного режима,
 * доступное имя холста) на языке страницы — опция `locale` карты. Без неё экранный диктор читал бы
 * их по‑английски («Zoom in», «Map») на таджикской и русской страницах.
 */
export async function loadMapUiStrings(): Promise<Record<string, string>> {
  const t = await getTranslations("map.controls");
  return {
    "Map.Title": t("mapTitle"),
    "NavigationControl.ZoomIn": t("zoomIn"),
    "NavigationControl.ZoomOut": t("zoomOut"),
    "NavigationControl.ResetBearing": t("resetBearing"),
    "GeolocateControl.FindMyLocation": t("findMyLocation"),
    "GeolocateControl.LocationNotAvailable": t("locationNotAvailable"),
    "AttributionControl.ToggleAttribution": t("toggleAttribution"),
    "FullscreenControl.Enter": t("fullscreenEnter"),
    "FullscreenControl.Exit": t("fullscreenExit"),
    "Popup.Close": t("popupClose"),
    "ScaleControl.Meters": t("meters"),
    "ScaleControl.Kilometers": t("kilometers"),
    "CooperativeGesturesHandler.WindowsHelpText": t("cooperativeWindows"),
    "CooperativeGesturesHandler.MacHelpText": t("cooperativeMac"),
    "CooperativeGesturesHandler.MobileHelpText": t("cooperativeMobile"),
  };
}
