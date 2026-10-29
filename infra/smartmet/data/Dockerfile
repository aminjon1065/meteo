# Загрузка и конвертация данных моделей (GFS) штатными пакетами FMI.
# Повторяет шаги установщика fmidev/smartmet-install (репозиторий smartmet-open, CRB, EPEL без eccodes)
# на Rocky Linux 10, но без системных служб метапакета smartmet-base-international (Samba, PostgreSQL,
# Docker, firewalld) — на сервере портала они не нужны или уже есть на хосте.
FROM rockylinux/rockylinux:10

# Утилиты unixtools из smartmet-base-international (utcrun, cleaner, mkcron) — зафиксированный коммит.
ARG FMI_BASE_COMMIT=92131aed2d334562ff0823decb0f1826b424f014

# Пользователь smartmet с тем же uid, что у процесса SmartMet Server в образе fmidev/smartmetserver,
# чтобы файлы данных в общем томе читались без лишних прав. Создаётся до установки пакетов:
# файлы RPM принадлежат smartmet.
RUN groupadd -g 101010 smartmet \
 && useradd -u 101010 -g smartmet -d /smartmet -M -s /bin/bash smartmet

RUN dnf -y install dnf-plugins-core \
 && dnf -y install https://download.fmi.fi/smartmet-open/rhel/10/x86_64/smartmet-open-release-latest-10.noarch.rpm \
 && dnf config-manager --set-enabled crb \
 && dnf -y install epel-release \
 && dnf config-manager --setopt="epel.exclude=eccodes*" --save \
 && dnf -y install smartmet-qdtools smartmet-data-gfs eccodes \
      cronie crontabs perl-interpreter perl-Time-Local lbzip2 rsync procps-ng \
 && dnf clean all \
 && rm -rf /var/cache/dnf

ADD --chmod=755 https://raw.githubusercontent.com/fmidev/smartmet-base-international/${FMI_BASE_COMMIT}/unixtools/utcrun /smartmet/bin/utcrun
ADD --chmod=755 https://raw.githubusercontent.com/fmidev/smartmet-base-international/${FMI_BASE_COMMIT}/unixtools/cleaner /smartmet/bin/cleaner
ADD --chmod=755 https://raw.githubusercontent.com/fmidev/smartmet-base-international/${FMI_BASE_COMMIT}/unixtools/mkcron /smartmet/bin/mkcron

# Диспетчер cron как в smartmet-base-international: run-parts по каталогам /smartmet/cnf/cron/*
# и mkcron, который переносит задания из /smartmet/cnf/cron/cron.d в /etc/cron.d.
RUN mkdir -p /smartmet/cnf/cron/cron.d /smartmet/cnf/cron/cron.10min /smartmet/cnf/cron/cron.hourly \
      /smartmet/cnf/cron/cron.daily /smartmet/cnf/cron/cron.weekly /smartmet/cnf/cron/cron.monthly \
 && chown -R smartmet:smartmet /smartmet/cnf /smartmet/bin
COPY smartmet.cron /etc/cron.d/smartmet.cron
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
