using System.Windows;
using WpfButton = System.Windows.Controls.Button;
using WpfCheckBox = System.Windows.Controls.CheckBox;
using WpfComboBox = System.Windows.Controls.ComboBox;
using WpfComboBoxItem = System.Windows.Controls.ComboBoxItem;
using WpfOrientation = System.Windows.Controls.Orientation;
using WpfPasswordBox = System.Windows.Controls.PasswordBox;
using WpfStackPanel = System.Windows.Controls.StackPanel;
using WpfTextBlock = System.Windows.Controls.TextBlock;

namespace Einvoice.Agent.Desktop;

/// <summary>
/// PIN entry stays on the client. Optional "Remember" uses DPAPI locally — never the cloud.
/// </summary>
public partial class PinDialog : Window
{
    public string Pin => PinBox.Password;
    public bool RememberPin => RememberBox.IsChecked == true;
    public int RememberMinutes { get; private set; } = 15;

    public PinDialog(string prompt = "Enter eSeal token PIN (never sent to the cloud)")
    {
        Title = "Token PIN";
        Width = 420;
        Height = 260;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.NoResize;

        var root = new WpfStackPanel { Margin = new Thickness(16) };
        root.Children.Add(new WpfTextBlock
        {
            Text = prompt,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8),
        });
        PinBox = new WpfPasswordBox { Margin = new Thickness(0, 0, 0, 12) };
        root.Children.Add(PinBox);

        RememberBox = new WpfCheckBox
        {
            Content = "Remember PIN on this PC (Windows DPAPI — local only)",
            Margin = new Thickness(0, 0, 0, 8),
        };
        root.Children.Add(RememberBox);

        var timeoutRow = new WpfStackPanel
        {
            Orientation = WpfOrientation.Horizontal,
            Margin = new Thickness(0, 0, 0, 12),
        };
        timeoutRow.Children.Add(new WpfTextBlock
        {
            Text = "Keep for:",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
        });
        TimeoutBox = new WpfComboBox
        {
            Width = 200,
            IsEnabled = false,
            SelectedIndex = 1,
        };
        TimeoutBox.Items.Add(new WpfComboBoxItem { Content = "This session only", Tag = 0 });
        TimeoutBox.Items.Add(new WpfComboBoxItem { Content = "15 minutes", Tag = 15 });
        TimeoutBox.Items.Add(new WpfComboBoxItem { Content = "60 minutes", Tag = 60 });
        TimeoutBox.Items.Add(new WpfComboBoxItem { Content = "8 hours", Tag = 480 });
        RememberBox.Checked += (_, _) => TimeoutBox.IsEnabled = true;
        RememberBox.Unchecked += (_, _) => TimeoutBox.IsEnabled = false;
        timeoutRow.Children.Add(TimeoutBox);
        root.Children.Add(timeoutRow);

        var buttons = new WpfStackPanel
        {
            Orientation = WpfOrientation.Horizontal,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
        };
        var ok = new WpfButton
        {
            Content = "Unlock",
            Width = 90,
            IsDefault = true,
            Margin = new Thickness(0, 0, 8, 0),
        };
        var cancel = new WpfButton { Content = "Cancel", Width = 90, IsCancel = true };
        ok.Click += (_, _) =>
        {
            if (string.IsNullOrEmpty(Pin))
            {
                System.Windows.MessageBox.Show(
                    this,
                    "PIN is required.",
                    "PIN",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }

            if (RememberPin && TimeoutBox.SelectedItem is WpfComboBoxItem item && item.Tag is int mins)
                RememberMinutes = mins;
            DialogResult = true;
        };
        buttons.Children.Add(ok);
        buttons.Children.Add(cancel);
        root.Children.Add(buttons);
        Content = root;
        Loaded += (_, _) => PinBox.Focus();
    }

    private WpfPasswordBox PinBox { get; }
    private WpfCheckBox RememberBox { get; }
    private WpfComboBox TimeoutBox { get; }
}
