using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Einvoice.Agent.Channel;

public sealed class AgentApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    public bool IsUnpaired { get; private set; }

    public AgentApiClient(string baseUrl, string? deviceToken = null, HttpClient? httpClient = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseUrl);
        _ownsHttp = httpClient is null;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        _http.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
        if (!string.IsNullOrWhiteSpace(deviceToken))
            SetDeviceToken(deviceToken);
    }

    public void SetDeviceToken(string deviceToken)
    {
        IsUnpaired = false;
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", deviceToken);
    }

    public void ClearDeviceToken()
    {
        _http.DefaultRequestHeaders.Authorization = null;
        IsUnpaired = true;
    }

    public async Task<JObject> PairAsync(
        string pairingCode,
        string label,
        string? machineFingerprint = null,
        CancellationToken cancellationToken = default)
    {
        var body = new JObject
        {
            ["pairingCode"] = pairingCode,
            ["label"] = label,
        };
        if (machineFingerprint is not null)
            body["machineFingerprint"] = machineFingerprint;

        var previous = _http.DefaultRequestHeaders.Authorization;
        _http.DefaultRequestHeaders.Authorization = null;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "agent/pair")
            {
                Content = JsonContent(body),
            };
            return await SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _http.DefaultRequestHeaders.Authorization = previous;
        }
    }

    public Task<JObject> HeartbeatAsync(object? ready = null, CancellationToken cancellationToken = default)
    {
        var body = new JObject();
        if (ready is not null)
            body["ready"] = ready is JToken jt ? jt : JToken.FromObject(ready);
        return PostAsync("agent/heartbeat", body, cancellationToken);
    }

    public Task<JObject> ClaimAsync(int max = 1, CancellationToken cancellationToken = default) =>
        PostAsync("agent/jobs/claim", new JObject { ["max"] = max }, cancellationToken);

    public Task<JObject> SubmitAsync(string jobId, object submitBody, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        var body = submitBody is JToken jt ? jt : JToken.FromObject(submitBody);
        return PostAsync($"agent/jobs/{Uri.EscapeDataString(jobId)}/submit", body, cancellationToken);
    }

    public Task<JObject> FailAsync(
        string jobId,
        string code,
        string message,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        return PostAsync(
            $"agent/jobs/{Uri.EscapeDataString(jobId)}/fail",
            new JObject { ["code"] = code, ["message"] = message },
            cancellationToken);
    }

    private async Task<JObject> PostAsync(string path, JToken body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent(body),
        };
        return await SendAsync(request, cancellationToken).ConfigureAwait(false);
    }

    private async Task<JObject> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if ((int)response.StatusCode == 401)
        {
            IsUnpaired = true;
            throw new DeviceUnauthorizedException(
                $"Agent API unauthorized (401) for {request.Method} {request.RequestUri}: {text}");
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Agent API {request.Method} {request.RequestUri} failed: {(int)response.StatusCode} {text}");
        }

        return string.IsNullOrWhiteSpace(text) ? new JObject() : JObject.Parse(text);
    }

    private static StringContent JsonContent(JToken body) =>
        new(body.ToString(Formatting.None), Encoding.UTF8, "application/json");

    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }
}

public sealed class DeviceUnauthorizedException : Exception
{
    public DeviceUnauthorizedException(string message) : base(message) { }
}
