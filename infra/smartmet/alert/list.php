<?php
// Список CAP-файлов для веб-карты SmartAlert: копия list.php из fmidev/smartmetalert:26.10.21 с правкой
// (монтируется поверх файла образа, как capfeed.php). Отличие от оригинала: истёкшие сообщения не попадают
// в список - иначе карта показывает предупреждения последнего выпуска и после их срока, пока синоптик не
// опубликует новый выпуск, а портал и CAP-лента (capfeed.php) их уже сняли. Правило то же, что в capfeed.php:
// сообщение истекло, когда истекли все его info; без info или без expires - действует; битый XML - пропускается.

// Сообщение действует, пока не истекли все его info; без info (Cancel) или без expires — действует.
function capIsExpired($xml) {
  if (!isset($xml->info) || count($xml->info) === 0) return false;
  foreach ($xml->info as $info) {
    $expires = trim((string) $info->expires);
    if ($expires === "") return false;
    $ts = strtotime($expires);
    if ($ts === false || time() <= $ts) return false;
  }
  return true;
}

libxml_use_internal_errors(true);


$capfiles = [];
$basePath = __DIR__ . "/data";

$DIRS = filter_input(INPUT_GET, 'dir');

if (!$DIRS) {
  $SUBDIRS = [];
  if (is_dir("$basePath/publishedCap")) {
    // If "data/publishedCap" exists, just use that
    $SUBDIRS[] = "";
  } else {
    // Otherwise, auto-discover subdirectories under "data/" containing "publishedCap"
    foreach (scandir($basePath) as $d) {
      if ($d === "." || $d === "..") continue;
      if (is_dir("$basePath/$d/publishedCap")) {
        $SUBDIRS[] = $d;
      }
    }
  }
} else {
  // Validate user-supplied dir against a strict whitelist (prevents path traversal)
  $SUBDIRS = [];
  foreach (explode(',', $DIRS) as $d) {
    $d = trim($d);
    if ($d === "" || !preg_match('/^[A-Za-z0-9_-]+$/', $d)) continue;
    if (!is_dir("$basePath/$d/publishedCap")) continue;
    $SUBDIRS[] = $d;
  }
}

function findLatestCapDir($root) {
  if (!is_dir($root)) return null;
  $latest = $root;
  $it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::SELF_FIRST
  );
  foreach ($it as $fileInfo) {
    if ($fileInfo->isDir()) {
      $path = $fileInfo->getPathname();
      if (strcmp($path, $latest) > 0) $latest = $path;
    }
  }
  return $latest;
}

foreach ($SUBDIRS as $DIR) {
  $relRoot = $DIR === "" ? "data/publishedCap" : "data/$DIR/publishedCap";
  $absLatest = findLatestCapDir(__DIR__ . "/" . $relRoot);
  if ($absLatest === null) continue;

  // Keep the response paths relative to the document root, but do all
  // filesystem reads against the absolute path (independent of the PHP CWD).
  $relLatest = substr($absLatest, strlen(__DIR__) + 1);

  foreach (scandir($absLatest) as $file) {
    if (preg_match("/_ALERT_/", $file) || preg_match("/_UPDATE_/", $file)) {
      $content = @file_get_contents($absLatest . "/" . $file);
      $xml = $content === false ? false : simplexml_load_string($content);
      if ($xml === false) {
        error_log("list: пропущен файл, XML не разбирается: $relLatest/$file");
        libxml_clear_errors();
        continue;
      }
      if (capIsExpired($xml)) continue;
      $capfiles[] = $relLatest . "/" . $file;
    }
  }
}

header("Content-type: application/json");
header("Pragma: no-cache");
header("Cache-control: no-cache, must-revalidate");
header("Expires: Fri, 01 Jan 1990 00:00:00 GMT");
print json_encode($capfiles);
