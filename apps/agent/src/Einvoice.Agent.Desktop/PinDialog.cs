using System.Windows;
using System.Windows.Controls;

namespace Einvoice.Agent.Desktop;

public partial class PinDialog : Window
{
    public string Pin => PinBox.Password;

    public PinDialog(string prompt = "Enter eSeal token PIN")
    {
        Title = "Token PIN";
        Width = 360;
        Height = 180;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.NoResize;

        var root = new StackPanel { Margin = new Thickness(16) };
        root.Children.Add(new TextBlock
        {
            Text = prompt,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8),
        });
        PinBox = new PasswordBox { Margin = new Thickness(0, 0, 0, 12) };
        root.Children.Add(PinBox);

        var buttons = new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
        };
        var ok = new System.Windows.Controls.Button
        {
            Content = "Unlock",
            Width = 90,
            IsDefault = true,
            Margin = new Thickness(0, 0, 8, 0),
        };
        var cancel = new System.Windows.Controls.Button { Content = "Cancel", Width = 90, IsCancel = true };
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

            DialogResult = true;
        };
        buttons.Children.Add(ok);
        buttons.Children.Add(cancel);
        root.Children.Add(buttons);
        Content = root;
        Loaded += (_, _) => PinBox.Focus();
    }

    private PasswordBox PinBox { get; }
}
