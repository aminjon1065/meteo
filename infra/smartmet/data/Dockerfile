# Загрузка и конвертация данных моделей (GFS) штатными пакетами FMI.
# Повторяет шаги установщика fmidev/smartmet-install (репозиторий smartmet-open, CRB, EPEL без eccodes)
# на Rocky Linux 10, но без системных служб метапакета smartmet-base-international (Samba, PostgreSQL,
# Docker, firewalld) — на сервере портала они не нужны или уже есть на хосте.
# Расписание — supercronic от пользователя smartmet (без root) по файлам FMI в /smartmet/cnf/cron.
FROM rockylinux/rockylinux:10

# Утилиты unixtools из smartmet-base-international (utcrun, cleaner) — зафиксированный коммит.
ARG FMI_BASE_COMMIT=92131aed2d334562ff0823decb0f1826b424f014
# supercronic — cron без root, журнал заданий в stdout контейнера.
ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1

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
      perl-interpreter perl-Time-Local lbzip2 rsync procps-ng \
 && dnf clean all \
 && rm -rf /var/cache/dnf

ADD --checksum=sha256:${SUPERCRONIC_SHA256} --chmod=755 \
  https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64 \
  /usr/local/bin/supercronic
ADD --chmod=755 https://raw.githubusercontent.com/fmidev/smartmet-base-international/${FMI_BASE_COMMIT}/unixtools/utcrun /smartmet/bin/utcrun
ADD --chmod=755 https://raw.githubusercontent.com/fmidev/smartmet-base-international/${FMI_BASE_COMMIT}/unixtools/cleaner /smartmet/bin/cleaner

# Каталоги расписания как в smartmet-base-international: задания cron.d и скрипты cron.10min…monthly.
RUN mkdir -p /smartmet/cnf/cron/cron.d /smartmet/cnf/cron/cron.10min /smartmet/cnf/cron/cron.hourly \
      /smartmet/cnf/cron/cron.daily /smartmet/cnf/cron/cron.weekly /smartmet/cnf/cron/cron.monthly \
 && chown -R smartmet:smartmet /smartmet/cnf /smartmet/bin
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENV PATH=/usr/local/bin:/usr/bin:/bin:/smartmet/bin
USER smartmet
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
