using Einvoice.Agent.Config;

namespace Einvoice.Agent.Signing;

public enum SigningProviderKind
{
    /// <summary>Committed software RSA test key — default for CI and local progress without a token.</summary>
    Software,

    /// <summary>
    /// Physical eSeal via PKCS#11 (+ CSP fallback). HARDWARE_SIGNING_PENDING / UNVERIFIED
    /// until confirmed on a real token.
    /// </summary>
    Pkcs11,
}

public static class SigningProviderKindExtensions
{
    public static string ToConfigValue(this SigningProviderKind kind) =>
        kind switch
        {
            SigningProviderKind.Software => "software",
            SigningProviderKind.Pkcs11 => "pkcs11",
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

    public static bool TryParse(string? raw, out SigningProviderKind kind)
    {
        kind = SigningProviderKind.Software;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        switch (raw.Trim().ToLowerInvariant())
        {
            case "software":
            case "soft":
            case "pem":
                kind = SigningProviderKind.Software;
                return true;
            case "pkcs11":
            case "pkcs":
            case "token":
            case "hardware":
            case "auto": // legacy: hardware path (PKCS#11 then CSP)
            case "csp":   // legacy: treated as hardware provider (CSP fallback inside)
                kind = SigningProviderKind.Pkcs11;
                return true;
            default:
                return false;
        }
    }
}

/// <summary>Builds the configured <see cref="ISigningProvider"/>.</summary>
public static class SigningProviderFactory
{
    public static ISigningProvider Create(AgentSettings settings) =>
        settings.SigningProvider switch
        {
            SigningProviderKind.Software => new SoftwareKeySigningProvider(settings),
            SigningProviderKind.Pkcs11 => new Pkcs11TokenSigningProvider(settings),
            _ => throw new InvalidOperationException($"Unknown SIGNING_PROVIDER: {settings.SigningProvider}"),
        };
}
