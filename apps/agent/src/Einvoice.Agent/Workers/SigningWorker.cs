using Einvoice.Agent.Channel;
using Einvoice.Agent.Config;
using Einvoice.Agent.Queue;
using Einvoice.Agent.Security;
using Einvoice.Agent.Signing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Einvoice.Agent.Workers;

/// <summary>
/// Polls cloud for jobs, signs via <see cref="ISigningProvider"/>, uploads through SQLite offline queue.
/// </summary>
public sealed class SigningWorker : BackgroundService
{
    private readonly AgentSettings _settings;
    private readonly AgentApiClient _api;
    private readonly SqliteOfflineQueue _queue;
    private readonly ISigningProvider _signer;
    private readonly ILogger<SigningWorker> _log;
    private readonly Func<string?> _pinProvider;

    public event Action? StateChanged;

    public string StatusText { get; private set; } = "Starting";
    public bool Online { get; private set; }
    public bool HasDeviceToken => !string.IsNullOrWhiteSpace(_settings.DeviceToken) && !_api.IsUnpaired;
    public int PendingCount => _queue.CountPending();
    public string ProviderId => _signer.ProviderId;

    public SigningWorker(
        AgentSettings settings,
        AgentApiClient api,
        SqliteOfflineQueue queue,
        ISigningProvider signer,
        ILogger<SigningWorker> log,
        Func<string?> pinProvider)
    {
        _settings = settings;
        _api = api;
        _queue = queue;
        _signer = signer;
        _log = log;
        _pinProvider = pinProvider;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(Math.Max(2, _settings.PollIntervalSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken).ConfigureAwait(false);
                Online = true;
                var pendingUpload = _queue.ListByState(SqliteOfflineQueue.StatePendingUpload).Count;
                if (!HasDeviceToken)
                    StatusText = "Not paired";
                else if (pendingUpload > 0)
                    StatusText = $"Pending upload ({pendingUpload})";
                else
                    StatusText = "Online";
            }
            catch (DeviceUnauthorizedException)
            {
                Online = false;
                StatusText = "Unpaired / 401";
                _log.LogWarning("Device token rejected (401). Stop uploads until re-paired.");
            }
            catch (Exception ex)
            {
                Online = false;
                StatusText = "Offline / error";
                _log.LogWarning(ex, "Signing worker tick failed");
            }

            StateChanged?.Invoke();
            await Task.Delay(delay, stoppingToken).ConfigureAwait(false);
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        if (!HasDeviceToken) return;

        await HeartbeatSafeAsync(ct).ConfigureAwait(false);
        await ClaimAndEnqueueAsync(ct).ConfigureAwait(false);
        await ProcessPendingSignAsync(ct).ConfigureAwait(false);
        await ProcessPendingUploadAsync(ct).ConfigureAwait(false);
    }

    private async Task HeartbeatSafeAsync(CancellationToken ct)
    {
        try
        {
            await _api.HeartbeatAsync(
                new { tokenPresent = true, pendingLocal = PendingCount },
                ct).ConfigureAwait(false);
        }
        catch (DeviceUnauthorizedException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Heartbeat failed (will retry)");
        }
    }

    private async Task ClaimAndEnqueueAsync(CancellationToken ct)
    {
        JObject claimed;
        try
        {
            claimed = await _api.ClaimAsync(max: 3, ct).ConfigureAwait(false);
        }
        catch (HttpRequestException ex) when (ex.Message.Contains("401"))
        {
            throw new DeviceUnauthorizedException(ex.Message);
        }

        var jobs = claimed["jobs"] as JArray;
        if (jobs is null || jobs.Count == 0) return;

        foreach (var job in jobs)
        {
            var jobId = job.Value<string>("jobId") ?? job.Value<string>("id");
            var documentId = job.Value<string>("documentId");
            var version = job.Value<int?>("documentVersion") ?? job.Value<int?>("version") ?? 0;
            // etaPayloadText carries the cloud's exact document bytes. Field order
            // is part of the ETA canonical string, so re-serializing an object
            // (etaPayload) can change what we sign. Prefer the raw text.
            var payload = job.Value<string>("etaPayloadText")
                ?? job["etaPayload"]?.ToString(Formatting.None)
                ?? job["payload"]?.ToString(Formatting.None);
            if (jobId is null || documentId is null || string.IsNullOrWhiteSpace(payload)) continue;

            _queue.Enqueue(jobId, documentId, version, payload);
            _log.LogInformation("Enqueued job {JobId} for document {DocumentId}", jobId, documentId);
        }
    }

    private Task ProcessPendingSignAsync(CancellationToken ct)
    {
        foreach (var item in _queue.ListByState(SqliteOfflineQueue.StatePendingSign))
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var pin = _signer.RequiresPin ? _pinProvider() : null;
                var result = SignPipeline.SignDocumentJson(item.PayloadJson, _signer, pin);
                var signedEnvelope = new JObject
                {
                    ["documentId"] = item.DocumentId,
                    ["documentVersion"] = item.DocumentVersion,
                    ["signatureType"] = result.SignatureType,
                    ["cadesBase64"] = result.CadesBase64,
                    ["certificateThumbprint"] = result.CertificateThumbprint,
                    ["signingSource"] = result.SourceLabel,
                    ["signingProvider"] = _signer.ProviderId,
                    ["hardwareVerified"] = _signer.IsHardwarePathVerified,
                };
                _queue.MarkSigned(item.Id, signedEnvelope.ToString(Formatting.None));
                _log.LogInformation(
                    "Signed job {JobId} via provider={Provider} source={Source}",
                    item.JobId,
                    _signer.ProviderId,
                    result.SourceLabel);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Sign failed for job {JobId}", item.JobId);
                var safeMessage = PinGuard.Redact(ex.Message);
                _queue.MarkAttemptFailed(item.Id, safeMessage, dead: false);
                try
                {
                    _ = _api.FailAsync(item.JobId, "SIGN_FAILED", safeMessage, ct);
                }
                catch (Exception failEx)
                {
                    _log.LogDebug(failEx, "Fail notify skipped");
                }
            }
        }

        return Task.CompletedTask;
    }

    private async Task ProcessPendingUploadAsync(CancellationToken ct)
    {
        foreach (var item in _queue.ListByState(SqliteOfflineQueue.StatePendingUpload))
        {
            ct.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(item.SignedJson))
            {
                _queue.MarkAttemptFailed(item.Id, "missing signed json", dead: true);
                continue;
            }

            try
            {
                var body = JObject.Parse(item.SignedJson);
                var idempotencyKey = $"{item.DocumentId}:v{item.DocumentVersion}";
                await _api.SubmitAsync(item.JobId, body, idempotencyKey, ct).ConfigureAwait(false);
                _queue.MarkDone(item.Id);
                _log.LogInformation("Uploaded signature for job {JobId}", item.JobId);
            }
            catch (DeviceUnauthorizedException)
            {
                throw;
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("409"))
            {
                _queue.CancelJob(item.JobId, "version conflict / stale job: " + ex.Message);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("404"))
            {
                _queue.CancelJob(item.JobId, "job cancelled or missing: " + ex.Message);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Upload failed for job {JobId}", item.JobId);
                _queue.MarkAttemptFailed(item.Id, ex.Message, dead: false);
            }
        }
    }
}
