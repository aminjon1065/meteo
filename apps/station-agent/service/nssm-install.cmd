@echo off
rem Служба Windows через NSSM (https://nssm.cc): агент работает постоянно (pollIntervalSec > 0).
rem nssm.exe положите рядом с агентом или в PATH. Выполнять от администратора.
set AGENT_DIR=%~dp0
set NODE=%ProgramFiles%\nodejs\node.exe
if not exist "%NODE%" set NODE=node
nssm install MeteoStationAgent "%NODE%" "\"%AGENT_DIR%station-agent.mjs\" --config \"%AGENT_DIR%config.json\""
nssm set MeteoStationAgent AppDirectory "%AGENT_DIR%"
nssm set MeteoStationAgent DisplayName "Meteoportal station agent"
nssm set MeteoStationAgent Description "Отправка измерений станции на Метеопортал (POST /api/v1/ingest)"
nssm set MeteoStationAgent Start SERVICE_AUTO_START
nssm set MeteoStationAgent AppStdout "%AGENT_DIR%service-stdout.log"
nssm set MeteoStationAgent AppStderr "%AGENT_DIR%service-stderr.log"
nssm set MeteoStationAgent AppRotateFiles 1
nssm set MeteoStationAgent AppRotateBytes 5000000
rem Ключ станции через переменную окружения службы (если в config.json указан apiKeyEnv):
rem nssm set MeteoStationAgent AppEnvironmentExtra METEO_STATION_API_KEY=mst_...
nssm start MeteoStationAgent
nssm status MeteoStationAgent
