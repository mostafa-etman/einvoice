using Einvoice.Agent.Signing;

namespace Einvoice.Agent.Config;

/// <summary>
/// Process settings. Env vars provide defaults; <see cref="LocalAgentConfig"/> overlays
/// non-secret token preferences. The eSeal PIN is never part of this type.
/// </summary>
public sealed class AgentSettings
{
    public const string DefaultApiBaseUrl = "https://api.example.com";

    public string Environment { get; init; } = "Development";
    public string ApiBaseUrl { get; set; } = DefaultApiBaseUrl;
    public string? DeviceToken { get; set; }
    public string DeviceLabel { get; init; } = System.Environment.MachineName;

    /// <summary>Active signing provider. Default: software.</summary>
    public SigningProviderKind SigningProvider { get; set; } = SigningProviderKind.Software;

    /// <summary>PKCS#11 module path. Default probes common ETA token DLLs.</summary>
    public string? Pkcs11LibraryPath { get; set; }

    /// <summary>Optional substring filter on certificate subject/issuer (e.g. Egypt Trust).</summary>
    public string? CertificateSubjectFilter { get; set; }

    /// <summary>Optional filter matching certificate Issuer DN.</summary>
    public string? CertificateIssuerFilter { get; set; }

    /// <summary>Optional certificate thumbprint (SHA-1 hex) to select a specific eSeal cert.</summary>
    public string? CertificateThumbprint { get; set; }

    public string? SoftwareKeyPemPath { get; init; }
    public string? SoftwareCertPemPath { get; init; }

    public string QueueDatabasePath { get; init; } =
        Path.Combine(
            System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
            "Einvoice.Agent",
            "queue.db");

    public string TokenStorePath { get; init; } =
        Path.Combine(
            System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
            "Einvoice.Agent",
            "device.token");

    public string LocalConfigPath { get; init; } = LocalAgentConfig.DefaultPath;

    public int PollIntervalSeconds { get; init; } = 5;
    public int LocalStatusPort { get; init; } = 17865;

    /// <summary>Apply non-secret local config (never contains PIN).</summary>
    public void ApplyLocalConfig(LocalAgentConfig local)
    {
        if (!string.IsNullOrWhiteSpace(local.ApiBaseUrl))
            ApiBaseUrl = NormalizeApiBaseUrl(local.ApiBaseUrl);
        if (!string.IsNullOrWhiteSpace(local.Pkcs11LibraryPath))
            Pkcs11LibraryPath = local.Pkcs11LibraryPath;
        if (!string.IsNullOrWhiteSpace(local.CertificateThumbprint))
            CertificateThumbprint = local.CertificateThumbprint;
        if (!string.IsNullOrWhiteSpace(local.CertificateIssuerFilter))
            CertificateIssuerFilter = local.CertificateIssuerFilter;
        if (!string.IsNullOrWhiteSpace(local.CertificateSubjectFilter))
            CertificateSubjectFilter = local.CertificateSubjectFilter;
        else if (!string.IsNullOrWhiteSpace(local.CertificateIssuerFilter))
            CertificateSubjectFilter = local.CertificateIssuerFilter;
    }

    public static string NormalizeApiBaseUrl(string url)
    {
        var trimmed = url.Trim().TrimEnd('/');
        if (!trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            && !trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = "https://" + trimmed;
        }
        return trimmed;
    }

    public static AgentSettings FromEnvironment(IDictionary<string, string?>? env = null)
    {
        env ??= ProcessEnv();
        string? G(string k) => env.TryGetValue(k, out var v) ? v : null;

        var provider = SigningProviderKind.Software;
        var rawProvider = G("SIGNING_PROVIDER")
            ?? G("EINVOICE_SIGNING_PROVIDER")
            ?? G("EINVOICE_SIGNING_KEY_SOURCE");

        if (SigningProviderKindExtensions.TryParse(rawProvider, out var parsed))
            provider = parsed;
        else if (string.Equals(G("EINVOICE_HARDWARE_TOKEN"), "1", StringComparison.Ordinal))
            provider = SigningProviderKind.Pkcs11;
        else if (string.Equals(G("EINVOICE_USE_SOFTWARE_KEY"), "1", StringComparison.Ordinal))
            provider = SigningProviderKind.Software;

        var envApi = G("EINVOICE_API_BASE_URL") ?? G("API_BASE_URL");
        var settings = new AgentSettings
        {
            Environment = G("AGENT_ENVIRONMENT") ?? "Development",
            ApiBaseUrl = string.IsNullOrWhiteSpace(envApi)
                ? DefaultApiBaseUrl
                : NormalizeApiBaseUrl(envApi),
            DeviceToken = G("EINVOICE_DEVICE_TOKEN"),
            DeviceLabel = G("EINVOICE_DEVICE_LABEL") ?? System.Environment.MachineName,
            SigningProvider = provider,
            Pkcs11LibraryPath = G("EINVOICE_PKCS11_LIBRARY"),
            CertificateSubjectFilter = G("EINVOICE_CERT_FILTER"),
            CertificateIssuerFilter = G("EINVOICE_CERT_ISSUER"),
            CertificateThumbprint = G("EINVOICE_CERT_THUMBPRINT"),
            SoftwareKeyPemPath = G("EINVOICE_SOFTWARE_KEY_PEM"),
            SoftwareCertPemPath = G("EINVOICE_SOFTWARE_CERT_PEM"),
            PollIntervalSeconds = int.TryParse(G("EINVOICE_POLL_INTERVAL_SECONDS"), out var p) ? p : 5,
            LocalStatusPort = int.TryParse(G("EINVOICE_LOCAL_STATUS_PORT"), out var port) ? port : 17865,
        };

        var local = LocalAgentConfig.Load(settings.LocalConfigPath);
        // Env wins over local file when both are set.
        var beforeLocal = settings.ApiBaseUrl;
        settings.ApplyLocalConfig(local);
        if (!string.IsNullOrWhiteSpace(envApi))
            settings.ApiBaseUrl = beforeLocal;
        return settings;
    }

    private static IDictionary<string, string?> ProcessEnv()
    {
        var d = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry e in System.Environment.GetEnvironmentVariables())
            d[e.Key!.ToString()!] = e.Value?.ToString();
        return d;
    }
}
