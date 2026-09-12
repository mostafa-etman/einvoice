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
    private ToolStripMenuItem? _pairMenuItem;
    private ToolStripMenuItem? _unpairMenuItem;
    private int _pairingUiGate;

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
        ApplyPersistedPairing(_settings);

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
        _worker.StateChanged += OnWorkerStateChanged;

        BuildTray();
        await _host.StartAsync();
        RefreshTrayText();

        if (!HasPersistedPairing())
        {
            _ = Dispatcher.InvokeAsync(() => RunFirstRunSetup());
        }
    }

    private static void ApplyPersistedPairing(AgentSettings settings)
    {
        var pairing = DeviceTokenStore.LoadPairing(settings.PairingStorePath, settings.TokenStorePath);
        if (pairing is not { IsValid: true })
            return;

        settings.DeviceToken = pairing.DeviceToken;
        if (!string.IsNullOrWhiteSpace(pairing.ApiBaseUrl))
            settings.ApiBaseUrl = AgentSettings.NormalizeApiBaseUrl(pairing.ApiBaseUrl);
    }

    private bool HasPersistedPairing() =>
        _settings is not null
        && !string.IsNullOrWhiteSpace(_settings.DeviceToken)
        && (_api is null || !_api.IsUnpaired);

    private void OnWorkerStateChanged()
    {
        DropLocalPairingIfServerRejected();
        RefreshTrayText();
    }

    /// <summary>
    /// Web/admin unpair revokes the cloud token. The worker then sees 401.
    /// Clear the saved pairing so "Pair device" is available again.
    /// </summary>
    private void DropLocalPairingIfServerRejected()
    {
        if (_settings is null || _api is null) return;
        if (!PairingLifecycle.MustDropLocalPairing(
                _api.IsUnpaired,
                !string.IsNullOrWhiteSpace(_settings.DeviceToken)))
            return;

        DeviceTokenStore.Clear(_settings.PairingStorePath, _settings.TokenStorePath);
        _settings.DeviceToken = null;
        _api.ClearDeviceToken();
    }

    /// <summary>
    /// One-time install UX: pair → auto-detect token → PIN only when signing.
    /// Not shown again while a saved pairing exists.
    /// </summary>
    private async void RunFirstRunSetup()
    {
        MessageBox.Show(
            "Welcome to the eInvoice Signing Agent.\n\n" +
            "1. Plug in your USB eSeal token\n" +
            "2. Pair once with a code from the web app (Devices)\n" +
            "3. Confirm the detected token/certificate\n" +
            "4. Enter your PIN only when you sign (stays on this PC)\n\n" +
            "Pairing is saved on this PC. Closing or restarting the agent does not require a new code.",
            "Setup",
            MessageBoxButton.OK,
            MessageBoxImage.Information);

        await PairDeviceAsync(force: true);
        if (HasPersistedPairing())
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
        _pairMenuItem = new ToolStripMenuItem("Pair device…");
        _pairMenuItem.Click += async (_, _) => await PairDeviceAsync(force: false);
        _unpairMenuItem = new ToolStripMenuItem("Unpair / re-pair…");
        _unpairMenuItem.Click += async (_, _) => await UnpairAndRepairAsync();
        menu.Items.Add(_pairMenuItem);
        menu.Items.Add(_unpairMenuItem);
        menu.Items.Add("Token / certificate…", null, (_, _) => ConfigureToken(showEvenIfConfigured: true));
        menu.Items.Add("Unlock token PIN…", null, (_, _) => UnlockPin());
        menu.Items.Add("Clear PIN (memory + remembered)", null, (_, _) => ClearPinEverywhere());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, async (_, _) => await ShutdownAsync());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => OnTrayDoubleClick();
        RefreshPairingMenu();
    }

    private void OnTrayDoubleClick()
    {
        if (HasPersistedPairing())
        {
            _tray?.ShowBalloonTip(
                4000,
                "eInvoice Signing Agent",
                "Already paired. PIN is requested only when signing. Use Unpair / re-pair to reset.",
                ToolTipIcon.Info);
            return;
        }

        _ = PairDeviceAsync(force: true);
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

        void Apply()
        {
            RefreshPairingMenu();
            var pin = string.IsNullOrEmpty(_sessionPin) ? "PIN locked" : "PIN unlocked";
            var paired = HasPersistedPairing() ? "paired" : "not paired";
            var text =
                $"eInvoice Agent | {paired} | {_worker.StatusText} | pending={_worker.PendingCount} | {pin}";
            _tray.Text = text.Length <= 63 ? text : text[..63];
        }

        if (Dispatcher.CheckAccess()) Apply();
        else Dispatcher.BeginInvoke(Apply);
    }

    private void RefreshPairingMenu()
    {
        var paired = HasPersistedPairing();
        if (_pairMenuItem is not null)
            _pairMenuItem.Enabled = !paired;
        if (_unpairMenuItem is not null)
            _unpairMenuItem.Enabled = paired;
    }

    private bool TryEnterPairingUi() => Interlocked.CompareExchange(ref _pairingUiGate, 1, 0) == 0;

    private void ExitPairingUi() => Interlocked.Exchange(ref _pairingUiGate, 0);

    private async Task PairDeviceAsync(bool force, bool alreadyEntered = false)
    {
        if (_settings is null || _api is null) return;

        if (!alreadyEntered && !TryEnterPairingUi())
        {
            MessageBox.Show(
                "Pairing is already in progress.",
                "Pairing",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        try
        {
            if (!force && HasPersistedPairing())
            {
                MessageBox.Show(
                    "This PC is already paired. Closing or restarting the agent does not require a new pairing code.\n\n" +
                    $"API: {_settings.ApiBaseUrl}\n\n" +
                    "The token PIN is still requested when signing.\n" +
                    "Use Unpair / re-pair only if you are moving this agent or resetting it.",
                    "Already paired",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                return;
            }

            var dlg = new PairingDialog(_settings.DeviceLabel, _settings.ApiBaseUrl);
            if (dlg.ShowDialog() != true) return;

            var previousApi = _settings.ApiBaseUrl;
            var apiBase = AgentSettings.NormalizeApiBaseUrl(dlg.ApiBaseUrl);
            JObject result;
            PersistedPairing pairing;
            try
            {
                _settings.ApiBaseUrl = apiBase;
                _api.SetBaseUrl(apiBase);

                result = await _api.PairAsync(dlg.PairingCode, dlg.DeviceLabel, Environment.MachineName);
                var token = result.Value<string>("deviceToken");
                if (string.IsNullOrWhiteSpace(token))
                    throw new InvalidOperationException("Pairing response missing deviceToken.");

                pairing = new PersistedPairing
                {
                    DeviceToken = token.Trim(),
                    DeviceId = result.Value<string>("deviceId"),
                    TenantId = result.Value<string>("tenantId"),
                    ApiBaseUrl = apiBase,
                    DeviceLabel = dlg.DeviceLabel,
                    PairedAtUtc = DateTimeOffset.UtcNow,
                };
                DeviceTokenStore.SavePairing(pairing, _settings.PairingStorePath);

                _settings.DeviceToken = pairing.DeviceToken;
                _api.SetDeviceToken(pairing.DeviceToken);

                var local = LocalAgentConfig.Load(_settings.LocalConfigPath);
                local.ApiBaseUrl = apiBase;
                local.Save(_settings.LocalConfigPath);
                _localConfig = local;
            }
            catch
            {
                _settings.ApiBaseUrl = previousApi;
                _api.SetBaseUrl(previousApi);
                throw;
            }

            var resumed = result.Value<bool?>("resumed") == true;
            MessageBox.Show(
                $"Paired successfully{(resumed ? " (existing device on this PC)" : "")}.\n" +
                "This pairing is saved on this PC — you will not need a new code after restart.\n\n" +
                $"API: {apiBase}\nDevice: {pairing.DeviceId}\nTenant: {pairing.TenantId}",
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
        finally
        {
            if (!alreadyEntered) ExitPairingUi();
        }
    }

    private async Task UnpairAndRepairAsync()
    {
        if (_settings is null || _api is null) return;
        if (!TryEnterPairingUi())
        {
            MessageBox.Show(
                "Pairing is already in progress.",
                "Pairing",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        try
        {
            var confirm = MessageBox.Show(
                "Unpair this PC from the company?\n\n" +
                "You will need a new pairing code from Devices. " +
                "Normal close/restart does not require this.\n\n" +
                "The eSeal PIN is not stored with pairing and is not sent to the cloud.",
                "Unpair / re-pair",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                if (!string.IsNullOrWhiteSpace(_settings.DeviceToken) && _api is not null)
                    await _api.UnpairAsync();
            }
            catch
            {
                // Server revoke is best-effort; always clear local credentials.
            }

            DeviceTokenStore.Clear(_settings.PairingStorePath, _settings.TokenStorePath);
            _settings.DeviceToken = null;
            _api?.ClearDeviceToken();
            RefreshPairingMenu();
            RefreshTrayText();

            await PairDeviceAsync(force: true, alreadyEntered: true);
        }
        finally
        {
            ExitPairingUi();
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
