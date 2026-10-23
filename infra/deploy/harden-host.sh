#!/bin/sh
# Базовое усиление хоста (docs/runbook.md §13.1). Запускает администратор сервера от root.
#   - SSH: вход только по ключам, root — только по ключу;
#   - fail2ban для sshd и автоматические обновления безопасности (unattended-upgrades).
# ПЕРЕД запуском проверьте, что вход по ключу работает, — иначе доступ будет потерян:
#   ssh -o PasswordAuthentication=no -o PreferredAuthentications=publickey root@<IP> true
# Межсетевой экран: Docker публикует порты в обход ufw, поэтому фильтровать лучше на уровне
# хостинга (Hostinger hPanel → VPS → Межсетевой экран: TCP 22, 80, 443 и UDP 443).
set -eu
[ "$(id -u)" -eq 0 ] || { echo "запускать от root" >&2; exit 1; }
if [ ! -s /root/.ssh/authorized_keys ]; then
  echo "в /root/.ssh/authorized_keys нет ключей — после отключения паролей вход станет невозможен" >&2
  exit 1
fi

# Файлы sshd_config.d читаются по алфавиту, действует первое значение: 10-… перекрывает
# 50-cloud-init.conf хостинга с PasswordAuthentication yes.
cat >/etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl restart ssh

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq fail2ban unattended-upgrades >/dev/null
systemctl enable --now fail2ban unattended-upgrades >/dev/null 2>&1

sshd -T | grep -E '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) '
fail2ban-client status sshd | sed -n '1,4p'
echo "готово"
