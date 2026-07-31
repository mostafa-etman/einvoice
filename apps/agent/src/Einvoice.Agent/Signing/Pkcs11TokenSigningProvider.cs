using Einvoice.Agent.Config;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Hardware eSeal signing via PKCS#11 (<c>eps2003csp11.dll</c> / <c>SignatureP11.dll</c>),
/// with Windows CSP/CNG fallback when PKCS#11 cannot open the inserted token.
/// </summary>
/// <remarks>
/// <para>
/// <b>HARDWARE_SIGNING_PENDING</b> — Structure, library probe, cert selection, and PIN
/// login are implemented. End-to-end cryptographic signing on a physical token is
/// <b>UNVERIFIED</b> until confirmed with a real eSeal (see
/// <c>specs/006-desktop-signing-agent/HARDWARE-TEST.md</c>).
/// Do not treat this provider as production-ready until that confirmation.
/// </para>
/// </remarks>
public sealed class Pkcs11TokenSigningProvider : ISigningProvider
{
    public const string HardwarePendingMarker = "HARDWARE_SIGNING_PENDING";

    private readonly AgentSettings _settings;

    public Pkcs11TokenSigningProvider(AgentSettings settings) => _settings = settings;

    public string ProviderId => SigningProviderKind.Pkcs11.ToConfigValue();
    public string DisplayName => $"PKCS#11/CSP ({HardwarePendingMarker} — UNVERIFIED)";
    public bool RequiresPin => true;

    /// <inheritdoc />
    /// <remarks>Always false until field confirmation on a physical token.</remarks>
    public bool IsHardwarePathVerified => false;

    /// <summary>
    /// Resolve PKCS#11 module path (config or well-known ETA DLL names).
    /// Does not require a token to be inserted.
    /// </summary>
    public string? ResolveLibraryPath() =>
        _settings.Pkcs11LibraryPath ?? Pkcs11KeyProvider.ProbeDefaultLibraryPath();

    /// <summary>
    /// True when a candidate PKCS#11 DLL exists on disk (middleware installed).
    /// Does not prove a token is present or that signing works.
    /// </summary>
    public bool IsLibraryAvailable()
    {
        var path = ResolveLibraryPath();
        return !string.IsNullOrWhiteSpace(path) && File.Exists(path);
    }

    /// <summary>
    /// Describe readiness without performing a private-key operation.
    /// Safe to call when no token is present.
    /// </summary>
    public HardwareReadinessReport ProbeReadiness()
    {
        var lib = ResolveLibraryPath();
        return new HardwareReadinessReport(
            Marker: HardwarePendingMarker,
            Verified: false,
            LibraryPath: lib,
            LibraryFound: !string.IsNullOrWhiteSpace(lib) && File.Exists(lib!),
            CertFilter: _settings.CertificateSubjectFilter,
            CertThumbprint: _settings.CertificateThumbprint,
            Notes:
                "UNVERIFIED: insert eSeal token, set SIGNING_PROVIDER=pkcs11, enter PIN, " +
                "run HARDWARE-TEST.md (pair → PIN → sign gv-01 → CAdES checklist → ETA sandbox).");
    }

    public SigningOutcome Sign(byte[] contentUtf8, string? pin)
    {
        ArgumentNullException.ThrowIfNull(contentUtf8);
        if (string.IsNullOrEmpty(pin))
            throw new InvalidOperationException(
                $"{HardwarePendingMarker}: PIN is required for PKCS#11/CSP token signing.");

        // Prefer PKCS#11; fall back to CSP when PKCS#11 cannot open the token.
        Exception? pkcs11Error = null;
        var lib = ResolveLibraryPath();
        if (!string.IsNullOrWhiteSpace(lib) && File.Exists(lib))
        {
            try
            {
                return SignViaPkcs11(contentUtf8, pin, lib);
            }
            catch (Exception ex)
            {
                pkcs11Error = ex;
            }
        }

        try
        {
            return SignViaCsp(contentUtf8, pin);
        }
        catch (Exception cspEx)
        {
            var msg =
                $"{HardwarePendingMarker}: PKCS#11 and CSP signing both failed (UNVERIFIED hardware path).";
            if (pkcs11Error is not null)
                msg += $" PKCS#11: {pkcs11Error.Message}.";
            else if (string.IsNullOrWhiteSpace(lib))
                msg += " PKCS#11 library not found (set EINVOICE_PKCS11_LIBRARY).";
            msg += $" CSP: {cspEx.Message}";
            throw new InvalidOperationException(msg, cspEx);
        }
    }

    private SigningOutcome SignViaPkcs11(byte[] contentUtf8, string pin, string libraryPath)
    {
        var filter = _settings.CertificateSubjectFilter ?? _settings.CertificateIssuerFilter;
        var provider = new Pkcs11KeyProvider(
            libraryPath,
            filter,
            _settings.CertificateThumbprint)
        {
            IssuerFilter = _settings.CertificateIssuerFilter,
        };
        using var ctx = provider.Acquire(pin);
        var der = SigningMaterialResolver.SignContent(ctx, contentUtf8);
        var cert = new System.Security.Cryptography.X509Certificates.X509Certificate2(ctx.Certificate.RawData);
        return new SigningOutcome
        {
            CadesDer = der,
            Certificate = cert,
            SourceLabel = $"{ctx.Source}|{HardwarePendingMarker}",
        };
    }

    private SigningOutcome SignViaCsp(byte[] contentUtf8, string pin)
    {
        var provider = new CspKeyProvider(_settings.CertificateSubjectFilter, _settings.CertificateThumbprint);
        using var ctx = provider.Acquire(pin);
        var der = SigningMaterialResolver.SignContent(ctx, contentUtf8);
        var cert = new System.Security.Cryptography.X509Certificates.X509Certificate2(ctx.Certificate.RawData);
        return new SigningOutcome
        {
            CadesDer = der,
            Certificate = cert,
            SourceLabel = $"{ctx.Source}|{HardwarePendingMarker}",
        };
    }
}

public sealed record HardwareReadinessReport(
    string Marker,
    bool Verified,
    string? LibraryPath,
    bool LibraryFound,
    string? CertFilter,
    string? CertThumbprint,
    string Notes);
