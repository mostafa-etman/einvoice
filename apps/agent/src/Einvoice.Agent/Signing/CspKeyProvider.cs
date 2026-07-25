using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Windows certificate store / CSP-CNG fallback when PKCS#11 cannot open the token.
/// Expects the eSeal cert to be visible in CurrentUser\My after vendor CSP install.
/// </summary>
public sealed class CspKeyProvider : ITokenKeyProvider
{
    private readonly string? _subjectFilter;
    private readonly string? _thumbprint;

    public CspKeyProvider(string? subjectFilter = null, string? thumbprint = null)
    {
        _subjectFilter = subjectFilter;
        _thumbprint = NormalizeThumb(thumbprint);
    }

    public object LoadSigningKey() =>
        throw new InvalidOperationException("Use Acquire(pin) — PIN may be prompted by the CSP UI.");

    public TokenSigningContext Acquire(string pin)
    {
        // Many CSPs prompt for PIN themselves; we still accept an explicit PIN
        // for vendors that support set-pin via CNG (best-effort, optional).
        _ = pin;

        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadOnly);

        X509Certificate2? match = null;
        foreach (var cert in store.Certificates)
        {
            if (!cert.HasPrivateKey) continue;
            if (!MatchesFilter(cert)) continue;
            match = cert;
            break;
        }

        if (match is null)
        {
            throw new InvalidOperationException(
                "No matching certificate with a private key in CurrentUser\\My. " +
                "Install the eSeal CSP/middleware and ensure the cert is imported. " +
                "Set EINVOICE_CERT_FILTER or EINVOICE_CERT_THUMBPRINT if multiple certs exist.");
        }

        // Copy so store dispose does not free the key handle we need.
        var working = new X509Certificate2(match.Export(X509ContentType.Cert));
        // Re-bind private key from store cert
        working = match;

        var rsa = working.GetRSAPrivateKey()
            ?? throw new InvalidOperationException("Certificate has no RSA private key via CSP/CNG.");

        var factory = new DotNetRsaSignatureFactory(rsa);
        var ctx = new TokenSigningContext
        {
            Certificate = new X509Certificate2(working),
            SignatureFactory = factory,
            Source = "CSP/CNG:CurrentUser\\My",
        };
        ctx.SetDisposer(() =>
        {
            rsa.Dispose();
        });
        return ctx;
    }

    private bool MatchesFilter(X509Certificate2 cert)
    {
        if (!string.IsNullOrWhiteSpace(_thumbprint))
            return string.Equals(NormalizeThumb(cert.Thumbprint), _thumbprint, StringComparison.OrdinalIgnoreCase);

        if (string.IsNullOrWhiteSpace(_subjectFilter))
            return true;

        var hay = $"{cert.Subject} {cert.Issuer}";
        return hay.Contains(_subjectFilter, StringComparison.OrdinalIgnoreCase);
    }

    private static string? NormalizeThumb(string? t) =>
        string.IsNullOrWhiteSpace(t) ? null : t.Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant();
}
