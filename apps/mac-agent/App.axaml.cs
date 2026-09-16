using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace Einvoice.Agent.Mac;

public partial class App : Application
{
    internal AgentSession? Session { get; private set; }

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            Session = new AgentSession(this, desktop);
            Session.Start();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
