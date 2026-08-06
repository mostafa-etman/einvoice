using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Einvoice.Agent.Channel;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Einvoice.Agent.Tests;

public class OfflineIdempotencyHeaderTests
{
    private sealed class CaptureHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            LastRequest = request;
            var res = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{}"),
            };
            return Task.FromResult(res);
        }
    }

    [Fact]
    public async Task SubmitAsync_sends_Idempotency_Key_header()
    {
        var handler = new CaptureHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") };
        using var client = new AgentApiClient("http://localhost", "tok", http);

        await client.SubmitAsync(
            "job-1",
            new JObject { ["documentId"] = "d1" },
            "d1:v3");

        Assert.NotNull(handler.LastRequest);
        Assert.True(handler.LastRequest!.Headers.Contains("Idempotency-Key"));
        Assert.Equal(
            "d1:v3",
            handler.LastRequest.Headers.GetValues("Idempotency-Key").Single());
    }
}
