#!/bin/sh
# SFTP для редактора SmartMet Alert (FR3.2): синоптик публикует CAP с рабочей станции Агентства в
# /smartmet/editor/smartalert (лента production) или /smartmet/editor/smartalert-test (лента staging).
# Samba из штатной установки FMI наружу не открываем — вместо неё SFTP по SSH сервера.
#
#   sudo sh setup-editor-sftp.sh --key-file /root/smartalert.pub [--from 203.0.113.10/32]
#
# Что делает (повторный запуск безопасен):
#   - пользователь smartalert без пароля и без оболочки (вход только по ключу);
#   - sshd: только internal-sftp с umask 0022, chroot в /smartmet/editor, без перенаправлений и pty;
#   - /smartmet/editor принадлежит root (требование ChrootDirectory), внутри: smartalert/ и
#     smartalert-test/ — запись пользователю smartalert, in/ — пользователю 101010 (контейнер data);
#   - файлы публикуются с правами 644: их читают alert-web (www-data) и бэкап.
# --from ограничивает адрес, с которого принимается ключ (статический IP Агентства), — рекомендуется.
# Проверка конфигурации sshd (sshd -t) — до перезагрузки службы; при ошибке файл откатывается.
set -eu

USER_NAME=smartalert
ROOT=/smartmet/editor
SMARTMET_UID=101010
DROPIN=/etc/ssh/sshd_config.d/60-smartalert-sftp.conf
KEYS_DIR=/etc/ssh/authorized_keys
KEY_FILE=
FROM=

while [ $# -gt 0 ]; do
  case "$1" in
    --key-file) KEY_FILE=$2; shift 2 ;;
    --from) FROM=$2; shift 2 ;;
    --root) ROOT=$2; shift 2 ;;
    *) echo "неизвестный параметр: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "запускать от root" >&2; exit 1; }
[ -n "$KEY_FILE" ] && [ -s "$KEY_FILE" ] || { echo "нужен --key-file с открытым ключом синоптика" >&2; exit 2; }
KEY=$(grep -E '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) ' "$KEY_FILE" | head -1)
[ -n "$KEY" ] || { echo "в $KEY_FILE нет открытого ключа OpenSSH" >&2; exit 2; }

# 1. Пользователь без оболочки и пароля.
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$ROOT" --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
fi
passwd -l "$USER_NAME" >/dev/null 2>&1 || true

# 2. Каталоги. Корень chroot и все каталоги над ним — root и без записи группе/прочим, иначе sshd
#    отказывает во входе («bad ownership or modes for chroot directory component»). Поэтому /smartmet
#    принадлежит root (контейнеры пишут только в подкаталоги data, logs, tmp, editor/in — они свои).
mkdir -p "$ROOT"
p=$ROOT
while [ "$p" != "/" ] && [ -n "$p" ]; do
  chown root:root "$p"
  chmod go-w "$p"
  p=$(dirname "$p")
done
chmod 755 "$ROOT"
for d in smartalert smartalert-test; do
  mkdir -p "$ROOT/$d"
  chown -R "$USER_NAME:$USER_NAME" "$ROOT/$d"
  chmod 755 "$ROOT/$d"
  # Уже лежащие файлы — читаемыми для alert-web и бэкапа.
  find "$ROOT/$d" -type d -exec chmod 755 {} + -o -type f -exec chmod 644 {} +
done
mkdir -p "$ROOT/in"
chown "$SMARTMET_UID:$SMARTMET_UID" "$ROOT/in"
chmod 755 "$ROOT/in"

# 3. Ключ: restrict — без pty и перенаправлений; from — только с адреса Агентства.
mkdir -p "$KEYS_DIR"
chmod 755 "$KEYS_DIR"
OPTS=restrict
[ -n "$FROM" ] && OPTS="from=\"$FROM\",restrict"
printf '%s %s\n' "$OPTS" "$KEY" > "$KEYS_DIR/$USER_NAME.tmp"
chmod 644 "$KEYS_DIR/$USER_NAME.tmp"
mv "$KEYS_DIR/$USER_NAME.tmp" "$KEYS_DIR/$USER_NAME"

# 4. sshd: блок Match только для этого пользователя (в отдельном файле, остальной вход не меняется).
BACKUP=
[ -f "$DROPIN" ] && { BACKUP="$DROPIN.bak"; cp -p "$DROPIN" "$BACKUP"; }
mkdir -p "$(dirname "$DROPIN")"
cat > "$DROPIN" <<EOF
# SFTP для редактора SmartMet Alert (infra/smartmet/sftp/setup-editor-sftp.sh). Не править вручную.
Match User $USER_NAME
    AuthorizedKeysFile $KEYS_DIR/%u
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    ChrootDirectory $ROOT
    ForceCommand internal-sftp -u 0022
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitTTY no
Match all
EOF
chmod 644 "$DROPIN"

if ! grep -Eqs '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config; then
  echo "в /etc/ssh/sshd_config нет Include /etc/ssh/sshd_config.d/*.conf — добавьте его в начало файла" >&2
  exit 1
fi
if ! sshd -t; then
  echo "sshd -t: ошибка конфигурации, откатываю $DROPIN" >&2
  if [ -n "$BACKUP" ]; then mv "$BACKUP" "$DROPIN"; else rm -f "$DROPIN"; fi
  exit 1
fi
rm -f "$BACKUP"

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ssh 2>/dev/null; then
  systemctl reload ssh
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet sshd 2>/dev/null; then
  systemctl reload sshd
else
  echo "перезагрузите sshd вручную (служба не найдена через systemctl)" >&2
fi

echo "готово: sftp $USER_NAME@<сервер> → /smartalert (production) и /smartalert-test (staging)"
