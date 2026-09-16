using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
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

namespace Einvoice.Agent.Mac;

/// <summary>
/// macOS tray host: same pairing / heartbeat / claim / PKCS#11 sign / submit loop as Windows,
/// with Keychain-backed pairing and Avalonia dialogs instead of WPF.
/// </summary>
public sealed class AgentSession
{
    private readonly Application _app;
    private readonly IClassicDesktopStyleApplicationLifetime _desktop;
    private IHost? _host;
    private TrayIcon? _tray;
    private NativeMenuItem? _pairMenuItem;
    private NativeMenuItem? _unpairMenuItem;
    private NativeMenuItem? _statusMenuItem;
    private SigningWorker? _worker;
    private AgentSettings? _settings;
    private LocalAgentConfig? _localConfig;
    private AgentApiClient? _api;
    private Window? _owner;
    private string? _sessionPin;
    private DateTimeOffset _pinExpires = DateTimeOffset.MinValue;
    private int _pairingUiGate;

    public AgentSession(Application app, IClassicDesktopStyleApplicationLifetime desktop)
    {
        _app = app;
        _desktop = desktop;
        _desktop.Exit += (_, _) => _sessionPin = null;
    }

    public void Start()
    {
        _localConfig = LocalAgentConfig.Load();
        _settings = AgentSettings.FromEnvironment();
        ApplyPersistedPairing(_settings);

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
                b.AddSimpleConsole(o => o.TimestampFormat = "HH:mm:ss ");
                b.SetMinimumLevel(LogLevel.Information);
            })
            .ConfigureServices(services =>
            {
                services.AddSingleton(_settings);
                services.AddSingleton(_ => new AgentApiClient(_settings.ApiBaseUrl, _settings.DeviceToken));
                services.AddSingleton(_ => new SqliteOfflineQueue(_settings.QueueDatabasePath));
                services.AddSingleton<ISigningProvider>(_ => SigningProviderFactory.Create(_settings));
                services.AddSingleton<SigningWorker>(sp => new SigningWorker(
                    sp.GetRequiredService<AgentSettings>(),
                    sp.GetRequiredService<AgentApiClient>(),
                    sp.GetRequiredService<SqliteOfflineQueue>(),
                    sp.GetRequiredService<ISigningProvider>(),
                    sp.GetRequiredService<ILogger<SigningWorker>>(),
                    GetPinForSigning));
                services.AddHostedService(sp => sp.GetRequiredService<SigningWorker>());
            })
            .Build();

        _api = _host.Services.GetRequiredService<AgentApiClient>();
        _worker = _host.Services.GetRequiredService<SigningWorker>();
        _worker.StateChanged += OnWorkerStateChanged;

        BuildTray();
        _ = _host.StartAsync();
        RefreshTrayText();

        if (!HasPersistedPairing())
            Dispatcher.UIThread.Post(() => _ = RunFirstRunSetupAsync());
    }

    private Window Owner
    {
        get
        {
            if (_owner is not null)
                return _owner;
            _owner = new Window
            {
                Width = 1,
                Height = 1,
                ShowInTaskbar = false,
                SystemDecorations = SystemDecorations.None,
                Opacity = 0,
                Title = "eInvoice Signing Agent",
                Position = new PixelPoint(-4000, -4000),
            };
            _owner.Show();
            return _owner;
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
        Dispatcher.UIThread.Post(RefreshTrayText);
    }

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

    private async Task RunFirstRunSetupAsync()
    {
        await Dialogs.ShowInfo(
            Owner,
            "Setup",
            "Welcome to the eInvoice Signing Agent.\n\n" +
            "1. Plug in your USB eSeal token\n" +
            "2. Pair once with a code from the web app (Devices)\n" +
            "3. Confirm the detected token/certificate\n" +
            "4. Enter your PIN only when you sign (stays on this Mac)\n\n" +
            "Pairing is saved on this Mac. Closing or restarting does not require a new code.");

        await PairDeviceAsync(force: true);
        if (HasPersistedPairing())
            await ConfigureTokenAsync(showEvenIfConfigured: true);
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

        if (Dispatcher.UIThread.CheckAccess())
            throw new InvalidOperationException("PIN prompt cannot run on the UI thread.");

        var pin = Dispatcher.UIThread.InvokeAsync(PromptPinAsync).GetAwaiter().GetResult();
        if (string.IsNullOrEmpty(pin))
            throw new InvalidOperationException("PIN entry cancelled.");
        return pin;
    }

    private async Task<string?> PromptPinAsync()
    {
        var dlg = new PinWindow();
        await dlg.ShowDialog(Owner);
        if (!dlg.Confirmed)
            return null;
        StorePinSession(dlg.Pin, dlg.RememberPin, dlg.RememberMinutes);
        return dlg.Pin;
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
            try { PinVault.Save(pin, life); }
            catch { /* session memory only */ }

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
        var menu = new NativeMenu();
        _statusMenuItem = new NativeMenuItem("Starting…") { IsEnabled = false };
        menu.Items.Add(_statusMenuItem);
        menu.Items.Add(new NativeMenuItemSeparator());

        _pairMenuItem = new NativeMenuItem("Pair device…");
        _pairMenuItem.Click += (_, _) => _ = PairDeviceAsync(force: false);
        _unpairMenuItem = new NativeMenuItem("Unpair / re-pair…");
        _unpairMenuItem.Click += (_, _) => _ = UnpairAndRepairAsync();
        menu.Items.Add(_pairMenuItem);
        menu.Items.Add(_unpairMenuItem);
        var tokenItem = new NativeMenuItem("Token / certificate…");
        tokenItem.Click += (_, _) => _ = ConfigureTokenAsync(showEvenIfConfigured: true);
        menu.Items.Add(tokenItem);
        var unlock = new NativeMenuItem("Unlock token PIN…");
        unlock.Click += (_, _) => _ = UnlockPinAsync();
        menu.Items.Add(unlock);
        var clearPin = new NativeMenuItem("Clear PIN (memory + remembered)");
        clearPin.Click += (_, _) => ClearPinEverywhere();
        menu.Items.Add(clearPin);
        menu.Items.Add(new NativeMenuItemSeparator());
        var quit = new NativeMenuItem("Quit");
        quit.Click += (_, _) => _ = ShutdownAsync();
        menu.Items.Add(quit);

        _tray = new TrayIcon
        {
            ToolTipText = "eInvoice Signing Agent",
            Icon = TrayGlyph.CreateIcon(),
            Menu = menu,
            IsVisible = true,
        };
        _tray.Clicked += (_, _) => OnTrayClicked();
        TrayIcon.SetIcons(_app, new TrayIcons { _tray });
        RefreshPairingMenu();
    }

    private void OnTrayClicked()
    {
        if (HasPersistedPairing())
            return;
        _ = PairDeviceAsync(force: true);
    }

    private async Task ConfigureTokenAsync(bool showEvenIfConfigured)
    {
        if (_localConfig is null || _settings is null) return;
        if (!showEvenIfConfigured
            && !string.IsNullOrWhiteSpace(_localConfig.Pkcs11LibraryPath)
            && !string.IsNullOrWhiteSpace(_localConfig.CertificateThumbprint))
            return;

        var dlg = new TokenConfigWindow(_localConfig);
        await dlg.ShowDialog(Owner);
        if (!dlg.Confirmed) return;

        _localConfig = LocalAgentConfig.Load();
        _settings.ApplyLocalConfig(_localConfig);
        await Dialogs.ShowInfo(
            Owner,
            "Token setup",
            "Token settings saved on this Mac only.\n" +
            $"Library: {_localConfig.Pkcs11LibraryPath}\n" +
            $"Cert: {_localConfig.CertificateSubjectDisplay ?? _localConfig.CertificateThumbprint}");
        RefreshTrayText();
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
            _tray.ToolTipText = text;
            if (_statusMenuItem is not null)
                _statusMenuItem.Header = text.Length <= 80 ? text : text[..80];
        }

        if (Dispatcher.UIThread.CheckAccess()) Apply();
        else Dispatcher.UIThread.Post(Apply);
    }

    private void RefreshPairingMenu()
    {
        var paired = HasPersistedPairing();
        if (_pairMenuItem is not null)
            _pairMenuItem.IsEnabled = !paired;
        if (_unpairMenuItem is not null)
            _unpairMenuItem.IsEnabled = paired;
    }

    private bool TryEnterPairingUi() => Interlocked.CompareExchange(ref _pairingUiGate, 1, 0) == 0;

    private void ExitPairingUi() => Interlocked.Exchange(ref _pairingUiGate, 0);

    private async Task PairDeviceAsync(bool force, bool alreadyEntered = false)
    {
        if (_settings is null || _api is null) return;

        if (!alreadyEntered && !TryEnterPairingUi())
        {
            await Dialogs.ShowInfo(Owner, "Pairing", "Pairing is already in progress.");
            return;
        }

        try
        {
            if (!force && HasPersistedPairing())
            {
                await Dialogs.ShowInfo(
                    Owner,
                    "Already paired",
                    "This Mac is already paired. Closing or restarting does not require a new pairing code.\n\n" +
                    $"API: {_settings.ApiBaseUrl}\n\n" +
                    "The token PIN is still requested when signing.\n" +
                    "Use Unpair / re-pair only if you are moving this agent or resetting it.");
                return;
            }

            var dlg = new PairingWindow(_settings.DeviceLabel, _settings.ApiBaseUrl);
            await dlg.ShowDialog(Owner);
            if (!dlg.Confirmed) return;

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
            await Dialogs.ShowInfo(
                Owner,
                "Pairing",
                $"Paired successfully{(resumed ? " (existing device on this Mac)" : "")}.\n" +
                "This pairing is saved on this Mac — you will not need a new code after restart.\n\n" +
                $"API: {apiBase}\nDevice: {pairing.DeviceId}\nTenant: {pairing.TenantId}");
            RefreshTrayText();
            await ConfigureTokenAsync(showEvenIfConfigured: false);
        }
        catch (Exception ex)
        {
            await Dialogs.ShowInfo(Owner, "Pairing failed", PinGuard.Redact(ex.Message));
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
            await Dialogs.ShowInfo(Owner, "Pairing", "Pairing is already in progress.");
            return;
        }

        try
        {
            var confirm = await Dialogs.Confirm(
                Owner,
                "Unpair / re-pair",
                "Unpair this Mac from the company?\n\n" +
                "You will need a new pairing code from Devices. " +
                "Normal close/restart does not require this.\n\n" +
                "The eSeal PIN is not stored with pairing and is not sent to the cloud.");
            if (!confirm) return;

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

    private async Task UnlockPinAsync()
    {
        var dlg = new PinWindow("Enter eSeal PIN (kept locally; never sent to the cloud)");
        await dlg.ShowDialog(Owner);
        if (dlg.Confirmed)
            StorePinSession(dlg.Pin, dlg.RememberPin, dlg.RememberMinutes);
    }

    private async Task ShutdownAsync()
    {
        _sessionPin = null;
        if (_host is not null)
            await _host.StopAsync(TimeSpan.FromSeconds(5));
        if (_tray is not null)
            _tray.IsVisible = false;
        _host?.Dispose();
        _desktop.Shutdown();
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

internal static class TrayGlyph
{
    public static WindowIcon CreateIcon()
    {
        try
        {
            var uri = new Uri("avares://Einvoice.Agent.Mac/Assets/tray.png");
            using var stream = AssetLoader.Open(uri);
            return new WindowIcon(stream);
        }
        catch
        {
            using var bmp = new WriteableBitmap(new PixelSize(32, 32), new Vector(96, 96), PixelFormat.Bgra8888, AlphaFormat.Premul);
            using (var fb = bmp.Lock())
            {
                var buffer = new byte[32 * 32 * 4];
                for (var i = 0; i < 32 * 32; i++)
                {
                    buffer[i * 4 + 0] = 168;
                    buffer[i * 4 + 1] = 92;
                    buffer[i * 4 + 2] = 32;
                    buffer[i * 4 + 3] = 255;
                }
                System.Runtime.InteropServices.Marshal.Copy(buffer, 0, fb.Address, buffer.Length);
            }

            using var ms = new MemoryStream();
            bmp.Save(ms);
            ms.Position = 0;
            return new WindowIcon(ms);
        }
    }
}
