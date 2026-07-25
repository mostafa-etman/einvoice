using System.Drawing;
using System.Windows;
using System.Windows.Forms;
using Einvoice.Agent.Channel;
using Einvoice.Agent.Config;
using Einvoice.Agent.Queue;
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

        _settings = AgentSettings.FromEnvironment();
        var stored = DeviceTokenStore.Load(_settings.TokenStorePath);
        if (!string.IsNullOrWhiteSpace(stored))
            _settings.DeviceToken = stored;

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
            // Prompt to pair on first launch.
            _ = Dispatcher.InvokeAsync(() => PairDevice());
        }
    }

    private string? GetPinForSigning()
    {
        if (_settings!.SigningProvider == SigningProviderKind.Software)
            return null;

        if (!string.IsNullOrEmpty(_sessionPin) && DateTimeOffset.UtcNow < _pinExpires)
            return _sessionPin;

        string? pin = null;
        Dispatcher.Invoke(() =>
        {
            var dlg = new PinDialog();
            if (dlg.ShowDialog() == true)
            {
                pin = dlg.Pin;
                _sessionPin = pin;
                _pinExpires = DateTimeOffset.UtcNow.AddMinutes(15);
            }
        });

        if (string.IsNullOrEmpty(pin))
            throw new InvalidOperationException("PIN entry cancelled.");
        return pin;
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
        menu.Items.Add("Unlock token PIN…", null, (_, _) => UnlockPin());
        menu.Items.Add("Clear PIN session", null, (_, _) =>
        {
            _sessionPin = null;
            _pinExpires = DateTimeOffset.MinValue;
            RefreshTrayText();
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, async (_, _) => await ShutdownAsync());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => PairDevice();
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
        var dlg = new PairingDialog(_settings.DeviceLabel);
        if (dlg.ShowDialog() != true) return;

        try
        {
            var result = await _api.PairAsync(dlg.PairingCode, dlg.DeviceLabel, Environment.MachineName);
            var token = result.Value<string>("deviceToken");
            if (string.IsNullOrWhiteSpace(token))
                throw new InvalidOperationException("Pairing response missing deviceToken.");

            _settings.DeviceToken = token;
            _api.SetDeviceToken(token);
            DeviceTokenStore.Save(_settings.TokenStorePath, token);
            MessageBox.Show(
                $"Paired successfully.\nDevice: {result.Value<string>("deviceId")}\nTenant: {result.Value<string>("tenantId")}",
                "Pairing",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            RefreshTrayText();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Pairing failed", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void UnlockPin()
    {
        var dlg = new PinDialog("Enter eSeal PIN (kept in memory ~15 minutes; never sent to the cloud)");
        if (dlg.ShowDialog() == true)
        {
            _sessionPin = dlg.Pin;
            _pinExpires = DateTimeOffset.UtcNow.AddMinutes(15);
            RefreshTrayText();
        }
    }

    private async Task ShutdownAsync()
    {
        if (_host is not null)
            await _host.StopAsync(TimeSpan.FromSeconds(5));
        _tray!.Visible = false;
        _tray.Dispose();
        _host?.Dispose();
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        _host?.Dispose();
        base.OnExit(e);
    }
}
