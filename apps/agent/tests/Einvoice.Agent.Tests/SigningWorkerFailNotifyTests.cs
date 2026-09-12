using System.Net;
using System.Net.Http;
using System.Text;
using Einvoice.Agent.Channel;
using Einvoice.Agent.Config;
using Einvoice.Agent.Queue;
using Einvoice.Agent.Signing;
using Einvoice.Agent.Workers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Einvoice.Agent.Tests;

public class SigningWorkerFailNotifyTests
{
    private sealed class ScriptedHandler : HttpMessageHandler
    {
        public List<string> Paths { get; } = [];
        public TaskCompletionSource<bool> FailCalled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? "";
            Paths.Add(path);
            if (path.Contains("/fail", StringComparison.Ordinal))
                FailCalled.TrySetResult(true);

            var json = path.EndsWith("/agent/jobs/claim", StringComparison.Ordinal)
                ? """{"jobs":[]}"""
                : """{"ok":true}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        }
    }

    private sealed class ThrowingSigner : ISigningProvider
    {
        public string ProviderId => "software";
        public string DisplayName => "throw";
        public bool RequiresPin => false;
        public bool IsHardwarePathVerified => true;

        public SigningOutcome Sign(byte[] contentUtf8, string? pin) =>
            throw new InvalidOperationException("eSeal token not present");
    }

    [Fact]
    public async Task Sign_failure_awaits_FailAsync_so_the_API_is_notified()
    {
        var handler = new ScriptedHandler();
        using var http = new HttpClient(handler);
        using var api = new AgentApiClient("http://localhost", "device-token", http);
        var dir = Path.Combine(Path.GetTempPath(), "einvoice-fail-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var settings = new AgentSettings { DeviceToken = "device-token", QueueDatabasePath = Path.Combine(dir, "queue.db") };
            using var queue = new SqliteOfflineQueue(settings.QueueDatabasePath);
            queue.Enqueue("job-1", "doc-1", 1, """{"issuer":{"id":"1"}}""");

            var worker = new SigningWorker(
                settings,
                api,
                queue,
                new ThrowingSigner(),
                NullLogger<SigningWorker>.Instance,
                () => null);

            await worker.TickForTestsAsync();

            Assert.True(handler.FailCalled.Task.IsCompleted, "FailAsync must be awaited before the tick returns");
            Assert.Contains(handler.Paths, p => p.Contains("/agent/jobs/job-1/fail", StringComparison.Ordinal));
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* temp */ }
        }
    }
}
