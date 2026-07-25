namespace Einvoice.Agent.Config;

/// <summary>
/// Preferred config: <c>SIGNING_PROVIDER=software|pkcs11</c>
/// (aliases: <c>EINVOICE_SIGNING_PROVIDER</c>, legacy <c>EINVOICE_SIGNING_KEY_SOURCE</c>).
/// Default is <see cref="Signing.SigningProviderKind.Software"/> so progress is not blocked without a token.
/// </summary>
public sealed class AgentSettings
{
    public string Environment { get; init; } = "Development";
    public string ApiBaseUrl { get; init; } = "http://localhost:3001";
    public string? DeviceToken { get; set; }
    public string DeviceLabel { get; init; } = System.Environment.MachineName;

    /// <summary>Active signing provider. Default: software.</summary>
    public Signing.SigningProviderKind SigningProvider { get; init; } =
        Signing.SigningProviderKind.Software;

    /// <summary>PKCS#11 module path. Default probes common ETA token DLLs.</summary>
    public string? Pkcs11LibraryPath { get; init; }

    /// <summary>Optional substring filter on certificate subject/issuer (e.g. Egypt Trust).</summary>
    public string? CertificateSubjectFilter { get; init; }

    /// <summary>Optional certificate thumbprint (SHA-1 hex) to select a specific eSeal cert.</summary>
    public string? CertificateThumbprint { get; init; }

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

    public int PollIntervalSeconds { get; init; } = 5;
    public int LocalStatusPort { get; init; } = 17865;

    public static AgentSettings FromEnvironment(IDictionary<string, string?>? env = null)
    {
        env ??= ProcessEnv();
        string? G(string k) => env.TryGetValue(k, out var v) ? v : null;

        var provider = Signing.SigningProviderKind.Software;
        var rawProvider = G("SIGNING_PROVIDER")
            ?? G("EINVOICE_SIGNING_PROVIDER")
            ?? G("EINVOICE_SIGNING_KEY_SOURCE");

        if (Signing.SigningProviderKindExtensions.TryParse(rawProvider, out var parsed))
            provider = parsed;
        else if (string.Equals(G("EINVOICE_HARDWARE_TOKEN"), "1", StringComparison.Ordinal))
            provider = Signing.SigningProviderKind.Pkcs11;
        else if (string.Equals(G("EINVOICE_USE_SOFTWARE_KEY"), "1", StringComparison.Ordinal))
            provider = Signing.SigningProviderKind.Software;

        return new AgentSettings
        {
            Environment = G("AGENT_ENVIRONMENT") ?? "Development",
            ApiBaseUrl = G("EINVOICE_API_BASE_URL") ?? G("API_BASE_URL") ?? "http://localhost:3001",
            DeviceToken = G("EINVOICE_DEVICE_TOKEN"),
            DeviceLabel = G("EINVOICE_DEVICE_LABEL") ?? System.Environment.MachineName,
            SigningProvider = provider,
            Pkcs11LibraryPath = G("EINVOICE_PKCS11_LIBRARY"),
            CertificateSubjectFilter = G("EINVOICE_CERT_FILTER"),
            CertificateThumbprint = G("EINVOICE_CERT_THUMBPRINT"),
            SoftwareKeyPemPath = G("EINVOICE_SOFTWARE_KEY_PEM"),
            SoftwareCertPemPath = G("EINVOICE_SOFTWARE_CERT_PEM"),
            PollIntervalSeconds = int.TryParse(G("EINVOICE_POLL_INTERVAL_SECONDS"), out var p) ? p : 5,
            LocalStatusPort = int.TryParse(G("EINVOICE_LOCAL_STATUS_PORT"), out var port) ? port : 17865,
        };
    }

    private static IDictionary<string, string?> ProcessEnv()
    {
        var d = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry e in System.Environment.GetEnvironmentVariables())
            d[e.Key!.ToString()!] = e.Value?.ToString();
        return d;
    }
}
