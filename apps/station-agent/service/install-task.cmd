@echo off
rem Планировщик заданий Windows: запуск агента каждые 5 минут в режиме --once.
rem Выполнять от администратора из папки с агентом. Ключ станции — в config.json (apiKey)
rem или в переменной окружения задачи (apiKeyEnv), см. README.ru.md.
set AGENT_DIR=%~dp0
set NODE=%ProgramFiles%\nodejs\node.exe
if not exist "%NODE%" set NODE=node
schtasks /Create /F /SC MINUTE /MO 5 /TN "Meteoportal station agent" ^
  /TR "\"%NODE%\" \"%AGENT_DIR%station-agent.mjs\" --config \"%AGENT_DIR%config.json\" --once" ^
  /RU SYSTEM /RL LIMITED
if %errorlevel% neq 0 (
  echo Не удалось создать задачу. Запустите от имени администратора.
  exit /b 1
)
echo Задача создана: schtasks /Query /TN "Meteoportal station agent"
schtasks /Run /TN "Meteoportal station agent"
