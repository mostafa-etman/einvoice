using System.Net.Http.Headers;
using System.Text;
using Einvoice.Agent.Security;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Einvoice.Agent.Channel;

/// <summary>
/// Long-lived HTTP client for the cloud agent API.
/// <see cref="HttpClient.BaseAddress"/> and <see cref="HttpClient.Timeout"/> are
/// never mutated after construction — those properties throw
/// "This instance has already started one or more requests" once any call has
/// been sent (heartbeat/claim while unpaired, then Pair).
/// Base URL and bearer token live on this type and are applied to a <b>new</b>
/// <see cref="HttpRequestMessage"/> per call.
/// </summary>
public sealed class AgentApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private readonly object _sync = new();
    private Uri _baseUri;
    private string? _deviceToken;
    private bool _unpaired;
    private int _pairingInFlight;

    public AgentApiClient(string baseUrl, string? deviceToken = null, HttpClient? httpClient = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseUrl);
        _ownsHttp = httpClient is null;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        _baseUri = NormalizeBaseUri(baseUrl);
        if (!string.IsNullOrWhiteSpace(deviceToken))
            SetDeviceToken(deviceToken);
    }

    public bool IsUnpaired
    {
        get { lock (_sync) return _unpaired; }
    }

    public bool IsPairing => Volatile.Read(ref _pairingInFlight) != 0;

    public Uri BaseUri
    {
        get { lock (_sync) return _baseUri; }
    }

    public void SetDeviceToken(string deviceToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceToken);
        lock (_sync)
        {
            _deviceToken = deviceToken;
            _unpaired = false;
        }
    }

    /// <summary>
    /// Update cloud API base (HTTPS). Used when the user changes the server URL at pairing.
    /// Must not assign <see cref="HttpClient.BaseAddress"/> after the first request.
    /// </summary>
    public void SetBaseUrl(string baseUrl)
    {
        var uri = NormalizeBaseUri(baseUrl);
        lock (_sync)
        {
            _baseUri = uri;
        }
    }

    public void ClearDeviceToken()
    {
        lock (_sync)
        {
            _deviceToken = null;
            _unpaired = true;
        }
    }

    /// <summary>Revoke this device on the server. Local store must be cleared by the caller.</summary>
    public Task<JObject> UnpairAsync(CancellationToken cancellationToken = default) =>
        PostAsync("agent/unpair", new JObject(), idempotencyKey: null, authorize: true, cancellationToken);

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

        PinGuard.AssertNoPinInPayload(body);

        if (!TryBeginPairing())
            throw new InvalidOperationException("A pairing request is already in progress.");
        try
        {
            return await PostAsync(
                "agent/pair",
                body,
                idempotencyKey: null,
                authorize: false,
                cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            EndPairing();
        }
    }

    public bool TryBeginPairing() => Interlocked.CompareExchange(ref _pairingInFlight, 1, 0) == 0;

    public void EndPairing() => Interlocked.Exchange(ref _pairingInFlight, 0);

    public Task<JObject> HeartbeatAsync(object? ready = null, CancellationToken cancellationToken = default)
    {
        var body = new JObject();
        if (ready is not null)
            body["ready"] = ready is JToken jt ? jt : JToken.FromObject(ready);
        PinGuard.AssertNoPinInPayload(body);
        return PostAsync("agent/heartbeat", body, idempotencyKey: null, authorize: true, cancellationToken);
    }

    public Task<JObject> ClaimAsync(int max = 1, CancellationToken cancellationToken = default) =>
        PostAsync("agent/jobs/claim", new JObject { ["max"] = max }, idempotencyKey: null, authorize: true, cancellationToken);

    public Task<JObject> SubmitAsync(
        string jobId,
        object submitBody,
        CancellationToken cancellationToken = default) =>
        SubmitAsync(jobId, submitBody, idempotencyKey: null, cancellationToken);

    public Task<JObject> SubmitAsync(
        string jobId,
        object submitBody,
        string? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        var body = submitBody is JToken jt ? jt : JToken.FromObject(submitBody);
        PinGuard.AssertNoPinInPayload(body);
        return PostAsync(
            $"agent/jobs/{Uri.EscapeDataString(jobId)}/submit",
            body,
            idempotencyKey,
            authorize: true,
            cancellationToken);
    }

    public Task<JObject> FailAsync(
        string jobId,
        string code,
        string message,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        var body = new JObject
        {
            ["code"] = code,
            ["message"] = PinGuard.Redact(message),
        };
        PinGuard.AssertNoPinInPayload(body);
        return PostAsync(
            $"agent/jobs/{Uri.EscapeDataString(jobId)}/fail",
            body,
            idempotencyKey: null,
            authorize: true,
            cancellationToken);
    }

    private async Task<JObject> PostAsync(
        string path,
        JToken body,
        string? idempotencyKey,
        bool authorize,
        CancellationToken cancellationToken)
    {
        PinGuard.AssertNoPinInPayload(body);
        using var request = CreatePost(path, body, idempotencyKey, authorize);
        return await SendAsync(request, cancellationToken).ConfigureAwait(false);
    }

    private HttpRequestMessage CreatePost(string path, JToken body, string? idempotencyKey, bool authorize)
    {
        Uri baseUri;
        string? token;
        bool unpaired;
        lock (_sync)
        {
            baseUri = _baseUri;
            token = _deviceToken;
            unpaired = _unpaired;
        }

        var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, path))
        {
            Content = JsonContent(body),
        };
        if (authorize && !unpaired && !string.IsNullOrWhiteSpace(token))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
            request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        return request;
    }

    private async Task<JObject> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if ((int)response.StatusCode == 401)
        {
            var sentToken = request.Headers.Authorization?.Parameter;
            var currentTokenRejected = false;
            lock (_sync)
            {
                currentTokenRejected = !string.IsNullOrEmpty(sentToken)
                    && string.Equals(sentToken, _deviceToken, StringComparison.Ordinal);
                if (currentTokenRejected)
                {
                    _deviceToken = null;
                    _unpaired = true;
                }
            }

            if (currentTokenRejected)
            {
                throw new DeviceUnauthorizedException(
                    $"Agent API unauthorized (401) for {request.Method} {request.RequestUri}: {text}");
            }

            throw new HttpRequestException(
                $"Agent API {request.Method} {request.RequestUri} failed: 401 {text}");
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Agent API {request.Method} {request.RequestUri} failed: {(int)response.StatusCode} {text}");
        }

        return string.IsNullOrWhiteSpace(text) ? new JObject() : JObject.Parse(text);
    }

    private static Uri NormalizeBaseUri(string baseUrl)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseUrl);
        return new Uri(baseUrl.TrimEnd('/') + "/", UriKind.Absolute);
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
