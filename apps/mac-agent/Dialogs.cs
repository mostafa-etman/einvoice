using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Einvoice.Agent.Config;

namespace Einvoice.Agent.Mac;

internal static class Dialogs
{
    public static async Task ShowInfo(Window owner, string title, string message)
    {
        var w = CreateDialog(title, 480, 220);
        var root = new StackPanel { Margin = new Thickness(16), Spacing = 12 };
        root.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap });
        root.Children.Add(OkRow(w, "OK", confirmed: true));
        w.Content = root;
        await w.ShowDialog(owner);
    }

    public static async Task<bool> Confirm(Window owner, string title, string message)
    {
        var w = CreateDialog(title, 480, 240);
        var root = new StackPanel { Margin = new Thickness(16), Spacing = 12 };
        root.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap });
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
        };
        var yes = new Button { Content = "Yes", Width = 90 };
        var no = new Button { Content = "No", Width = 90 };
        var ok = false;
        yes.Click += (_, _) => { ok = true; w.Close(); };
        no.Click += (_, _) => w.Close();
        row.Children.Add(yes);
        row.Children.Add(no);
        root.Children.Add(row);
        w.Content = root;
        await w.ShowDialog(owner);
        return ok;
    }

    public static Window CreateDialog(string title, double width, double height)
    {
        return new Window
        {
            Title = title,
            Width = width,
            Height = height,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            CanResize = false,
        };
    }

    public static StackPanel OkRow(Window w, string label, bool confirmed)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var ok = new Button { Content = label, Width = 90 };
        ok.Click += (_, _) => w.Close();
        row.Children.Add(ok);
        return row;
    }
}

internal sealed class PairingWindow : Window
{
    private readonly TextBox _api;
    private readonly TextBox _code;
    private readonly TextBox _label;

    public bool Confirmed { get; private set; }
    public string PairingCode => _code.Text?.Trim() ?? "";
    public string DeviceLabel => _label.Text?.Trim() ?? "";
    public string ApiBaseUrl => _api.Text?.Trim() ?? "";

    public PairingWindow(string defaultLabel, string defaultApiBaseUrl)
    {
        Title = "Pair signing device";
        Width = 480;
        Height = 380;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        CanResize = false;

        var root = new StackPanel { Margin = new Thickness(16), Spacing = 6 };
        root.Children.Add(new TextBlock
        {
            Text = "Cloud API base URL (HTTPS):",
        });
        _api = new TextBox
        {
            Text = string.IsNullOrWhiteSpace(defaultApiBaseUrl)
                ? AgentSettings.DefaultApiBaseUrl
                : defaultApiBaseUrl,
        };
        root.Children.Add(_api);
        root.Children.Add(new TextBlock
        {
            Text = "Enter the pairing code from the Devices screen.\nThis is one-time — restarts do not need a new code.",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 8, 0, 0),
        });
        _code = new TextBox();
        root.Children.Add(_code);
        root.Children.Add(new TextBlock { Text = "Device label:", Margin = new Thickness(0, 8, 0, 0) });
        _label = new TextBox { Text = defaultLabel };
        root.Children.Add(_label);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
            Margin = new Thickness(0, 16, 0, 0),
        };
        var ok = new Button { Content = "Pair", Width = 90 };
        var cancel = new Button { Content = "Cancel", Width = 90 };
        ok.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(ApiBaseUrl) || string.IsNullOrWhiteSpace(PairingCode))
                return;
            Confirmed = true;
            Close();
        };
        cancel.Click += (_, _) => Close();
        row.Children.Add(ok);
        row.Children.Add(cancel);
        root.Children.Add(row);
        Content = root;
    }
}

internal sealed class PinWindow : Window
{
    private readonly TextBox _pin;
    private readonly CheckBox _remember;
    private readonly ComboBox _timeout;

    public bool Confirmed { get; private set; }
    public string Pin => _pin.Text ?? "";
    public bool RememberPin => _remember.IsChecked == true;
    public int RememberMinutes { get; private set; } = 15;

    public PinWindow(string prompt = "Enter eSeal token PIN (never sent to the cloud)")
    {
        Title = "Token PIN";
        Width = 440;
        Height = 280;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        CanResize = false;

        var root = new StackPanel { Margin = new Thickness(16), Spacing = 8 };
        root.Children.Add(new TextBlock { Text = prompt, TextWrapping = TextWrapping.Wrap });
        _pin = new TextBox { PasswordChar = '•' };
        root.Children.Add(_pin);

        _remember = new CheckBox
        {
            Content = "Remember PIN on this Mac (Keychain — local only)",
        };
        root.Children.Add(_remember);

        var timeoutRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        timeoutRow.Children.Add(new TextBlock
        {
            Text = "Keep for:",
            VerticalAlignment = VerticalAlignment.Center,
        });
        _timeout = new ComboBox
        {
            Width = 200,
            IsEnabled = false,
            ItemsSource = new[] { "This session only", "15 minutes", "60 minutes", "8 hours" },
            SelectedIndex = 1,
        };
        _remember.IsCheckedChanged += (_, _) => _timeout.IsEnabled = _remember.IsChecked == true;
        timeoutRow.Children.Add(_timeout);
        root.Children.Add(timeoutRow);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
            Margin = new Thickness(0, 12, 0, 0),
        };
        var ok = new Button { Content = "Unlock", Width = 90 };
        var cancel = new Button { Content = "Cancel", Width = 90 };
        ok.Click += (_, _) =>
        {
            if (string.IsNullOrEmpty(Pin)) return;
            if (RememberPin)
            {
                RememberMinutes = _timeout.SelectedIndex switch
                {
                    0 => 0,
                    2 => 60,
                    3 => 480,
                    _ => 15,
                };
            }
            Confirmed = true;
            Close();
        };
        cancel.Click += (_, _) => Close();
        row.Children.Add(ok);
        row.Children.Add(cancel);
        root.Children.Add(row);
        Content = root;
        Opened += (_, _) => _pin.Focus();
    }
}

internal sealed class TokenConfigWindow : Window
{
    private readonly LocalAgentConfig _config;
    private readonly ComboBox _libraryBox;
    private readonly ComboBox _certBox;
    private readonly TextBox _issuerBox;
    private readonly TextBox _manualLibBox;
    private readonly CheckBox _manualBox;
    private List<Einvoice.Agent.Signing.DetectedTokenCertificate> _certs = [];

    public bool Confirmed { get; private set; }

    public TokenConfigWindow(LocalAgentConfig config)
    {
        _config = config;
        Title = "Signing token setup";
        Width = 580;
        Height = 440;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var root = new StackPanel { Margin = new Thickness(16), Spacing = 6 };
        root.Children.Add(new TextBlock
        {
            Text =
                "The agent detects your USB token middleware and certificate on this Mac. " +
                "These settings stay local. The PIN is entered separately when signing.",
            TextWrapping = TextWrapping.Wrap,
        });
        root.Children.Add(new TextBlock { Text = "PKCS#11 library", FontWeight = FontWeight.SemiBold });
        _libraryBox = new ComboBox();
        root.Children.Add(_libraryBox);
        root.Children.Add(new TextBlock { Text = "Certificate on token", FontWeight = FontWeight.SemiBold });
        _certBox = new ComboBox();
        root.Children.Add(_certBox);
        root.Children.Add(new TextBlock { Text = "Certificate issuer filter (optional)" });
        _issuerBox = new TextBox { Text = config.CertificateIssuerFilter ?? "" };
        root.Children.Add(_issuerBox);
        _manualBox = new CheckBox
        {
            Content = "Enter library path manually",
            IsChecked = config.ManualTokenConfig,
        };
        root.Children.Add(_manualBox);
        _manualLibBox = new TextBox
        {
            Text = config.Pkcs11LibraryPath ?? "",
            IsEnabled = config.ManualTokenConfig,
        };
        _manualBox.IsCheckedChanged += (_, _) => _manualLibBox.IsEnabled = _manualBox.IsChecked == true;
        root.Children.Add(_manualLibBox);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
            Margin = new Thickness(0, 12, 0, 0),
        };
        var refresh = new Button { Content = "Re-detect", Width = 100 };
        var save = new Button { Content = "Save", Width = 90 };
        var cancel = new Button { Content = "Cancel", Width = 90 };
        refresh.Click += (_, _) => LoadDetection(Einvoice.Agent.Signing.TokenAutoDetect.Detect(_manualLibBox.Text));
        save.Click += (_, _) =>
        {
            ApplyToConfig();
            Confirmed = true;
            Close();
        };
        cancel.Click += (_, _) => Close();
        row.Children.Add(refresh);
        row.Children.Add(save);
        row.Children.Add(cancel);
        root.Children.Add(row);
        Content = root;

        LoadDetection(Einvoice.Agent.Signing.TokenAutoDetect.Detect(config.Pkcs11LibraryPath));
    }

    private void LoadDetection(Einvoice.Agent.Signing.TokenDetectionResult detection)
    {
        var libs = detection.Libraries.Select(l => l.Path).ToList();
        if (!string.IsNullOrWhiteSpace(detection.PreferredLibraryPath)
            && !libs.Contains(detection.PreferredLibraryPath))
            libs.Add(detection.PreferredLibraryPath);
        _libraryBox.ItemsSource = libs;
        _libraryBox.SelectedItem = detection.PreferredLibraryPath ?? libs.FirstOrDefault();

        _certs = detection.Certificates.ToList();
        var labels = _certs.Select(c =>
        {
            var thumb = c.Thumbprint.Length >= 8 ? c.Thumbprint[..8] : c.Thumbprint;
            return $"{ShortDn(c.Subject)} | issuer={ShortDn(c.Issuer)} | {thumb}…";
        }).ToList();
        _certBox.ItemsSource = labels;

        var preferred = Einvoice.Agent.Signing.TokenAutoDetect.PreferEsealCertificate(_certs);
        if (preferred is not null)
        {
            var idx = _certs.IndexOf(preferred);
            if (idx >= 0) _certBox.SelectedIndex = idx;
            if (string.IsNullOrWhiteSpace(_issuerBox.Text))
                _issuerBox.Text = ExtractCn(preferred.Issuer) ?? preferred.Issuer;
        }
        else if (labels.Count > 0)
        {
            _certBox.SelectedIndex = 0;
        }

        if (!string.IsNullOrWhiteSpace(detection.Notes))
            Title = $"Signing token setup — {detection.Notes}";
    }

    private void ApplyToConfig()
    {
        _config.ManualTokenConfig = _manualBox.IsChecked == true;
        _config.Pkcs11LibraryPath = _config.ManualTokenConfig
            ? _manualLibBox.Text?.Trim()
            : _libraryBox.SelectedItem as string;
        _config.CertificateIssuerFilter = string.IsNullOrWhiteSpace(_issuerBox.Text)
            ? null
            : _issuerBox.Text.Trim();

        if (_certBox.SelectedIndex >= 0 && _certBox.SelectedIndex < _certs.Count)
        {
            var c = _certs[_certBox.SelectedIndex];
            _config.CertificateThumbprint = c.Thumbprint;
            _config.CertificateSubjectDisplay = c.Subject;
            _config.CertificateIssuerFilter ??= ExtractCn(c.Issuer);
        }

        _config.Save();
    }

    private static string ShortDn(string dn)
    {
        var cn = ExtractCn(dn);
        if (cn is not null) return cn;
        return dn.Length <= 48 ? dn : dn[..45] + "…";
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
