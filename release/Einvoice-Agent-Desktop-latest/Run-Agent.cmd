@echo off
REM Local test launcher ??? edit EINVOICE_API_BASE_URL for your environment.
set EINVOICE_API_BASE_URL=https://etaapi.erp-esafe.com
set SIGNING_PROVIDER=pkcs11
start "" "%~dp0Einvoice.Agent.exe"
