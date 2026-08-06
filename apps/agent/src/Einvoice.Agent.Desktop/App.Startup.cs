using System.Drawing;
using System.Windows;
using System.Windows.Forms;
using Einvoice.Agent.Channel;
using Einvoice.Agent.Config;
using Einvoice.Agent.Queue;
using Einvoice.Agent.Security;
using Einvoice.Agent.Signing;
using Einvoice.Agent.Workers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;

namespace Einvoice.Agent.Desktop;

public partial class App
{
    private IHost? _host;
    private NotifyIcon? _tray;
    private SigningWorker? _worker;
    private AgentSettings? _settings;
    private LocalAgentConfig? _localConfig;
    private AgentApiClient? _api;
    private string? _sessionPin;
    private DateTimeOffset _pinExpires = DateTimeOffset.MinValue;

    [STAThread]
    public static void Main(string[] args)
    {
        var app = new App();
        app.InitializeComponent();
        app.Run();
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _localConfig = LocalAgentConfig.Load();
        _settings = AgentSettings.FromEnvironment();
        var stored = DeviceTokenStore.Load(_settings.TokenStorePath);
        if (!string.IsNullOrWhiteSpace(stored))
            _settings.DeviceToken = stored;

        // Prefer PKCS#11 when a known library is present (still software if none).
        if (_settings.SigningProvider == SigningProviderKind.Software
            && TokenAutoDetect.ScanLibraries().Count > 0)
        {
            _settings.SigningProvider = SigningProviderKind.Pkcs11;
        }

        ApplyAutoDetectIfNeeded();

        _host = Host.CreateDefaultBuilder()
            .ConfigureLogging(b =>
            {
                b.ClearProviders();
                b.AddDebug();
                b.SetMinimumLevel(LogLevel.Information);
            })
            .ConfigureServices(services =>
            {
                services.AddSingleton(_settings);
                services.AddSingleton(_ => new AgentApiClient(_settings.ApiBaseUrl, _settings.DeviceToken));
                services.AddSingleton(_ => new SqliteOfflineQueue(_settings.QueueDatabasePath));
                services.AddSingleton<ISigningProvider>(_ => SigningProviderFactory.Create(_settings));
                services.AddSingleton<SigningWorker>(sp =>
                {
                    var worker = new SigningWorker(
                        sp.GetRequiredService<AgentSettings>(),
                        sp.GetRequiredService<AgentApiClient>(),
                        sp.GetRequiredService<SqliteOfflineQueue>(),
                        sp.GetRequiredService<ISigningProvider>(),
                        sp.GetRequiredService<ILogger<SigningWorker>>(),
                        GetPinForSigning);
                    return worker;
                });
                services.AddHostedService(sp => sp.GetRequiredService<SigningWorker>());
            })
            .Build();

        _api = _host.Services.GetRequiredService<AgentApiClient>();
        _worker = _host.Services.GetRequiredService<SigningWorker>();
        _worker.StateChanged += RefreshTrayText;

        BuildTray();
        await _host.StartAsync();
        RefreshTrayText();

        if (string.IsNullOrWhiteSpace(_settings.DeviceToken))
        {
            _ = Dispatcher.InvokeAsync(() => RunFirstRunSetup());
        }
    }

    /// <summary>
    /// Minimal install UX: pair → auto-detect token → PIN only when signing.
    /// </summary>
    private void RunFirstRunSetup()
    {
        MessageBox.Show(
            "Welcome to the eInvoice Signing Agent.\n\n" +
            "1. Plug in your USB eSeal token\n" +
            "2. Pair with a code from the web app (Devices)\n" +
            "3. Confirm the detected token/certificate\n" +
            "4. Enter your PIN only when you sign (stays on this PC)\n",
            "Setup",
            MessageBoxButton.OK,
            MessageBoxImage.Information);

        PairDevice();
        ConfigureToken(showEvenIfConfigured: true);
    }

    private void ApplyAutoDetectIfNeeded()
    {
        if (_settings is null || _localConfig is null) return;
        if (_localConfig.ManualTokenConfig) return;

        var detection = TokenAutoDetect.Detect(_localConfig.Pkcs11LibraryPath ?? _settings.Pkcs11LibraryPath);
        if (string.IsNullOrWhiteSpace(_localConfig.Pkcs11LibraryPath)
            && !string.IsNullOrWhiteSpace(detection.PreferredLibraryPath))
        {
            _localConfig.Pkcs11LibraryPath = detection.PreferredLibraryPath;
        }

        if (string.IsNullOrWhiteSpace(_localConfig.CertificateThumbprint)
            && detection.Certificates.Count > 0)
        {
            var preferred = TokenAutoDetect.PreferEsealCertificate(detection.Certificates);
            if (preferred is not null)
            {
                _localConfig.CertificateThumbprint = preferred.Thumbprint;
                _localConfig.CertificateSubjectDisplay = preferred.Subject;
                _localConfig.CertificateIssuerFilter ??= ExtractCn(preferred.Issuer) ?? preferred.Issuer;
            }
            else if (detection.Certificates.Count > 1)
            {
                // Multiple certs and no clear eSeal heuristic — user must pick.
                Dispatcher.Invoke(() => ConfigureToken(showEvenIfConfigured: true));
                return;
            }
        }

        _localConfig.Save();
        _settings.ApplyLocalConfig(_localConfig);
    }

    private string? GetPinForSigning()
    {
        if (_settings!.SigningProvider == SigningProviderKind.Software)
            return null;

        if (!string.IsNullOrEmpty(_sessionPin) && DateTimeOffset.UtcNow < _pinExpires)
            return _sessionPin;

        if (_localConfig?.RememberPinEnabled == true)
        {
            var cached = PinVault.TryLoad();
            if (!string.IsNullOrEmpty(cached))
            {
                _sessionPin = cached;
                _pinExpires = _localConfig.PinRememberMinutes <= 0
                    ? DateTimeOffset.MaxValue
                    : DateTimeOffset.UtcNow.AddMinutes(_localConfig.PinRememberMinutes);
                return _sessionPin;
            }
        }

        string? pin = null;
        Dispatcher.Invoke(() =>
        {
            var dlg = new PinDialog();
            if (dlg.ShowDialog() == true)
            {
                pin = dlg.Pin;
                StorePinSession(pin, dlg.RememberPin, dlg.RememberMinutes);
            }
        });

        if (string.IsNullOrEmpty(pin))
            throw new InvalidOperationException("PIN entry cancelled.");
        return pin;
    }

    private void StorePinSession(string pin, bool remember, int minutes)
    {
        _sessionPin = pin;
        if (_localConfig is null)
        {
            _pinExpires = DateTimeOffset.UtcNow.AddMinutes(15);
            return;
        }

        _localConfig.RememberPinEnabled = remember;
        _localConfig.PinRememberMinutes = minutes;
        _localConfig.Save();

        if (remember)
        {
            var life = minutes <= 0 ? TimeSpan.Zero : TimeSpan.FromMinutes(minutes);
            try
            {
                PinVault.Save(pin, life);
            }
            catch
            {
                // DPAPI unavailable — session memory only.
            }

            _pinExpires = minutes <= 0
                ? DateTimeOffset.MaxValue
                : DateTimeOffset.UtcNow.AddMinutes(minutes);
        }
        else
        {
            PinVault.Clear();
            _pinExpires = DateTimeOffset.UtcNow.AddMinutes(15);
        }

        RefreshTrayText();
    }

    private void ClearPinEverywhere()
    {
        _sessionPin = null;
        _pinExpires = DateTimeOffset.MinValue;
        PinVault.Clear();
        if (_localConfig is not null)
        {
            _localConfig.RememberPinEnabled = false;
            _localConfig.Save();
        }
        RefreshTrayText();
    }

    private void BuildTray()
    {
        _tray = new NotifyIcon
        {
            Visible = true,
            Text = "eInvoice Signing Agent",
            Icon = SystemIcons.Application,
        };

        var menu = new ContextMenuStrip();
        menu.Items.Add("Pair device…", null, (_, _) => PairDevice());
        menu.Items.Add("Token / certificate…", null, (_, _) => ConfigureToken(showEvenIfConfigured: true));
        menu.Items.Add("Unlock token PIN…", null, (_, _) => UnlockPin());
        menu.Items.Add("Clear PIN (memory + remembered)", null, (_, _) => ClearPinEverywhere());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, async (_, _) => await ShutdownAsync());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => PairDevice();
    }

    private void ConfigureToken(bool showEvenIfConfigured)
    {
        if (_localConfig is null || _settings is null) return;
        if (!showEvenIfConfigured
            && !string.IsNullOrWhiteSpace(_localConfig.Pkcs11LibraryPath)
            && !string.IsNullOrWhiteSpace(_localConfig.CertificateThumbprint))
            return;

        var dlg = new TokenConfigDialog(_localConfig);
        if (dlg.ShowDialog() == true)
        {
            _localConfig = LocalAgentConfig.Load();
            _settings.ApplyLocalConfig(_localConfig);
            MessageBox.Show(
                "Token settings saved on this PC only.\n" +
                $"Library: {_localConfig.Pkcs11LibraryPath}\n" +
                $"Cert: {_localConfig.CertificateSubjectDisplay ?? _localConfig.CertificateThumbprint}",
                "Token setup",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            RefreshTrayText();
        }
    }

    private void RefreshTrayText()
    {
        if (_tray is null || _worker is null || _settings is null) return;
        var pin = string.IsNullOrEmpty(_sessionPin) ? "PIN locked" : "PIN unlocked";
        var text =
            $"eInvoice Agent | {_worker.StatusText} | pending={_worker.PendingCount} | {pin} | {_settings.SigningProvider.ToConfigValue()}";
        _tray.Text = text.Length <= 63 ? text : text[..63];
    }

    private async void PairDevice()
    {
        if (_settings is null || _api is null) return;
        var dlg = new PairingDialog(_settings.DeviceLabel, _settings.ApiBaseUrl);
        if (dlg.ShowDialog() != true) return;

        try
        {
            var apiBase = AgentSettings.NormalizeApiBaseUrl(dlg.ApiBaseUrl);
            _settings.ApiBaseUrl = apiBase;
            _api.SetBaseUrl(apiBase);

            var local = LocalAgentConfig.Load(_settings.LocalConfigPath);
            local.ApiBaseUrl = apiBase;
            local.Save(_settings.LocalConfigPath);

            var result = await _api.PairAsync(dlg.PairingCode, dlg.DeviceLabel, Environment.MachineName);
            var token = result.Value<string>("deviceToken");
            if (string.IsNullOrWhiteSpace(token))
                throw new InvalidOperationException("Pairing response missing deviceToken.");

            _settings.DeviceToken = token;
            _api.SetDeviceToken(token);
            DeviceTokenStore.Save(_settings.TokenStorePath, token);
            MessageBox.Show(
                $"Paired successfully.\nAPI: {apiBase}\nDevice: {result.Value<string>("deviceId")}\nTenant: {result.Value<string>("tenantId")}",
                "Pairing",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            RefreshTrayText();
            ConfigureToken(showEvenIfConfigured: false);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                PinGuard.Redact(ex.Message),
                "Pairing failed",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    private void UnlockPin()
    {
        var dlg = new PinDialog("Enter eSeal PIN (kept locally; never sent to the cloud)");
        if (dlg.ShowDialog() == true)
            StorePinSession(dlg.Pin, dlg.RememberPin, dlg.RememberMinutes);
    }

    private async Task ShutdownAsync()
    {
        // Session-only PIN dies with process; remembered DPAPI cache kept if user opted in.
        _sessionPin = null;
        if (_host is not null)
            await _host.StopAsync(TimeSpan.FromSeconds(5));
        _tray!.Visible = false;
        _tray.Dispose();
        _host?.Dispose();
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _sessionPin = null;
        _tray?.Dispose();
        _host?.Dispose();
        base.OnExit(e);
    }

    private static string? ExtractCn(string dn)
    {
        foreach (var part in dn.Split(','))
        {
            var p = part.Trim();
            if (p.StartsWith("CN=", StringComparison.OrdinalIgnoreCase))
                return p[3..].Trim();
        }
        return null;
    }
}
