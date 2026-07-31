using System.Windows;
using System.Windows.Controls;
using Einvoice.Agent.Config;
using Einvoice.Agent.Signing;
using WpfButton = System.Windows.Controls.Button;
using WpfCheckBox = System.Windows.Controls.CheckBox;
using WpfComboBox = System.Windows.Controls.ComboBox;
using WpfOrientation = System.Windows.Controls.Orientation;
using WpfStackPanel = System.Windows.Controls.StackPanel;
using WpfTextBlock = System.Windows.Controls.TextBlock;
using WpfTextBox = System.Windows.Controls.TextBox;

namespace Einvoice.Agent.Desktop;

/// <summary>
/// Non-secret token settings: PKCS#11 library + certificate. Saved only in local agent config.
/// </summary>
public sealed class TokenConfigDialog : Window
{
    private readonly LocalAgentConfig _config;
    private readonly WpfComboBox _libraryBox;
    private readonly WpfComboBox _certBox;
    private readonly WpfTextBox _issuerBox;
    private readonly WpfTextBox _manualLibBox;
    private readonly WpfCheckBox _manualBox;
    private List<DetectedTokenCertificate> _certs = [];

    public TokenConfigDialog(LocalAgentConfig config, TokenDetectionResult? detection = null)
    {
        _config = config;
        Title = "Signing token setup";
        Width = 560;
        Height = 420;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var root = new WpfStackPanel { Margin = new Thickness(16) };
        root.Children.Add(new WpfTextBlock
        {
            Text =
                "The agent detects your USB token middleware and certificate on this PC. " +
                "These settings stay local — never uploaded to the cloud. The PIN is entered separately when signing.",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        root.Children.Add(new WpfTextBlock { Text = "PKCS#11 library", FontWeight = FontWeights.SemiBold });
        _libraryBox = new WpfComboBox { Margin = new Thickness(0, 4, 0, 8) };
        root.Children.Add(_libraryBox);

        root.Children.Add(new WpfTextBlock { Text = "Certificate on token", FontWeight = FontWeights.SemiBold });
        _certBox = new WpfComboBox { Margin = new Thickness(0, 4, 0, 8) };
        root.Children.Add(_certBox);

        root.Children.Add(new WpfTextBlock { Text = "Certificate issuer filter (optional)", Margin = new Thickness(0, 8, 0, 0) });
        _issuerBox = new WpfTextBox
        {
            Text = config.CertificateIssuerFilter ?? "",
            Margin = new Thickness(0, 4, 0, 8),
        };
        root.Children.Add(_issuerBox);

        _manualBox = new WpfCheckBox
        {
            Content = "Enter library path manually",
            IsChecked = config.ManualTokenConfig,
            Margin = new Thickness(0, 4, 0, 4),
        };
        root.Children.Add(_manualBox);

        _manualLibBox = new WpfTextBox
        {
            Text = config.Pkcs11LibraryPath ?? "",
            IsEnabled = config.ManualTokenConfig,
            Margin = new Thickness(0, 4, 0, 8),
        };
        _manualBox.Checked += (_, _) => _manualLibBox.IsEnabled = true;
        _manualBox.Unchecked += (_, _) => _manualLibBox.IsEnabled = false;
        root.Children.Add(_manualLibBox);

        var buttons = new WpfStackPanel
        {
            Orientation = WpfOrientation.Horizontal,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
            Margin = new Thickness(0, 12, 0, 0),
        };
        var refresh = new WpfButton { Content = "Re-detect", Width = 100, Margin = new Thickness(0, 0, 8, 0) };
        var save = new WpfButton { Content = "Save", Width = 90, IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
        var cancel = new WpfButton { Content = "Cancel", Width = 90, IsCancel = true };
        refresh.Click += (_, _) => LoadDetection(TokenAutoDetect.Detect(_manualLibBox.Text));
        save.Click += (_, _) =>
        {
            ApplyToConfig();
            DialogResult = true;
        };
        buttons.Children.Add(refresh);
        buttons.Children.Add(save);
        buttons.Children.Add(cancel);
        root.Children.Add(buttons);
        Content = root;

        LoadDetection(detection ?? TokenAutoDetect.Detect(config.Pkcs11LibraryPath));
    }

    private void LoadDetection(TokenDetectionResult detection)
    {
        _libraryBox.Items.Clear();
        foreach (var lib in detection.Libraries)
            _libraryBox.Items.Add(lib.Path);
        if (!string.IsNullOrWhiteSpace(detection.PreferredLibraryPath)
            && !_libraryBox.Items.Contains(detection.PreferredLibraryPath))
            _libraryBox.Items.Add(detection.PreferredLibraryPath);
        if (_libraryBox.Items.Count > 0)
            _libraryBox.SelectedItem = detection.PreferredLibraryPath ?? _libraryBox.Items[0];

        _certs = detection.Certificates.ToList();
        _certBox.Items.Clear();
        foreach (var c in _certs)
        {
            var thumb = c.Thumbprint.Length >= 8 ? c.Thumbprint[..8] : c.Thumbprint;
            _certBox.Items.Add($"{ShortDn(c.Subject)} | issuer={ShortDn(c.Issuer)} | {thumb}…");
        }

        var preferred = TokenAutoDetect.PreferEsealCertificate(_certs);
        if (preferred is not null)
        {
            var idx = _certs.IndexOf(preferred);
            if (idx >= 0) _certBox.SelectedIndex = idx;
            if (string.IsNullOrWhiteSpace(_issuerBox.Text))
                _issuerBox.Text = ExtractCn(preferred.Issuer) ?? preferred.Issuer;
        }
        else if (_certBox.Items.Count > 0)
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
            ? _manualLibBox.Text.Trim()
            : (_libraryBox.SelectedItem as string)?.Trim();
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
