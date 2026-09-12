using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.Text;
using Einvoice.Agent.Channel;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Einvoice.Agent.Tests;

public class AgentApiClientPairingTests
{
    private sealed class ScriptedHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _send;

        public ScriptedHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) =>
            _send = send;

        public ConcurrentQueue<(string Method, string Uri, string? Authorization)> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Enqueue((
                request.Method.Method,
                request.RequestUri?.ToString() ?? "",
                request.Headers.Authorization?.ToString()));
            return await _send(request, cancellationToken).ConfigureAwait(false);
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };

    private static AgentApiClient CreateClient(ScriptedHandler handler, string? token = "old-token")
    {
        var http = new HttpClient(handler);
        return new AgentApiClient("http://localhost", token, http);
    }

    [Fact]
    public async Task HttpClient_BaseAddress_throws_after_the_first_request()
    {
        var handler = new ScriptedHandler((_, _) => Task.FromResult(Json(HttpStatusCode.OK, "{}")));
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") };

        using var started = await http.PostAsync("agent/heartbeat", new StringContent("{}"));
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            http.BaseAddress = new Uri("http://localhost/"));
        Assert.Contains(
            "This instance has already started one or more requests. Properties can only be modified before sending the first request.",
            ex.Message);
    }

    [Fact]
    public async Task Pair_after_heartbeat_can_change_base_url_without_mutating_started_HttpClient()
    {
        var handler = new ScriptedHandler((request, _) =>
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            if (path.EndsWith("/agent/pair", StringComparison.Ordinal))
            {
                return Task.FromResult(Json(
                    HttpStatusCode.OK,
                    """{"deviceToken":"new-token","deviceId":"dev-1","tenantId":"t-1","resumed":false}"""));
            }

            return Task.FromResult(Json(HttpStatusCode.OK, "{}"));
        });
        using var client = CreateClient(handler);

        await client.HeartbeatAsync(new { tokenPresent = true });
        client.ClearDeviceToken();

        var ex = await Record.ExceptionAsync(async () =>
        {
            client.SetBaseUrl("http://localhost");
            var result = await client.PairAsync("fresh-code", "DESKTOP-DRT6JI5", "DESKTOP-DRT6JI5");
            Assert.Equal("new-token", result.Value<string>("deviceToken"));
            client.SetDeviceToken("new-token");
            await client.HeartbeatAsync(new { tokenPresent = true });
        });

        Assert.Null(ex);
        Assert.False(client.IsUnpaired);

        var requests = handler.Requests.ToArray();
        Assert.Equal(3, requests.Length);
        Assert.Contains("/agent/heartbeat", requests[0].Uri, StringComparison.Ordinal);
        Assert.Equal("Bearer old-token", requests[0].Authorization);
        Assert.Contains("/agent/pair", requests[1].Uri, StringComparison.Ordinal);
        Assert.Null(requests[1].Authorization);
        Assert.Contains("/agent/heartbeat", requests[2].Uri, StringComparison.Ordinal);
        Assert.Equal("Bearer new-token", requests[2].Authorization);
    }

    [Fact]
    public async Task Background_heartbeat_cannot_race_SetBaseUrl_or_Pair()
    {
        var heartbeatEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseHeartbeat = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var handler = new ScriptedHandler(async (request, ct) =>
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            if (path.EndsWith("/agent/heartbeat", StringComparison.Ordinal))
            {
                heartbeatEntered.TrySetResult(true);
                await releaseHeartbeat.Task.WaitAsync(ct).ConfigureAwait(false);
                return Json(HttpStatusCode.OK, "{}");
            }

            if (path.EndsWith("/agent/pair", StringComparison.Ordinal))
            {
                return Json(
                    HttpStatusCode.OK,
                    """{"deviceToken":"rotated","deviceId":"dev-1","tenantId":"t-1"}""");
            }

            return Json(HttpStatusCode.OK, "{}");
        });
        using var client = CreateClient(handler, "revoked-token");

        var heartbeatTask = client.HeartbeatAsync();
        await heartbeatEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var raceEx = await Record.ExceptionAsync(async () =>
        {
            client.SetBaseUrl("http://api.example.test");
            client.ClearDeviceToken();
            var paired = await client.PairAsync("new-code", "label", "machine-1");
            Assert.Equal("rotated", paired.Value<string>("deviceToken"));
            client.SetDeviceToken("rotated");
        });

        releaseHeartbeat.TrySetResult(true);
        await heartbeatTask;

        Assert.Null(raceEx);
        Assert.Equal("http://api.example.test/", client.BaseUri.ToString());

        var pair = handler.Requests.First(r => r.Uri.Contains("/agent/pair", StringComparison.Ordinal));
        Assert.StartsWith("http://api.example.test/", pair.Uri, StringComparison.Ordinal);
        Assert.Null(pair.Authorization);
    }

    [Fact]
    public async Task Failed_pair_does_not_replace_the_existing_device_token()
    {
        var handler = new ScriptedHandler((request, _) =>
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            if (path.EndsWith("/agent/pair", StringComparison.Ordinal))
                return Task.FromResult(Json(HttpStatusCode.BadRequest, """{"message":"Invalid pairing code"}"""));
            return Task.FromResult(Json(HttpStatusCode.OK, "{}"));
        });
        using var client = CreateClient(handler, "keep-me");

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            client.PairAsync("bad-code", "label", "machine-1"));

        Assert.False(client.IsUnpaired);
        await client.HeartbeatAsync();
        Assert.Equal("Bearer keep-me", handler.Requests.Last().Authorization);
    }

    [Fact]
    public async Task Current_token_401_drops_auth_so_pair_sends_no_bearer()
    {
        var handler = new ScriptedHandler((request, _) =>
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            if (path.EndsWith("/agent/heartbeat", StringComparison.Ordinal)
                && request.Headers.Authorization?.Parameter == "revoked-token")
            {
                return Task.FromResult(Json(HttpStatusCode.Unauthorized, """{"statusCode":401}"""));
            }

            if (path.EndsWith("/agent/pair", StringComparison.Ordinal))
            {
                Assert.Null(request.Headers.Authorization);
                return Task.FromResult(Json(
                    HttpStatusCode.OK,
                    """{"deviceToken":"fresh-token","deviceId":"dev-1","tenantId":"t-1"}"""));
            }

            return Task.FromResult(Json(HttpStatusCode.OK, "{}"));
        });
        using var client = CreateClient(handler, "revoked-token");

        await Assert.ThrowsAsync<DeviceUnauthorizedException>(() => client.HeartbeatAsync());
        Assert.True(client.IsUnpaired);

        var paired = await client.PairAsync("new-code", "label", "machine-1");
        Assert.Equal("fresh-token", paired.Value<string>("deviceToken"));
        client.SetDeviceToken("fresh-token");
        await client.HeartbeatAsync();

        Assert.Equal("Bearer fresh-token", handler.Requests.Last().Authorization);
        Assert.False(client.IsUnpaired);
    }

    [Fact]
    public async Task Stale_401_after_re_pair_does_not_clear_the_new_token()
    {
        var heartbeatEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseHeartbeat = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var handler = new ScriptedHandler(async (request, ct) =>
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            var token = request.Headers.Authorization?.Parameter;
            if (path.EndsWith("/agent/heartbeat", StringComparison.Ordinal) && token == "old-token")
            {
                heartbeatEntered.TrySetResult(true);
                await releaseHeartbeat.Task.WaitAsync(ct).ConfigureAwait(false);
                return Json(HttpStatusCode.Unauthorized, """{"statusCode":401}""");
            }

            return Json(HttpStatusCode.OK, "{}");
        });
        using var client = CreateClient(handler, "old-token");

        var staleHeartbeat = client.HeartbeatAsync();
        await heartbeatEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        client.SetDeviceToken("new-token");
        releaseHeartbeat.TrySetResult(true);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => staleHeartbeat);
        Assert.Contains("401", ex.Message);
        Assert.False(client.IsUnpaired);

        await client.HeartbeatAsync();
        Assert.Equal("Bearer new-token", handler.Requests.Last().Authorization);
    }

    [Fact]
    public async Task Concurrent_pair_attempts_are_rejected_without_a_second_request()
    {
        var pairEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releasePair = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var pairCalls = 0;

        var handler = new ScriptedHandler(async (request, ct) =>
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/agent/pair", StringComparison.Ordinal))
            {
                Interlocked.Increment(ref pairCalls);
                pairEntered.TrySetResult(true);
                await releasePair.Task.WaitAsync(ct).ConfigureAwait(false);
                return Json(
                    HttpStatusCode.OK,
                    """{"deviceToken":"only-once","deviceId":"dev-1","tenantId":"t-1"}""");
            }

            return Json(HttpStatusCode.OK, "{}");
        });
        using var client = CreateClient(handler, token: null);

        var first = client.PairAsync("code-a", "label", "machine-1");
        await pairEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var secondEx = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            client.PairAsync("code-b", "label", "machine-1"));
        Assert.Contains("already in progress", secondEx.Message, StringComparison.OrdinalIgnoreCase);

        releasePair.TrySetResult(true);
        var result = await first;
        Assert.Equal("only-once", result.Value<string>("deviceToken"));
        Assert.Equal(1, pairCalls);
    }
}
