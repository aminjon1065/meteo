/**
 * Заголовки для ответов с «чужим» содержимым, которое браузер мог бы отрисовать в origin портала:
 * исходный XML CAP от внешнего редактора (SmartMet Alert). XML‑документ может содержать инструкцию
 * <?xml-stylesheet?> с XSLT, а XSLT — скрипты; `sandbox` без флагов и `default-src 'none'`
 * исключают выполнение скриптов и загрузку ресурсов, даже если браузер решит отрисовать документ.
 * Те же заголовки ставит Caddy и маршрут /uploads для файлов CMS.
 */
export const XML_DOWNLOAD_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
} as const;
