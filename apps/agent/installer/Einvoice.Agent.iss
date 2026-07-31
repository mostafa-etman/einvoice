; Inno Setup script for the eInvoice Signing Agent (professional client installer).
; Prerequisites: install Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
; Build steps:
;   1. pwsh apps/agent/scripts/publish-win-x64.ps1
;   2. Open this file in Inno Setup Compiler (or ISCC.exe) and Compile
; Output: apps/agent/dist/installer/EinvoiceAgentSetup-{version}.exe
;
; Versioning: keep AppVersion in sync with Desktop csproj <Version>.
; Updates: bump AppVersion + VersionInfoVersion; Inno AppId stays fixed so
; upgrades replace the previous install. For auto-update later, ship a
; small updater that downloads the new Setup EXE or use Winget/MSIX.

#define MyAppName "eInvoice Signing Agent"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Einvoice"
#define MyAppExeName "Einvoice.Agent.exe"
; Fixed GUID — do not change between releases (enables upgrade path).
#define MyAppId "{{A7C3E9F1-2B4D-4E6A-9C8F-1D2E3F4A5B6C}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Einvoice\SigningAgent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=EinvoiceAgentSetup-{#MyAppVersion}
; Place agent.ico beside this script (or under src/Einvoice.Agent.Desktop/) when available.
; SetupIconFile=..\src\Einvoice.Agent.Desktop\agent.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoVersion={#MyAppVersion}.0
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "autostart"; Description: "Start agent automatically when I &log in"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
; Produced by scripts/publish-win-x64.ps1
Source: "..\dist\win-x64\Einvoice.Agent.exe"; DestDir: "{app}"; Flags: ignoreversion
; Do not ship .pdb to clients.

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Per-user auto-start (no admin required with PrivilegesRequired=lowest)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "EinvoiceSigningAgent"; \
    ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  MsgBox(
    'Before continuing:'#13#10#13#10 +
    '1. Install your eSeal USB token middleware from Egypt Trust / your CA'#13#10 +
    '   (PKCS#11 DLL such as eps2003csp11.dll or SignatureP11.dll).'#13#10 +
    '2. Plug in the USB token.'#13#10#13#10 +
    'The agent does not bundle token drivers.',
    mbInformation, MB_OK);
end;
