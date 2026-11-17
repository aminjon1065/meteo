<#
  Отправка выпусков редактора SmartMet Alert с рабочей станции синоптика (Windows) на сервер портала
  (runbook §14.5). Сторонние программы не нужны: используется встроенный в Windows 10/11 клиент OpenSSH.

  Редактор пишет выпуски в локальный каталог (repositoryOutputFolder в conf\application-configuration.xml,
  обычно C:\smartalert). Скрипт находит новые каталоги publishedCap\<год>\<месяц>\<YYYYMMDDHHmmss> и
  отправляет их по SFTP пользователем smartalert. Каталог сначала загружается в /<лента>/.incoming/<метка>,
  потом одним переименованием переносится в publishedCap: лента capfeed.php не видит полузагруженный выпуск
  (иначе портал на минуту снял бы предупреждения, которых ещё нет в каталоге).

  Один раз:
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\smartmet\sync-smartalert.ps1
  Постоянно (при входе в Windows, см. runbook §14.5 - задание в Планировщике):
    powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\smartmet\sync-smartalert.ps1 -Loop

  Параметры: -Feed smartalert-test - пробные выпуски уходят в тестовую ленту staging, а не на havo.tj.
  Журнал - <Local>\sync-<лента>.log, список отправленных выпусков - <Local>\.sent-<лента>.txt.
#>
param(
  [string]$Local = "C:\smartalert",
  [ValidateSet("smartalert", "smartalert-test")]
  [string]$Feed = "smartalert",
  [string]$Server = "46.202.155.70",
  [string]$Key = "$env:USERPROFILE\.ssh\smartalert_ed25519",
  [int]$SettleSeconds = 15,
  [int]$IntervalSeconds = 30,
  [switch]$Loop
)

# Не Stop: в Windows PowerShell 5.1 строка stderr внешней программы при 2>&1 стала бы исключением.
# Строки в коде - только ASCII: без BOM Windows PowerShell 5.1 читает файл в кодировке ANSI, и байты
# кириллицы UTF-8 превращаются в кавычки (‚ „), ломая разбор. Комментарии на это не влияют.
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path $Local | Out-Null
$capRoot = Join-Path $Local "publishedCap"
$stateFile = Join-Path $Local ".sent-$Feed.txt"
$logFile = Join-Path $Local "sync-$Feed.log"
$sftp = Join-Path $env:WINDIR "System32\OpenSSH\sftp.exe"
if (-not (Test-Path $sftp)) { $sftp = "sftp.exe" }

function Write-Log([string]$Message) {
  $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-Releases {
  if (-not (Test-Path $capRoot)) { return @() }
  Get-ChildItem $capRoot -Directory | Where-Object { $_.Name -match '^\d{4}$' } | ForEach-Object {
    Get-ChildItem $_.FullName -Directory | Where-Object { $_.Name -match '^\d{2}$' } | ForEach-Object {
      Get-ChildItem $_.FullName -Directory | Where-Object { $_.Name -match '^\d{14}$' }
    }
  } | Sort-Object Name
}

function Send-Release($Dir) {
  $year = $Dir.Parent.Parent.Name
  $month = $Dir.Parent.Name
  $stamp = $Dir.Name
  $files = @(Get-ChildItem $Dir.FullName -File)
  $tmp = "/$Feed/.incoming/$stamp"
  $dst = "/$Feed/publishedCap/$year/$month/$stamp"

  # Строки с «-» в начале не прерывают пакет при ошибке (каталог уже есть, временного ещё нет).
  $lines = @(
    "-mkdir /$Feed/.incoming",
    "-mkdir /$Feed/publishedCap",
    "-mkdir /$Feed/publishedCap/$year",
    "-mkdir /$Feed/publishedCap/$year/$month",
    "-rm $tmp/*",
    "-rmdir $tmp",
    "mkdir $tmp"
  )
  foreach ($f in $files) {
    $src = $f.FullName -replace '\\', '/'
    $lines += "put `"$src`" `"$tmp/$($f.Name)`""
  }
  # Если выпуск уже на сервере (список отправленных потерян), rename не пройдёт, а ls подтвердит выпуск.
  $lines += "-rename $tmp $dst"
  $lines += "ls $dst"

  $batch = Join-Path $env:TEMP "smartalert-$Feed-$stamp.sftp"
  Set-Content -Path $batch -Value $lines -Encoding ASCII
  $out = & $sftp -b $batch -i $Key -o BatchMode=yes -o StrictHostKeyChecking=accept-new `
    -o ConnectTimeout=20 "smartalert@$Server" 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item $batch -ErrorAction SilentlyContinue
  if ($code -eq 0) {
    Add-Content -Path $stateFile -Value "$year/$month/$stamp" -Encoding ASCII
    Write-Log "sent release $year/$month/$stamp ($($files.Count) files) to feed $Feed"
    return $true
  }
  Write-Log "FAILED to send $year/$month/${stamp}: $($out.Trim())"
  return $false
}

function Sync-Once {
  $sent = @{}
  if (Test-Path $stateFile) { Get-Content $stateFile | ForEach-Object { $sent[$_] = $true } }
  $now = Get-Date
  foreach ($dir in Get-Releases) {
    $id = "$($dir.Parent.Parent.Name)/$($dir.Parent.Name)/$($dir.Name)"
    if ($sent.ContainsKey($id)) { continue }
    # Редактор ещё пишет файлы выпуска - подождать следующего круга.
    $newest = (@(Get-ChildItem $dir.FullName -File) | Measure-Object LastWriteTime -Maximum).Maximum
    if (($now - $dir.LastWriteTime).TotalSeconds -lt $SettleSeconds) { break }
    if ($newest -and ($now - $newest).TotalSeconds -lt $SettleSeconds) { break }
    # Выпуски уходят по порядку: при ошибке (нет сети) следующий не обгоняет предыдущий.
    if (-not (Send-Release $dir)) { break }
  }
}

if (-not (Test-Path $Key)) {
  Write-Log "no SSH key $Key (create it: ssh-keygen -t ed25519 -f $Key)"
  exit 1
}
if ($Loop) {
  Write-Log "start: $Local -> smartalert@${Server}:/$Feed every $IntervalSeconds s"
  while ($true) {
    Sync-Once
    Start-Sleep -Seconds $IntervalSeconds
  }
} else {
  Sync-Once
}
