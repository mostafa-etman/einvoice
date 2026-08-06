using System.Text.Json;
using System.Text.Json.Serialization;

namespace Einvoice.Agent.Config;

/// <summary>
/// Non-secret agent preferences stored under %LocalAppData%\Einvoice.Agent\agent.config.json.
/// Never stores the eSeal PIN (see <see cref="PinVault"/>).
/// </summary>
public sealed class LocalAgentConfig
{
    public const string FileName = "agent.config.json";

    /// <summary>Absolute path to PKCS#11 DLL (e.g. eps2003csp11.dll).</summary>
    public string? Pkcs11LibraryPath { get; set; }

    /// <summary>Preferred certificate issuer substring (e.g. "Egypt Trust Sealing CA").</summary>
    public string? CertificateIssuerFilter { get; set; }

    /// <summary>Optional subject substring filter.</summary>
    public string? CertificateSubjectFilter { get; set; }

    /// <summary>SHA-1 thumbprint hex when a specific cert was chosen.</summary>
    public string? CertificateThumbprint { get; set; }

    /// <summary>Last selected certificate subject (display only).</summary>
    public string? CertificateSubjectDisplay { get; set; }

    /// <summary>User opted to remember PIN via DPAPI (PIN bytes live in PinVault, not here).</summary>
    public bool RememberPinEnabled { get; set; }

    /// <summary>
    /// How long a remembered PIN remains valid.
    /// 0 = until agent exits (or Clear PIN); otherwise minutes from last unlock.
    /// </summary>
    public int PinRememberMinutes { get; set; } = 15;

    /// <summary>When true, skip auto-detect and use manual library/issuer fields.</summary>
    public bool ManualTokenConfig { get; set; }

    /// <summary>
    /// Cloud API base URL (HTTPS), e.g. https://api.yourdomain.com.
    /// Overlay for <see cref="AgentSettings.ApiBaseUrl"/> when env is unset.
    /// </summary>
    public string? ApiBaseUrl { get; set; }

    public static string DefaultDirectory =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Einvoice.Agent");

    public static string DefaultPath => Path.Combine(DefaultDirectory, FileName);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static LocalAgentConfig Load(string? path = null)
    {
        path ??= DefaultPath;
        if (!File.Exists(path))
            return new LocalAgentConfig();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<LocalAgentConfig>(json, JsonOpts) ?? new LocalAgentConfig();
        }
        catch
        {
            return new LocalAgentConfig();
        }
    }

    public void Save(string? path = null)
    {
        path ??= DefaultPath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOpts));
    }
}
