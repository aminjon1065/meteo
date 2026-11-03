<?php
// CAP-лента SmartAlert для портала: копия capfeed.php из fmidev/smartmetalert:26.10.21 с правками
// (README образа разрешает настраивать capfeed.php). Монтируется поверх файла образа.
// Отличия от оригинала:
//  1. В ленту попадают и файлы *_CANCEL_* — иначе отмена не доходит до потребителей ленты.
//  2. Сообщение без <info> (Cancel) и info без <expires> не считаются истёкшими; истёкшим считается
//     сообщение, у которого истекли все info (у оригинала — только первый).
//  3. Битый XML пропускается с записью в журнал, а не роняет всю ленту в HTTP 500.
// Как и в оригинале, берётся только последний выпуск редактора (лексикографически наибольший каталог):
// это полный список действующих предупреждений, пропавшее из выпуска предупреждение снято.
// Портал сверяет ленту с базой (reconcileCapFeed) и снимает такие предупреждения с публикации.

$SUBDIRS = [];
$basePath = __DIR__ . "/data";
$directCap = "$basePath/publishedCap";

if (is_dir($directCap)) {
    $SUBDIRS[] = "";
} elseif (is_dir($basePath)) {
    foreach (scandir($basePath) as $d) {
        if ($d === "." || $d === "..") continue;
        if (is_dir("$basePath/$d/publishedCap")) {
            $SUBDIRS[] = $d;
        }
    }
}

$atom = "";
$updated = "";
$senderName = "Default Sender";

$is_https = (
    (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
    || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443)
    || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
);

$protocol = $is_https ? 'https' : 'http';

if (isset($_SERVER['HTTP_HOST'])) {
    $host = $_SERVER['HTTP_HOST'];
} elseif (isset($_SERVER['SERVER_NAME'])) {
    $host = $_SERVER['SERVER_NAME'];
} else {
    $host = 'localhost';
}

$script_name = isset($_SERVER['PHP_SELF']) ? $_SERVER['PHP_SELF'] : '';
$dir = rtrim(str_replace('\\', '/', dirname($script_name)), '/');
$address = $protocol . "://" . $host . $dir . "/";

$capfeed = $protocol . "://" . $host . $script_name;

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

function esc($value) {
    return htmlspecialchars((string) $value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

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

foreach ($SUBDIRS as $subdir) {
    $relRoot = $subdir === "" ? "data/publishedCap" : "data/$subdir/publishedCap";
    $absDir = findLatestCapDir(__DIR__ . "/" . $relRoot);
    if ($absDir === null) continue;

    $relDir = substr($absDir, strlen(__DIR__) + 1);

    $FILES = scandir($absDir);
    foreach ($FILES as $file) {
        if (!preg_match("/_(ALERT|UPDATE|CANCEL)_/", $file)) continue;
        $content = @file_get_contents($absDir . "/" . $file);
        $xml = $content === false ? false : simplexml_load_string($content);
        if ($xml === false) {
            error_log("capfeed: пропущен файл, XML не разбирается: $relDir/$file");
            libxml_clear_errors();
            continue;
        }
        if (capIsExpired($xml)) continue;

        $hasInfo = isset($xml->info) && count($xml->info) > 0;
        $info = $hasInfo ? $xml->info[0] : null;
        $msgType = (string) $xml->msgType;
        if ($info !== null && (string) $info->senderName !== "") {
            $senderName = (string) $info->senderName;
        } elseif ((string) $xml->sender !== "" && $senderName === "Default Sender") {
            $senderName = (string) $xml->sender;
        }

        if ($info !== null) {
            $onset = (string) $info->onset !== "" ? (string) $info->onset : (string) $xml->sent;
            $expires = (string) $info->expires;
            $title = esc($info->event) . " for " . esc($info->area->areaDesc)
                . " issued " . esc(date('F j \a\t g:i A T', strtotime($onset)))
                . ($expires !== "" ? " until " . esc(date('F j \a\t g:i A T', strtotime($expires))) : "");
            if ($msgType === "Cancel") $title = "Cancel: " . $title;
            $summary = esc($info->description);
        } else {
            $title = esc($msgType) . ": " . esc($xml->identifier);
            $summary = esc($xml->note);
        }

        $entryUrl = esc($address . $relDir . "/" . $file);
        $atom .= "<entry>\n";
        $atom .= "<id>" . $entryUrl . "</id>\n";
        $atom .= "<title>" . $title . " </title>\n";
        $atom .= "<summary>" . $summary . "</summary>\n";
        if ($info !== null) {
            $atom .= "<cap:effective>" . esc($info->effective) . "</cap:effective>\n";
            $atom .= "<cap:expires>" . esc($info->expires) . "</cap:expires>\n";
        }
        $atom .= "<cap:msgType>" . esc($msgType) . "</cap:msgType>\n";
        $atom .= "<updated>" . esc($xml->sent) . "</updated>\n";
        $updated = date("c", filemtime($absDir . "/" . $file));
        $atom .= '<link rel="related" type="application/cap+xml" href="' . $entryUrl . '"/>' . "\n";
        $atom .= "</entry>\n";
    }
}

$senderNameEsc = esc($senderName);
$capfeedEsc = esc($capfeed);

if ($atom === "") {
    $updated = date("c", time());
    $atom = <<<EOT
<entry>
<id>$capfeedEsc</id>
<updated>$updated</updated>
<author>
<name>$senderNameEsc</name>
</author>
<title>There are no active watches, warnings or advisories</title>
<link href="$capfeedEsc"/>
<summary>There are no active watches, warnings or advisories</summary>
</entry>
EOT;
}

header("Content-type: application/xml");
echo <<<EOT
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?xml-stylesheet href="capatom.xsl" type="text/xsl"?>
<!--
  This atom/xml feed is an index to active advisories, watches and warnings
  issued by the $senderNameEsc. This index file
  is not the complete Common Alerting Protocol (CAP) alert message. To obtain
  the complete CAP alert, please follow the links for each entry in this index.
  Not all information in the CAP message is contained in this index of active
  alerts.
-->

<feed
  xmlns="http://www.w3.org/2005/Atom"
  xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"
  xmlns:ha="http://www.alerting.net/namespace/index_1.0">

  <link href="$capfeedEsc" rel="self"/>
  <rights> Copyright, $senderNameEsc. Licensed under CC BY 4.0 </rights>
  <id>$capfeedEsc</id>
  <generator>$senderNameEsc</generator>
  <updated>$updated</updated>
  <author>
     <name>$senderNameEsc</name>
  </author>
  <title>Current Watches, Warnings and Advisories Issued by $senderNameEsc</title>
$atom
</feed>
EOT;
?>
