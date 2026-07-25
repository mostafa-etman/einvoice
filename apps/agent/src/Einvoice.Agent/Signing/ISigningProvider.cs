using System.Security.Cryptography.X509Certificates;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Single abstraction for producing CAdES-BES detached signatures.
/// Downstream (SignPipeline, SigningWorker, jobs) depends only on this.
/// </summary>
public interface ISigningProvider
{
    /// <summary>Config id: <c>software</c> or <c>pkcs11</c>.</summary>
    string ProviderId { get; }

    /// <summary>Human-readable label for logs / tray (never includes PIN).</summary>
    string DisplayName { get; }

    /// <summary>True when a local PIN must be supplied before <see cref="Sign"/>.</summary>
    bool RequiresPin { get; }

    /// <summary>
    /// False until a physical eSeal token has been confirmed in the field.
    /// Software provider is always verified for CI/dev use.
    /// </summary>
    bool IsHardwarePathVerified { get; }

    /// <summary>
    /// Sign UTF-8 canonical bytes (signatures already stripped).
    /// PIN is required when <see cref="RequiresPin"/> is true; ignored for software.
    /// </summary>
    SigningOutcome Sign(byte[] contentUtf8, string? pin);
}

/// <summary>Result of a single CAdES detached sign operation.</summary>
public sealed class SigningOutcome : IDisposable
{
    public required byte[] CadesDer { get; init; }
    public required X509Certificate2 Certificate { get; init; }
    public required string SourceLabel { get; init; }
    private Action? _dispose;

    public void SetDisposer(Action dispose) => _dispose = dispose;

    public void Dispose()
    {
        _dispose?.Invoke();
        Certificate.Dispose();
    }
}
