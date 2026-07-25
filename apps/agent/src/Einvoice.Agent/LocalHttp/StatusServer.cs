using System.Net;
using System.Text;
using System.Text.Json;

namespace Einvoice.Agent.LocalHttp;

/// <summary>Loopback-only status HTTP (FR-017). No secrets in responses.</summary>
public sealed class StatusServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private CancellationTokenSource? _cts;

    public StatusServer(int port = 17865)
    {
        _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
    }

    public void Start(Func<object> statusFactory)
    {
        _cts = new CancellationTokenSource();
        _listener.Start();
        _ = Task.Run(() => LoopAsync(statusFactory, _cts.Token));
    }

    private async Task LoopAsync(Func<object> statusFactory, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var ctx = await _listener.GetContextAsync().WaitAsync(ct);
            var json = JsonSerializer.Serialize(statusFactory());
            var bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.ContentType = "application/json";
            ctx.Response.ContentLength64 = bytes.Length;
            await ctx.Response.OutputStream.WriteAsync(bytes, ct);
            ctx.Response.Close();
        }
    }

    public void Dispose()
    {
        _cts?.Cancel();
        if (_listener.IsListening) _listener.Stop();
        _listener.Close();
    }
}
