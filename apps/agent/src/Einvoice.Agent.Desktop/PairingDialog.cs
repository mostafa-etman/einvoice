using System.Windows;
using System.Windows.Controls;
using Einvoice.Agent.Config;

namespace Einvoice.Agent.Desktop;

public partial class PairingDialog : Window
{
    public string PairingCode => CodeBox.Text.Trim();
    public string DeviceLabel => LabelBox.Text.Trim();
    public string ApiBaseUrl => ApiBox.Text.Trim();

    public PairingDialog(string defaultLabel, string defaultApiBaseUrl)
    {
        Title = "Pair signing device";
        Width = 460;
        Height = 320;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.NoResize;

        var root = new StackPanel { Margin = new Thickness(16) };
        root.Children.Add(new TextBlock
        {
            Text = "Cloud API base URL (HTTPS — production domain when deployed):",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 4),
        });
        ApiBox = new System.Windows.Controls.TextBox
        {
            Text = string.IsNullOrWhiteSpace(defaultApiBaseUrl)
                ? AgentSettings.DefaultApiBaseUrl
                : defaultApiBaseUrl,
            Margin = new Thickness(0, 0, 0, 12),
        };
        root.Children.Add(ApiBox);

        root.Children.Add(new TextBlock
        {
            Text = "Enter the pairing code from the Devices screen:",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8),
        });
        CodeBox = new System.Windows.Controls.TextBox { Margin = new Thickness(0, 0, 0, 12) };
        root.Children.Add(CodeBox);
        root.Children.Add(new TextBlock { Text = "Device label:", Margin = new Thickness(0, 0, 0, 4) });
        LabelBox = new System.Windows.Controls.TextBox { Text = defaultLabel, Margin = new Thickness(0, 0, 0, 12) };
        root.Children.Add(LabelBox);

        var buttons = new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
        };
        var ok = new System.Windows.Controls.Button
        {
            Content = "Pair",
            Width = 90,
            IsDefault = true,
            Margin = new Thickness(0, 0, 8, 0),
        };
        var cancel = new System.Windows.Controls.Button { Content = "Cancel", Width = 90, IsCancel = true };
        ok.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(ApiBaseUrl))
            {
                System.Windows.MessageBox.Show(
                    this,
                    "Cloud API base URL is required (e.g. https://api.yourdomain.com).",
                    "Pair",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }

            if (string.IsNullOrWhiteSpace(PairingCode))
            {
                System.Windows.MessageBox.Show(
                    this,
                    "Pairing code is required.",
                    "Pair",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }

            DialogResult = true;
        };
        buttons.Children.Add(ok);
        buttons.Children.Add(cancel);
        root.Children.Add(buttons);
        Content = root;
    }

    private System.Windows.Controls.TextBox ApiBox { get; }
    private System.Windows.Controls.TextBox CodeBox { get; }
    private System.Windows.Controls.TextBox LabelBox { get; }
}
