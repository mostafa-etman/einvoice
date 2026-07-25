namespace Einvoice.Agent.Config;

public enum SigningKeySource
{
    /// <summary>Committed software RSA test key (CI / no token).</summary>
    Software,

    /// <summary>PKCS#11 first (eps2003csp11.dll / SignatureP11.dll).</summary>
    Pkcs11,

    /// <summary>Windows certificate store / CSP-CNG only.</summary>
    Csp,

    /// <summary>Try PKCS#11, then CSP fallback (recommended for hardware).</summary>
    Auto,
}

public sealed class AgentSettings
{
    public string Environment { get; init; } = "Development";
    public string ApiBaseUrl { get; init; } = "http://localhost:3001";
    public string? DeviceToken { get; set; }
    public string DeviceLabel { get; init; } = System.Environment.MachineName;

    public SigningKeySource SigningKeySource { get; init; } = SigningKeySource.Auto;

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

        var source = SigningKeySource.Auto;
        var raw = G("EINVOICE_SIGNING_KEY_SOURCE");
        if (!string.IsNullOrWhiteSpace(raw) && Enum.TryParse<SigningKeySource>(raw, true, out var parsed))
            source = parsed;
        else if (string.Equals(G("EINVOICE_HARDWARE_TOKEN"), "1", StringComparison.Ordinal))
            source = SigningKeySource.Auto;
        else if (string.Equals(G("EINVOICE_USE_SOFTWARE_KEY"), "1", StringComparison.Ordinal))
            source = SigningKeySource.Software;

        return new AgentSettings
        {
            Environment = G("AGENT_ENVIRONMENT") ?? "Development",
            ApiBaseUrl = G("EINVOICE_API_BASE_URL") ?? G("API_BASE_URL") ?? "http://localhost:3001",
            DeviceToken = G("EINVOICE_DEVICE_TOKEN"),
            DeviceLabel = G("EINVOICE_DEVICE_LABEL") ?? System.Environment.MachineName,
            SigningKeySource = source,
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
