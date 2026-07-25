using Einvoice.Agent.LocalHttp;
using Xunit;

namespace Einvoice.Agent.Tests;

public class LocalStatusHttpTests
{
    [Fact]
    public async Task Loopback_status_returns_json_without_token_fields()
    {
        var port = 17866 + Random.Shared.Next(0, 200);
        using var server = new StatusServer(port);
        server.Start(() => new { paired = true, online = false, pendingLocal = 0 });

        using var client = new HttpClient();
        var json = await client.GetStringAsync($"http://127.0.0.1:{port}/");
        Assert.Contains("paired", json);
        Assert.DoesNotContain("deviceToken", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Bearer", json, StringComparison.OrdinalIgnoreCase);
    }
}
